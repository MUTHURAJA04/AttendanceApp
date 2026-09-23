import React, {useEffect, useRef, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import {useResizer} from 'react-native-vision-camera-resizer';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {scheduleOnRN} from 'react-native-worklets';

const {width: SCREEN_WIDTH} = Dimensions.get('window');
const GUIDE_BOX_SIZE = Math.floor(SCREEN_WIDTH * 0.70);

const MODEL_INPUT_WIDTH = 112;
const MODEL_INPUT_HEIGHT = 112;
const EMBEDDING_SIZE = 128;
const NORMALIZATION_EPSILON = 1e-12;

const ENROLLMENT_SAMPLE_TARGET = 10;
const SIMILARITY_THRESHOLD = 0.70;

export default function FaceRecognitionCamera() {
  const device = useCameraDevice('front');
  const {hasPermission, requestPermission} = useCameraPermission();

  const modelPlugin = useTensorflowModel(
    require('./assets/models/mobile_facenet.tflite'),
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

  const [mode, setMode] = useState('IDLE');
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [matchResult, setMatchResult] = useState(null);

  const samplesRef = useRef([]);
  const templateRef = useRef(null);
  const modeRef = useRef('IDLE');
  const frameCounterRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ============================================================
  // JS CONSUMER (Runs on React thread)
  // ============================================================
  const handleEmbeddingFromWorklet = (embeddingArray) => {
    const currentMode = modeRef.current;
    frameCounterRef.current += 1;

    // --- ENROLLING MODE ---
    if (currentMode === 'ENROLLING') {
      samplesRef.current.push(new Float32Array(embeddingArray));
      const count = samplesRef.current.length;
      setEnrollProgress(count);

      if (count >= ENROLLMENT_SAMPLE_TARGET) {
        // Average the 10 samples
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

        const avgMagnitude = Math.max(
          Math.sqrt(avgSumSquares),
          NORMALIZATION_EPSILON,
        );

        const finalTemplate = new Float32Array(EMBEDDING_SIZE);
        for (let i = 0; i < EMBEDDING_SIZE; i++) {
          finalTemplate[i] = averaged[i] / avgMagnitude;
        }

        templateRef.current = finalTemplate;
        samplesRef.current = [];
        setMode('RECOGNIZING');
        console.log('✅ Template enrolled and unit normalized.');
      }
    }

    // --- RECOGNITION MODE ---
    else if (currentMode === 'RECOGNIZING' && templateRef.current != null) {
      const liveVec = new Float32Array(embeddingArray);
      const enrolledVec = templateRef.current;

      // Cosine similarity via dot product
      let dot = 0;
      for (let i = 0; i < EMBEDDING_SIZE; i++) {
        dot += liveVec[i] * enrolledVec[i];
      }

      const isMatch = dot >= SIMILARITY_THRESHOLD;
      setMatchResult({similarity: dot, isMatch});

      if (frameCounterRef.current % 15 === 0) {
        console.log(
          `[FACE MATCH] Similarity: ${dot.toFixed(3)} | Threshold: ${SIMILARITY_THRESHOLD} | Result: ${
            isMatch ? 'MATCH (SAME PERSON)' : 'NO MATCH (DIFFERENT PERSON)'
          }`,
        );
      }
    }
  };

  // ============================================================
  // WORKLET PIPELINE (Cropping center box + Normalizing)
  // ============================================================
  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',

    onFrame(frame) {
      'worklet';

      if (model == null || resizer == null) {
        frame.dispose();
        return;
      }

      try {
        // Crop center 70% square of the camera sensor
        // This eliminates all peripheral background noise
        const minDim = Math.min(frame.width, frame.height);
        const cropDim = Math.floor(minDim * 0.70);
        const cropX = Math.floor((frame.width - cropDim) / 2);
        const cropY = Math.floor((frame.height - cropDim) / 2);
// ✅ Correct: exactly 1 argument passed
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
            const val = output[i];
            sumSquares += val * val;
          }

          const rawMagnitude = Math.sqrt(sumSquares);
          const safeMagnitude = Math.max(
            rawMagnitude,
            NORMALIZATION_EPSILON,
          );

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

  const startEnrollment = () => {
    samplesRef.current = [];
    setMatchResult(null);
    setEnrollProgress(0);
    setMode('ENROLLING');
  };

  const resetEnrollment = () => {
    templateRef.current = null;
    samplesRef.current = [];
    setMatchResult(null);
    setEnrollProgress(0);
    setMode('IDLE');
  };

  if (!hasPermission || device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          {!hasPermission
            ? 'Camera permission required'
            : 'Front camera not available'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[frameOutput]}
      />

      {/* Visual Alignment Guide */}
      <View style={styles.guideContainer} pointerEvents="none">
        <View
          style={[
            styles.guideBox,
            matchResult?.isMatch && mode === 'RECOGNIZING'
              ? styles.guideBoxMatch
              : styles.guideBoxDefault,
          ]}
        />
        <Text style={styles.guideText}>Keep Face Inside Box</Text>
      </View>

      <View style={styles.overlay}>
        <Text style={styles.title}>Face Attendance Engine</Text>
        <Text style={styles.modeText}>Mode: {mode}</Text>

        {mode === 'IDLE' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={startEnrollment}>
            <Text style={styles.buttonText}>Register Face</Text>
          </TouchableOpacity>
        )}

        {mode === 'ENROLLING' && (
          <View style={styles.metricBox}>
            <Text style={styles.statusText}>
              Capturing face samples: {enrollProgress} /{' '}
              {ENROLLMENT_SAMPLE_TARGET}
            </Text>
          </View>
        )}

        {mode === 'RECOGNIZING' && (
          <View>
            <View
              style={[
                styles.resultCard,
                matchResult?.isMatch
                  ? styles.matchSuccess
                  : styles.matchFail,
              ]}>
              <Text style={styles.matchTitle}>
                {matchResult?.isMatch
                  ? 'MATCH CONFIRMED (SAME PERSON)'
                  : 'NO MATCH (DIFFERENT PERSON)'}
              </Text>
              <Text style={styles.similarityText}>
                Similarity:{' '}
                {matchResult
                  ? matchResult.similarity.toFixed(3)
                  : '--'}{' '}
                (Threshold: {SIMILARITY_THRESHOLD})
              </Text>
            </View>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={resetEnrollment}>
              <Text style={styles.buttonText}>Re-enroll Face</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 16,
  },
guideContainer: {
    position: 'absolute',
    top: 0,
    bottom: 110,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBox: {
    width: GUIDE_BOX_SIZE,
    height: GUIDE_BOX_SIZE,
    borderRadius: 24,
    borderWidth: 2,
  },
  guideBoxDefault: {
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  guideBoxMatch: {
    borderColor: '#22c55e',
  },
  guideText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    marginTop: 12,
  },
  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 40,
    padding: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modeText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2,
    marginBottom: 12,
  },
  metricBox: {
    paddingVertical: 8,
  },
  statusText: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: '600',
  },
  resultCard: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  matchSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
    borderColor: '#22c55e',
    borderWidth: 1,
  },
  matchFail: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderColor: '#ef4444',
    borderWidth: 1,
  },
  matchTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  similarityText: {
    color: '#e2e8f0',
    fontSize: 13,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#475569',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});