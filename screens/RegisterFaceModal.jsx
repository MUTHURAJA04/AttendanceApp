import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import {Camera} from 'react-native-vision-camera-face-detector';
import {useResizer} from 'react-native-vision-camera-resizer';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {scheduleOnRN} from 'react-native-worklets';
import {supabase} from '../services/supabase';

const {width: SCREEN_WIDTH} = Dimensions.get('window');
const GUIDE_BOX_SIZE = Math.floor(SCREEN_WIDTH * 0.7);

const MODEL_INPUT_WIDTH = 112;
const MODEL_INPUT_HEIGHT = 112;
const EMBEDDING_SIZE = 128;
const NORMALIZATION_EPSILON = 1e-12;
const ENROLLMENT_SAMPLE_TARGET = 10;
const SAMPLE_INTERVAL_MS = 250; // Capture 1 sample every 250ms for angle variation

export default function RegisterFaceModal({
  visible,
  employee,
  onClose,
  onEnrolled,
}) {
  const device = useCameraDevice('front');
  const {hasPermission} = useCameraPermission();

  const modelPlugin = useTensorflowModel(
    require('../assets/models/mobile_facenet.tflite'),
    [],
  );
  const model = modelPlugin.state === 'loaded' ? modelPlugin.model : null;

  const {resizer} = useResizer({
    width: MODEL_INPUT_WIDTH,
    height: MODEL_INPUT_HEIGHT,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'cover',
  });

  const [samplesCount, setSamplesCount] = useState(0);
  const [detectionStatus, setDetectionStatus] = useState('Position Face in Box');
  const [hasValidFace, setHasValidFace] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const samplesRef = useRef([]);
  const isCapturingRef = useRef(true);
  const hasValidFaceRef = useRef(false);
  const lastSampleTimeRef = useRef(0);

  useEffect(() => {
    if (visible) {
      setSamplesCount(0);
      setDetectionStatus('Position Face in Box');
      setHasValidFace(false);
      setIsSaving(false);
      samplesRef.current = [];
      isCapturingRef.current = true;
      hasValidFaceRef.current = false;
      lastSampleTimeRef.current = 0;
    }
  }, [visible]);

  // ============================================================
  // SAVE EMBEDDING DIRECTLY TO SUPABASE
  // ============================================================
  const saveEmbeddingToDb = async (vectorArray) => {
    if (!employee?.id) {
      Alert.alert('Error', 'No employee specified for enrollment.');
      onClose();
      return;
    }

    try {
      setIsSaving(true);
      console.log(`[Supabase] Saving face embedding for ${employee.name || employee.full_name}...`);

      const {error} = await supabase
        .from('employees')
        .update({
          face_embedding: vectorArray,
          face_updated_at: new Date().toISOString(),
        })
        .eq('id', employee.id);

      if (error) {
        throw error;
      }

      console.log('[Supabase] Face embedding successfully saved!');
      Alert.alert(
        'Success! ✓',
        `Face profile registered for ${employee.name || employee.full_name || 'employee'}!`,
        [
          {
            text: 'OK',
            onPress: () => {
              onEnrolled?.();
            },
          },
        ],
      );
    } catch (err) {
      console.error('[Supabase Save Error]:', err);
      Alert.alert('Save Failed', err.message || 'Could not update face in database.');
      // Re-enable scanning on failure
      isCapturingRef.current = true;
      samplesRef.current = [];
      setSamplesCount(0);
      setIsSaving(false);
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

    if (!Array.isArray(faces) || faces.length === 0) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      setDetectionStatus('No Face Detected');
      return;
    }

    if (faces.length > 1) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      setDetectionStatus('Multiple Faces: Only 1 person in frame');
      return;
    }

    const face = faces[0];
    const yaw = typeof face.yawAngle === 'number' ? face.yawAngle : 0;

    if (Math.abs(yaw) > 18) {
      hasValidFaceRef.current = false;
      setHasValidFace(false);
      setDetectionStatus('Look directly at camera');
      return;
    }

    // Valid single face detected
    hasValidFaceRef.current = true;
    setHasValidFace(true);
    setDetectionStatus('Face Detected - Hold Still...');
  }, []);

  // ============================================================
  // WORKLET RECEIVER & VECTOR AVERAGING
  // ============================================================
  const handleEmbeddingFromWorklet = (rawArr) => {
    if (!isCapturingRef.current) return;
    if (!hasValidFaceRef.current) return;

    const now = Date.now();
    if (now - lastSampleTimeRef.current < SAMPLE_INTERVAL_MS) {
      return;
    }
    lastSampleTimeRef.current = now;

    samplesRef.current.push(new Float32Array(rawArr));
    const count = samplesRef.current.length;
    setSamplesCount(count);

    if (count >= ENROLLMENT_SAMPLE_TARGET) {
      isCapturingRef.current = false;
      hasValidFaceRef.current = false;

      // Element-wise averaging of the 10 verified face samples
      const averaged = new Float32Array(EMBEDDING_SIZE);
      for (let s = 0; s < count; s++) {
        const sample = samplesRef.current[s];
        for (let i = 0; i < EMBEDDING_SIZE; i++) {
          averaged[i] += sample[i];
        }
      }

      let avgSumSquares = 0;
      for (let i = 0; i < EMBEDDING_SIZE; i++) {
        averaged[i] /= count;
        avgSumSquares += averaged[i] * averaged[i];
      }

      const avgMagnitude = Math.max(Math.sqrt(avgSumSquares), NORMALIZATION_EPSILON);
      const finalTemplate = new Array(EMBEDDING_SIZE);
      for (let i = 0; i < EMBEDDING_SIZE; i++) {
        finalTemplate[i] = Number((averaged[i] / avgMagnitude).toFixed(6));
      }

      // Automatically push to Supabase
      saveEmbeddingToDb(finalTemplate);
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
          if (output.length < EMBEDDING_SIZE) return;

          let sumSquares = 0;
          for (let i = 0; i < EMBEDDING_SIZE; i++) {
            sumSquares += output[i] * output[i];
          }

          const rawMagnitude = Math.sqrt(sumSquares);
          const safeMagnitude = Math.max(rawMagnitude, NORMALIZATION_EPSILON);

          const rawArr = new Array(EMBEDDING_SIZE);
          for (let i = 0; i < EMBEDDING_SIZE; i++) {
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
            runClassifications={false}
            runLandmarks={false}
            runContours={false}
            trackingEnabled={true}
            performanceMode="fast"
            onFacesDetected={handleFacesDetected}
          />
        )}

        {/* Perfectly Centered Guide Frame */}
        <View style={styles.guideWrapper} pointerEvents="none">
          <View
            style={[
              styles.guideBox,
              hasValidFace ? styles.guideBoxActive : styles.guideBoxWaiting,
            ]}
          />
          <Text
            style={[
              styles.scanPrompt,
              hasValidFace ? styles.promptActive : styles.promptWaiting,
            ]}>
            {isSaving ? 'Processing & Saving...' : detectionStatus}
          </Text>
        </View>

        {/* Bottom Progress Card */}
        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>
            Enrolling: {employee?.name || employee?.full_name || 'Staff Member'}
          </Text>

          {isSaving ? (
            <View style={styles.savingRow}>
              <ActivityIndicator color="#38bdf8" size="small" />
              <Text style={styles.savingText}>Updating database...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.progressCount}>
                Verified Samples: {samplesCount} / {ENROLLMENT_SAMPLE_TARGET}
              </Text>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${
                        (samplesCount / ENROLLMENT_SAMPLE_TARGET) * 100
                      }%`,
                    },
                  ]}
                />
              </View>
            </>
          )}

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            disabled={isSaving}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  guideWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBox: {
    width: GUIDE_BOX_SIZE,
    height: GUIDE_BOX_SIZE,
    borderRadius: 28,
    borderWidth: 2.5,
  },
  guideBoxWaiting: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  guideBoxActive: {
    borderColor: '#22c55e',
    borderWidth: 3.5,
  },
  scanPrompt: {
    fontSize: 14,
    marginTop: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  promptWaiting: {
    color: '#cbd5e1',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  promptActive: {
    color: '#22c55e',
    backgroundColor: 'rgba(22, 101, 52, 0.85)',
  },
  progressCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  progressTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  progressCount: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#1e293b',
    borderRadius: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  savingText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
});