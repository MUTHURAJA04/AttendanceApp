import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { NitroModules } from 'react-native-nitro-modules';
import { scheduleOnRN } from 'react-native-worklets';
import { EmployeeStorage } from '../services/employeeStorage';
import { loadKioskSettings } from '../services/kioskSettings';
import { FACE_CONFIG } from '../constants/faceConfig';
import {
  averageEmbeddings,
  validateFacePose,
  checkForDuplicateFace,
} from '../utils/faceEmbeddingUtils';
import FaceGuideBox from '../components/FaceGuideBox';
import EnrollmentProgressCard from '../components/EnrollmentProgressCard';
import SimpleLoading from '../components/SimpleLoading';

export default function RegisterFaceModal({
  visible,
  employee,
  onClose,
  onEnrolled,
  type = 'enroll',
}) {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();

  const modelPlugin = useTensorflowModel(
    require('../assets/models/mobile_facenet.tflite'),
    [],
  );
  const model = modelPlugin.state === 'loaded' ? modelPlugin.model : null;
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : null),
    [model],
  );

  useEffect(() => {
    if (modelPlugin.state === 'error') {
      console.error('[RegisterFace] TFLite model failed to load:', modelPlugin.error);
    } else if (modelPlugin.state === 'loaded') {
      console.log('[RegisterFace] TFLite model loaded successfully.');
    }
  }, [modelPlugin.state, modelPlugin.error]);

  const { resizer } = useResizer({
    width: FACE_CONFIG.MODEL_INPUT_WIDTH,
    height: FACE_CONFIG.MODEL_INPUT_HEIGHT,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'cover',
  });

  const [samplesCount, setSamplesCount] = useState(0);
  const [targetSamples, setTargetSamples] = useState(FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET || 10);
  const [detectionStatus, setDetectionStatus] = useState('Align your face inside the frame');
  const [boxState, setBoxState] = useState('DEFAULT'); // 'DEFAULT' | 'ALIGNED' | 'WARNING' | 'MATCH'
  const [hasValidFace, setHasValidFace] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [liveFaceBounds, setLiveFaceBounds] = useState(null);
  const [multipleFaces, setMultipleFaces] = useState(false);

  // Dynamic configuration refs from DB
  const targetSamplesRef = useRef(FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET || 10);
  const sampleIntervalMsRef = useRef(FACE_CONFIG.SAMPLE_INTERVAL_MS || 200);
  const yawAngleToleranceRef = useRef(FACE_CONFIG.MAX_HEAD_YAW_DEGREES || 18);

  const lastFaceCenterRef = useRef({ x: 0, y: 0 });
  const steadyStartRef = useRef(0);
  const isSteadyRef = useRef(false);
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

  // Load latest dynamic settings directly from Supabase DB
  useEffect(() => {
    if (visible) {
      loadKioskSettings().then((cfg) => {
        const samples = Number(cfg.enrollmentSamples || FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET || 10);
        const interval = Number(cfg.sampleIntervalMs || FACE_CONFIG.SAMPLE_INTERVAL_MS || 200);
        const yaw = Number(cfg.yawTolerance || FACE_CONFIG.MAX_HEAD_YAW_DEGREES || 18);

        console.log(`[RegisterFaceModal] Loaded live DB settings: targetSamples=${samples}, interval=${interval}ms, yaw=${yaw}°`);
        setTargetSamples(samples);
        targetSamplesRef.current = samples;
        sampleIntervalMsRef.current = interval;
        yawAngleToleranceRef.current = yaw;
      });

      setSamplesCount(0);
      setDetectionStatus(
        modelPlugin.state === 'loading'
          ? 'Starting AI Model...'
          : 'Align your face inside the frame',
      );
      setBoxState('DEFAULT');
      setHasValidFace(false);
      setIsSaving(false);
      setLiveFaceBounds(null);
      setMultipleFaces(false);
      lastFaceCenterRef.current = { x: 0, y: 0 };
      steadyStartRef.current = 0;
      isSteadyRef.current = false;
      samplesRef.current = [];
      isCapturingRef.current = true;
      hasValidFaceRef.current = false;
      lastSampleTimeRef.current = 0;
      lastValidFaceTimeRef.current = 0;
    }
  }, [visible, modelPlugin.state]);

  // ============================================================
  // SAVE 512-D EMBEDDING LOCALLY & TO CLOUD
  // ============================================================
  const handleSaveEnrollment = async (templateVector) => {
    if (!employee?.id) {
      Alert.alert('Error', 'No employee profile selected for enrollment.');
      onClose();
      return;
    }

    try {
      setIsSaving(true);
      setDetectionStatus('Verifying Unique Identity...');

      // 1. Prevent duplicate biometric enrollment across different employees
      const allEmployees = await EmployeeStorage.getAllEmployees();
      const duplicateResult = checkForDuplicateFace(
        templateVector,
        allEmployees,
        employee.id,
        employee.code || employee.employee_code,
      );

      if (duplicateResult.isDuplicate) {
        const existing = duplicateResult.existingEmployee;
        const matchPercent = (duplicateResult.similarity * 100).toFixed(1);
        const existingName = existing.name || existing.full_name || 'Existing Staff';
        const existingCode = existing.code || existing.employee_code ? ` (${existing.code || existing.employee_code})` : '';

        console.warn(
          `[RegisterFaceModal] Duplicate face detected! Matches ${existingName} (${matchPercent}%)`,
        );

        setBoxState('WARNING');
        setDetectionStatus('Duplicate Face Detected!');

        Alert.alert(
          'Duplicate Face Detected ⚠️',
          `This face is already registered for:\n\n${existingName}${existingCode}\nMatch confidence: ${matchPercent}%\n\nThe same person cannot be enrolled or updated under multiple employee accounts.`,
          [
            {
              text: 'OK',
              onPress: () => {
                isCapturingRef.current = true;
                samplesRef.current = [];
                setSamplesCount(0);
                setIsSaving(false);
                setBoxState('DEFAULT');
                setDetectionStatus('Position Face in Box');
              },
            },
          ],
        );
        return;
      }

      console.log(`[RegisterFaceModal] Saving 512-D face embedding for ${employee.name || employee.full_name}...`);

      // Saves locally to AsyncStorage AND syncs to Supabase employees.face_embedding
      await EmployeeStorage.saveEmployeeFaceCloudAndLocal({
        employee,
        template: templateVector,
        skipDuplicateCheck: true,
      });

      setBoxState('MATCH');
      const isUpdate = type === 'update' || Boolean(employee?.hasFace);
      setDetectionStatus(isUpdate ? 'Face Template Updated!' : 'Face Enrolled & Saved Locally!');

      Alert.alert(
        isUpdate ? 'Face Updated Successfully! ✓' : 'Enrollment Complete! ✓',
        `512-D face template saved locally on device and synced for ${employee.name || employee.full_name || 'employee'}.`,
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
  // ML KIT FACE DETECTION GATE WITH POSE CHECK (10 FRONTAL FRAMES)
  // ============================================================
  const handleFacesDetected = useCallback((faces) => {
    if (!isCapturingRef.current) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      isSteadyRef.current = false;
      return;
    }

    // 1. Multi-face check
    if (faces && faces.length > 1) {
      setMultipleFaces(true);
      setLiveFaceBounds(null);
      isSteadyRef.current = false;
      steadyStartRef.current = 0;
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      setBoxState('WARNING');
      setDetectionStatus('Please ensure only one person is in front of the camera');
      return;
    }
    setMultipleFaces(false);

    // Strict pose gates: yaw <= 18, pitch <= 14, roll <= 10, minBoxSize >= 120
    const validation = validateFacePose(faces, {
      maxYaw: yawAngleToleranceRef.current || FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
      maxPitch: FACE_CONFIG.MAX_HEAD_PITCH_DEGREES,
      maxRoll: FACE_CONFIG.MAX_HEAD_ROLL_DEGREES,
      minBoxSize: FACE_CONFIG.MIN_FACE_BOX_SIZE,
    });

    if (!validation.isValid) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      setLiveFaceBounds(null);
      isSteadyRef.current = false;
      steadyStartRef.current = 0;
      setBoxState(validation.status === 'NO_FACE' ? 'DEFAULT' : 'WARNING');
      setDetectionStatus(validation.status === 'NO_FACE' ? 'Align your face inside the frame' : validation.message);
      return;
    }

    const face = validation.face;
    setLiveFaceBounds(
      face?.bounds
        ? {
            x: face.bounds.x,
            y: face.bounds.y,
            width: face.bounds.width,
            height: face.bounds.height,
            frameWidth: face.frameWidth || 0,
            frameHeight: face.frameHeight || 0,
          }
        : null,
    );

    // Steady face tracking gate
    const now = Date.now();
    const faceBounds = face.bounds || {};
    const centerX = (faceBounds.x || 0) + (faceBounds.width || 0) / 2;
    const centerY = (faceBounds.y || 0) + (faceBounds.height || 0) / 2;
    const prev = lastFaceCenterRef.current;
    const displacement = Math.hypot(centerX - prev.x, centerY - prev.y);

    if (displacement < 40) {
      if (steadyStartRef.current === 0) {
        steadyStartRef.current = now;
      } else if (now - steadyStartRef.current >= 250) {
        isSteadyRef.current = true;
      }
    } else {
      steadyStartRef.current = now;
      isSteadyRef.current = false;
    }
    lastFaceCenterRef.current = { x: centerX, y: centerY };

    // Valid frontal single face detected
    lastValidFaceTimeRef.current = now;
    hasValidFaceRef.current = true;
    setHasValidFace(true);
    setBoxState('ALIGNED');
    setDetectionStatus(isSteadyRef.current ? 'Hold still...' : 'Face Aligned - Hold Steady...');
  }, []);

  // ============================================================
  // WORKLET RECEIVER & 512-D VECTOR AVERAGING
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

      // Element-wise averaging and unit normalization across all 512 dimensions
      const finalTemplate = averageEmbeddings(
        samplesRef.current,
        512,
      );

      handleSaveEnrollment(finalTemplate);
    }
  };

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    onFrame(frame) {
      'worklet';

      if (boxedModel == null || resizer == null) {
        frame.dispose();
        return;
      }

      const activeModel = boxedModel.unbox();
      if (activeModel == null) {
        frame.dispose();
        return;
      }

      try {
        const resized = resizer.resize(frame);
        try {
          const buffer = resized.getPixelBuffer();
          const modelInputs =
            activeModel.inputs.length === 2 ? [buffer, buffer] : [buffer];
          const outputs = activeModel.runSync(modelInputs);

          if (!outputs || outputs.length === 0) return;

          const output = new Float32Array(outputs[0]);
          if (output.length < FACE_CONFIG.EMBEDDING_SIZE) return;

          let sumSquares = 0;
          for (let i = 0; i < FACE_CONFIG.EMBEDDING_SIZE; i++) {
            sumSquares += output[i] * output[i];
          }

          const rawMagnitude = Math.sqrt(sumSquares);
          const safeMagnitude = Math.max(rawMagnitude, FACE_CONFIG.NORMALIZATION_EPSILON || 1e-12);

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
            runLandmarks={false}
            runContours={false}
            trackingEnabled={true}
            performanceMode="fast"
            onFacesDetected={handleFacesDetected}
          />
        )}

        {/* Reusable Guide Frame Overlay & Status Pill */}
        <FaceGuideBox
          boxState={modelPlugin.state === 'loading' ? 'DEFAULT' : boxState}
          promptText={
            modelPlugin.state === 'loading'
              ? 'Initializing Face AI Engine...'
              : isSaving
              ? 'Saving Face Template...'
              : detectionStatus
          }
          isIdentified={hasValidFace}
          isLoading={modelPlugin.state === 'loading'}
          faceBounds={liveFaceBounds}
          showReticle={true}
          multipleFacesDetected={multipleFaces}
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
            subtext="Averaging 512-D facial vectors & saving to local biometric vault"
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
});