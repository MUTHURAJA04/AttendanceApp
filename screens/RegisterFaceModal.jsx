import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Modal,
  Alert,
} from 'react-native';
import {
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import { Camera } from 'react-native-vision-camera-face-detector';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { scheduleOnRN } from 'react-native-worklets';
import { EmployeeStorage, ConfigStorage } from '../services/employeeStorage';
import { FACE_CONFIG } from '../constants/faceConfig';
import { averageEmbeddings, validateFacePose } from '../utils/faceEmbeddingUtils';
import FaceGuideBox from '../components/FaceGuideBox';
import EnrollmentProgressCard from '../components/EnrollmentProgressCard';
import SimpleLoading from '../components/SimpleLoading';

export default function RegisterFaceModal({
  visible,
  employee,
  onClose,
  onEnrolled,
}) {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();

  const modelPlugin = useTensorflowModel(
    require('../assets/models/mobile_facenet.tflite'),
    [],
  );
  const model = modelPlugin.state === 'loaded' ? modelPlugin.model : null;

  const { resizer } = useResizer({
    width: FACE_CONFIG.MODEL_INPUT_WIDTH,
    height: FACE_CONFIG.MODEL_INPUT_HEIGHT,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'cover',
  });

  const [samplesCount, setSamplesCount] = useState(0);
  const [targetSamples, setTargetSamples] = useState(FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET);
  const [detectionStatus, setDetectionStatus] = useState('Position Face in Box');
  const [boxState, setBoxState] = useState('DEFAULT'); // 'DEFAULT' | 'ALIGNED' | 'WARNING' | 'MATCH'
  const [hasValidFace, setHasValidFace] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Dynamic configuration refs from DB
  const targetSamplesRef = useRef(FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET);
  const sampleIntervalMsRef = useRef(FACE_CONFIG.SAMPLE_INTERVAL_MS);
  const yawAngleToleranceRef = useRef(FACE_CONFIG.MAX_HEAD_YAW_DEGREES);

  const samplesRef = useRef([]);
  const isCapturingRef = useRef(true);
  const hasValidFaceRef = useRef(false);
  const lastSampleTimeRef = useRef(0);
  const lastValidFaceTimeRef = useRef(0);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // Load latest dynamic settings from DB
  useEffect(() => {
    if (visible) {
      ConfigStorage.getConfig().then((cfg) => {
        const samples = cfg.enrollmentSamples || FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET;
        const interval = cfg.sampleIntervalMs || FACE_CONFIG.SAMPLE_INTERVAL_MS;
        const yaw = cfg.yawAngleTolerance || FACE_CONFIG.MAX_HEAD_YAW_DEGREES;

        setTargetSamples(samples);
        targetSamplesRef.current = samples;
        sampleIntervalMsRef.current = interval;
        yawAngleToleranceRef.current = yaw;
      });

      setSamplesCount(0);
      setDetectionStatus(
        modelPlugin.state === 'loading'
          ? 'Starting AI Model...'
          : 'Position Face in Box',
      );
      setBoxState('DEFAULT');
      setHasValidFace(false);
      setIsSaving(false);
      samplesRef.current = [];
      isCapturingRef.current = true;
      hasValidFaceRef.current = false;
      lastSampleTimeRef.current = 0;
      lastValidFaceTimeRef.current = 0;
    }
  }, [visible, modelPlugin.state]);

  // ============================================================
  // SAVE EMBEDDING LOCALLY & TO CLOUD
  // ============================================================
  const handleSaveEnrollment = async (templateVector) => {
    if (!employee?.id) {
      Alert.alert('Error', 'No employee profile selected for enrollment.');
      onClose();
      return;
    }

    try {
      setIsSaving(true);
      console.log(`[RegisterFaceModal] Saving face embedding locally and to cloud for ${employee.name || employee.full_name}...`);

      // Saves locally to AsyncStorage AND syncs to Supabase
      await EmployeeStorage.saveEmployeeFaceCloudAndLocal({
        employee,
        template: templateVector,
      });

      setBoxState('MATCH');
      setDetectionStatus('Face Enrolled & Saved Locally!');

      Alert.alert(
        'Enrollment Complete! ✓',
        `Face template saved locally on device and synced for ${employee.name || employee.full_name || 'employee'}.`,
        [
          {
            text: 'Done',
            onPress: () => {
              onEnrolled?.();
            },
          },
        ],
      );
    } catch (err) {
      console.error('[RegisterFaceModal Save Error]:', err);
      Alert.alert('Save Error', err.message || 'Failed to save embedding.');
      // Re-enable scanning
      isCapturingRef.current = true;
      samplesRef.current = [];
      setSamplesCount(0);
      setIsSaving(false);
      setBoxState('DEFAULT');
    }
  };

  // ============================================================
  // ML KIT FACE DETECTION GATE
  // ============================================================
  const handleFacesDetected = useCallback((faces) => {
    if (!isCapturingRef.current) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      return;
    }

    const validation = validateFacePose(faces, yawAngleToleranceRef.current);

    if (!validation.isValid) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      setBoxState(validation.status === 'NO_FACE' ? 'DEFAULT' : 'WARNING');
      setDetectionStatus(validation.message);
      return;
    }

    // Valid single face detected
    lastValidFaceTimeRef.current = Date.now();
    hasValidFaceRef.current = true;
    setHasValidFace(true);
    setBoxState('ALIGNED');
    setDetectionStatus('Face Aligned - Hold Steady...');
  }, []);

  // ============================================================
  // WORKLET RECEIVER & VECTOR AVERAGING
  // ============================================================
  const handleEmbeddingFromWorklet = (rawArr) => {
    const isRecentlyValid =
      hasValidFaceRef.current ||
      Date.now() - lastValidFaceTimeRef.current < 450;

    if (!isCapturingRef.current || !isRecentlyValid) return;

    const now = Date.now();
    if (now - lastSampleTimeRef.current < sampleIntervalMsRef.current) {
      return;
    }
    lastSampleTimeRef.current = now;

    samplesRef.current.push(new Float32Array(rawArr));
    const count = samplesRef.current.length;
    setSamplesCount(count);

    if (count >= targetSamplesRef.current) {
      isCapturingRef.current = false;
      hasValidFaceRef.current = false;

      // Element-wise averaging and unit normalization
      const finalTemplate = averageEmbeddings(
        samplesRef.current,
        FACE_CONFIG.EMBEDDING_SIZE,
      );

      handleSaveEnrollment(finalTemplate);
    }
  };

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    onFrame(frame) {
      'worklet';

      if (model == null || resizer == null) {
        frame.dispose();
        return;
      }

      try {
        const resized = resizer.resize(frame);
        try {
          const buffer = resized.getPixelBuffer();
          const modelInputs =
            model.inputs.length === 2 ? [buffer, buffer] : [buffer];
          const outputs = model.runSync(modelInputs);

          if (!outputs || outputs.length === 0) return;

          const output = new Float32Array(outputs[0]);
          if (output.length < FACE_CONFIG.EMBEDDING_SIZE) return;

          let sumSquares = 0;
          for (let i = 0; i < FACE_CONFIG.EMBEDDING_SIZE; i++) {
            sumSquares += output[i] * output[i];
          }

          const rawMagnitude = Math.sqrt(sumSquares);
          const safeMagnitude = Math.max(rawMagnitude, FACE_CONFIG.NORMALIZATION_EPSILON);

          const rawArr = new Array(FACE_CONFIG.EMBEDDING_SIZE);
          for (let i = 0; i < FACE_CONFIG.EMBEDDING_SIZE; i++) {
            rawArr[i] = output[i] / safeMagnitude;
          }

          scheduleOnRN(handleEmbeddingFromWorklet, rawArr);
        } finally {
          resized.dispose();
        }
      } catch (err) {
        console.error('[WORKLET ERROR]', err);
      } finally {
        frame.dispose();
      }
    },
  });

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalContainer}>
        {hasPermission && device && (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible && !isSaving}
            outputs={[frameOutput]}
            runClassifications={true}
            runLandmarks={true}
            runContours={false}
            trackingEnabled={true}
            performanceMode="fast"
            onFacesDetected={handleFacesDetected}
          />
        )}

        {/* Loading Indicator for Model Initialization */}
        {modelPlugin.state === 'loading' && (
          <View style={styles.loadingBanner}>
            <SimpleLoading size="small" text="Initializing Face AI Engine..." />
          </View>
        )}

        {/* Reusable Guide Frame Overlay */}
        <FaceGuideBox
          boxState={boxState}
          promptText={isSaving ? 'Saving Face Template...' : detectionStatus}
          subText={`Look straight into camera to capture ${targetSamples} verified angles`}
          isIdentified={hasValidFace}
        />

        {/* Reusable Bottom Progress Card */}
        <EnrollmentProgressCard
          employeeName={employee?.name || employee?.full_name}
          samplesCount={samplesCount}
          targetSamples={targetSamples}
          isSaving={isSaving}
          onCancel={onClose}
        />

        {/* Saving Face Template Overlay */}
        {isSaving && (
          <SimpleLoading
            overlay
            size="medium"
            text="Saving Face Template..."
            subtext="Averaging 128D facial vectors & saving to local biometric vault"
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingBanner: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#38bdf8',
    zIndex: 20,
  },
  loadingText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
});