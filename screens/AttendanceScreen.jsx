import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, Dimensions, Vibration } from 'react-native';
import {
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import { Camera } from 'react-native-vision-camera-face-detector';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { scheduleOnRN } from 'react-native-worklets';
import { useIsFocused } from '@react-navigation/native';
import { EmployeeStorage, ConfigStorage } from '../services/employeeStorage';
import Sound from 'react-native-sound';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GUIDE_BOX_SIZE = Math.floor(SCREEN_WIDTH * 0.72);

const MODEL_INPUT_WIDTH = 112;
const MODEL_INPUT_HEIGHT = 112;
const EMBEDDING_SIZE = 128;
const NORMALIZATION_EPSILON = 1e-12;

const SIMILARITY_THRESHOLD = 0.7;
const EYE_CLOSED_THRESHOLD = 0.25;
const EYE_OPEN_THRESHOLD = 0.65;

export default function AttendanceScreen() {
  const isFocused = useIsFocused();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  // Model & Resizer
  const modelPlugin = useTensorflowModel(
    require('../assets/models/mobile_facenet.tflite'),
    [],
  );
  const model = modelPlugin.state === 'loaded' ? modelPlugin.model : null;

  const { resizer } = useResizer({
    width: MODEL_INPUT_WIDTH,
    height: MODEL_INPUT_HEIGHT,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'cover',
  });

  // Stored employees in memory
  const [employees, setEmployees] = useState([]);
  const employeesRef = useRef([]);

  // Active Recognition & Liveness states
  const [activeMatch, setActiveMatch] = useState(null);
  const [liveSimilarity, setLiveSimilarity] = useState(0);
  const [isLivenessVerified, setIsLivenessVerified] = useState(false);
  const [boxState, setBoxState] = useState('DEFAULT'); // 'DEFAULT' | 'ALIGNED' | 'LIVENESS_VERIFIED' | 'MATCH'
  const [promptText, setPromptText] = useState('Position Face in Box');
  const [punchSuccess, setPunchSuccess] = useState(null);

  // Synchronization refs for callbacks
  const activeMatchRef = useRef(null);
  const liveSimilarityRef = useRef(0);
  const isCooldownRef = useRef(false);
  const latestVectorRef = useRef(null);

  // Blink state machine refs
  const eyesWereClosed = useRef(false);
  const closedFrameCount = useRef(0);
  const openFrameCount = useRef(0);
  const blinkCooldown = useRef(false);

  const [threshold, setThreshold] = useState(0.7);
  const [livenessEnabled, setLivenessEnabled] = useState(true);

  const thresholdRef = useRef(0.7);
  const livenessEnabledRef = useRef(true);

  const chimeSoundRef = useRef(null);

  useEffect(() => {
    const chime = new Sound('alert.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.warn('Failed to load success sound', error);
        chimeSoundRef.current = null;
      } else {
        chimeSoundRef.current = chime;
      }
    });

    return () => {
      if (chimeSoundRef.current) {
        chimeSoundRef.current.release();
      }
    };
  }, []);

  // Reload employee database whenever tab comes into focus
  useEffect(() => {
    if (isFocused) {
      loadEmployees();
      resetKiosk();

      ConfigStorage.getConfig().then(cfg => {
        setThreshold(cfg.threshold);
        thresholdRef.current = cfg.threshold;
        setLivenessEnabled(cfg.liveness);
        livenessEnabledRef.current = cfg.liveness;
        console.log(
          `[CONFIG LOADED] Threshold: ${cfg.threshold}, Liveness: ${cfg.liveness}`,
        );
      });
    }
  }, [isFocused]);

  const loadEmployees = async () => {
    const list = await EmployeeStorage.getAllEmployees();
    setEmployees(list);
    employeesRef.current = list;
    console.log(`[ATTENDANCE] Loaded ${list.length} active employee profiles`);
  };

  const resetKiosk = () => {
    isCooldownRef.current = false;
    setActiveMatch(null);
    activeMatchRef.current = null;
    setLiveSimilarity(0);
    liveSimilarityRef.current = 0;
    setIsLivenessVerified(false);
    setBoxState('DEFAULT');
    setPromptText('Position Face in Box');
    setPunchSuccess(null);
    eyesWereClosed.current = false;
    closedFrameCount.current = 0;
    openFrameCount.current = 0;
    blinkCooldown.current = false;
    setDuplicateWarning(null);
  };

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // ============================================================
  // ATTENDANCE RECORDING (Punch DB + UI Lockout)
  // ============================================================
const triggerAttendancePunch = async (employee, score) => {
    if (isCooldownRef.current) return;
    isCooldownRef.current = true;

    // 1. Process punch rule in storage (checks duplicate & alternates IN/OUT)
    const result = await EmployeeStorage.logAttendancePunch({
      employeeId: employee.id,
      employeeName: employee.name,
      similarityScore: score,
    });

    // --- CASE A: DUPLICATE PUNCH (< 2 mins) ---
    if (result.status === 'DUPLICATE_BLOCKED') {
      Vibration.vibrate(300); // Rejection buzz
      setPromptText(`Already Punched ${result.lastType}!`);

      setDuplicateWarning({
        name: result.employeeName,
        lastType: result.lastType,
        waitSeconds: result.waitSeconds,
      });

      setTimeout(() => {
        resetKiosk();
      }, 3500);
      return;
    }

    // --- CASE B: SUCCESSFUL PUNCH (IN / OUT) ---
    Vibration.vibrate([0, 60, 40, 60]);

    if (chimeSoundRef.current) {
      chimeSoundRef.current.stop(() => {
        chimeSoundRef.current.play((success) => {
          if (!success) chimeSoundRef.current.reset();
        });
      });
    }

    const punch = result.punch;
    setBoxState('MATCH');
    setIsLivenessVerified(true);
    setPromptText(`${employee.name}: Checked ${punch.type}!`);

    setPunchSuccess({
      name: employee.name,
      id: employee.id,
      department: employee.department || 'General',
      type: punch.type, // 'IN' or 'OUT'
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      score: (score * 100).toFixed(0),
    });

    console.log(`✅ ATTENDANCE PUNCHED [${punch.type}]: ${employee.name} (${employee.id})`);

    // 4-second lockout before returning to detection mode
    setTimeout(() => {
      resetKiosk();
    }, 4000);
  };

  // ============================================================
  // PHASE 1: ML KIT FACE DETECTION, POSE & BLINK LIVENESS
  // ============================================================
  const handleFacesDetected = useCallback(
    faces => {
      if (isCooldownRef.current || !isFocused) return;

      // 1. Detect presence
      if (!Array.isArray(faces) || faces.length === 0) {
        setBoxState('DEFAULT');
        setPromptText('Position Face in Box');
        setIsLivenessVerified(false);
        setActiveMatch(null);
        activeMatchRef.current = null;
        eyesWereClosed.current = false;
        closedFrameCount.current = 0;
        openFrameCount.current = 0;
        return;
      }

      // 2. Reject multiple faces
      if (faces.length > 1) {
        setBoxState('DEFAULT');
        setPromptText('Only One Person Allowed');
        setIsLivenessVerified(false);
        setActiveMatch(null);
        activeMatchRef.current = null;
        return;
      }

      const face = faces[0];
      const yaw = typeof face.yawAngle === 'number' ? face.yawAngle : 0;

      // 3. Pose validation (Must look head-on)
      if (Math.abs(yaw) > 15) {
        setBoxState('DEFAULT');
        setPromptText(
          yaw > 15 ? 'Turn Left toward Camera' : 'Turn Right toward Camera',
        );
        return;
      }

      // If face is aligned straight, check matching status
      const currentMatchedEmp = activeMatchRef.current;

      if (currentMatchedEmp) {
        setBoxState('ALIGNED');
        if (!livenessEnabledRef.current) {
          setPromptText(
            `Hi ${currentMatchedEmp.name}! Processing attendance...`,
          );
        } else {
          setPromptText(`Hi ${currentMatchedEmp.name}! Blink to Punch`);
        }
      } else if (employeesRef.current.length === 0) {
        setBoxState('DEFAULT');
        setPromptText('No Employees Registered in System');
        return;
      } else {
        setBoxState('ALIGNED');
        setPromptText('Scanning Face...');
      }

      // 4. Natural Blink Liveness Engine
      const leftEye =
        typeof face.leftEyeOpenProbability === 'number'
          ? face.leftEyeOpenProbability
          : 1.0;
      const rightEye =
        typeof face.rightEyeOpenProbability === 'number'
          ? face.rightEyeOpenProbability
          : 1.0;

      const eyesClosed =
        leftEye < EYE_CLOSED_THRESHOLD && rightEye < EYE_CLOSED_THRESHOLD;
      const eyesOpen =
        leftEye > EYE_OPEN_THRESHOLD && rightEye > EYE_OPEN_THRESHOLD;

      if (eyesClosed) {
        closedFrameCount.current += 1;
        openFrameCount.current = 0;
        if (closedFrameCount.current >= 1) {
          eyesWereClosed.current = true;
        }
      } else if (eyesOpen) {
        openFrameCount.current += 1;
        closedFrameCount.current = 0;

        // Completed Blink Cycle: OPEN -> CLOSED -> OPEN
        if (
          eyesWereClosed.current &&
          openFrameCount.current >= 1 &&
          !blinkCooldown.current
        ) {
          console.log('👁️ NATURAL BLINK CONFIRMED');
          eyesWereClosed.current = false;
          blinkCooldown.current = true;

          // If face is identified when blink finishes -> Stamp attendance!
          if (currentMatchedEmp) {
            triggerAttendancePunch(
              currentMatchedEmp,
              liveSimilarityRef.current,
            );
          } else {
            setPromptText('Blink Verified. Face Unrecognized');
          }

          setTimeout(() => {
            blinkCooldown.current = false;
          }, 800);
        }
      }
    },
    [isFocused],
  );

  // ============================================================
  // PHASE 2: CONTINUOUS 1:N RECOGNITION (MobileFaceNet)
  // ============================================================
  const handleEmbeddingFromWorklet = embeddingArray => {
    if (isCooldownRef.current || !isFocused) return;

    latestVectorRef.current = embeddingArray;
    const currentList = employeesRef.current;
    if (!currentList || currentList.length === 0) {
      setActiveMatch(null);
      activeMatchRef.current = null;
      setLiveSimilarity(0);
      liveSimilarityRef.current = 0;
      return;
    }

    const liveVec = new Float32Array(embeddingArray);
    let bestMatch = null;
    let highestSim = -1;

    // Fast 1:N dot product search
    for (let i = 0; i < currentList.length; i++) {
      const emp = currentList[i];
      const storedTemplate = emp.template;
      let dot = 0;
      for (let j = 0; j < EMBEDDING_SIZE; j++) {
        dot += liveVec[j] * storedTemplate[j];
      }

      if (dot > highestSim) {
        highestSim = dot;
        bestMatch = emp;
      }
    }

    liveSimilarityRef.current = highestSim;
    setLiveSimilarity(highestSim);

    if (highestSim >= thresholdRef.current && bestMatch != null) {
      setActiveMatch(bestMatch);
      activeMatchRef.current = bestMatch;

      // ✅ If Liveness is DISABLED, punch immediately without waiting for a blink!
      if (!livenessEnabledRef.current) {
        triggerAttendancePunch(bestMatch, highestSim);
      }
    } else {
      setActiveMatch(null);
      activeMatchRef.current = null;
    }
  };

  // ============================================================
  // WORKLET PIPELINE
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
        const resized = resizer.resize(frame);

        try {
          // ✅ CORRECT (handles single or dual-input tensor models):
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

  if (!hasPermission || !device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission required</Text>
      </View>
    );
  }

  // Dynamic box styling based on current state
  const getBoxStyle = () => {
    switch (boxState) {
      case 'MATCH':
        return styles.guideBoxMatch;
      case 'ALIGNED':
        return activeMatch ? styles.guideBoxIdentified : styles.guideBoxAligned;
      default:
        return styles.guideBoxDefault;
    }
  };

  return (
    <View style={styles.container}>
      {isFocused && (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          outputs={[frameOutput]}
          runClassifications={true}
          performanceMode="fast"
          onFacesDetected={handleFacesDetected}
        />
      )}

      {/* Center Alignment Box with Dynamic State Borders */}
      <View style={styles.guideContainer} pointerEvents="none">
        <View style={[styles.guideBox, getBoxStyle()]} />
        <Text style={styles.guideSubText}>Keep face steady inside frame</Text>
      </View>

      {/* Floating Status & Guidance Pill */}
      <View style={styles.pillContainer} pointerEvents="none">
        <View
          style={[
            styles.pill,
            activeMatch && styles.pillIdentified,
            boxState === 'MATCH' && styles.pillMatch,
          ]}
        >
          <Text style={styles.pillText}>{promptText}</Text>
        </View>
      </View>

      {/* Attendance Punch Confirmation Modal */}
    {/* Attendance Success Modal (IN / OUT Badge) */}
      {punchSuccess && (
        <View
          style={[
            styles.successModal,
            punchSuccess.type === 'OUT' ? styles.modalOut : styles.modalIn,
          ]}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {punchSuccess.type === 'IN' ? 'CHECK-IN' : 'CHECK-OUT'}
            </Text>
          </View>
          <Text style={styles.successIcon}>
            {punchSuccess.type === 'IN' ? '✓' : '👋'}
          </Text>
          <Text style={styles.successTitle}>
            {punchSuccess.type === 'IN' ? 'Welcome!' : 'Goodbye!'}
          </Text>
          <Text style={styles.successName}>{punchSuccess.name}</Text>
          <Text style={styles.successSub}>
            {punchSuccess.department} • {punchSuccess.time}
          </Text>
          <Text style={styles.successConfidence}>
            Confidence: {punchSuccess.score}%
          </Text>
        </View>
      )}

      {/* Duplicate Punch Blocked Warning */}
      {duplicateWarning && (
        <View style={styles.duplicateModal}>
          <Text style={styles.duplicateIcon}>⚠️</Text>
          <Text style={styles.duplicateTitle}>
            Already Punched {duplicateWarning.lastType}!
          </Text>
          <Text style={styles.duplicateName}>{duplicateWarning.name}</Text>
          <Text style={styles.duplicateSub}>
            Please wait {duplicateWarning.waitSeconds}s before punching again.
          </Text>
        </View>
      )}

      {/* Bottom Live Metrics Bar */}
      <View style={styles.overlay}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Attendance Kiosk</Text>
          <Text style={styles.employeeBadge}>{employees.length} Enrolled</Text>
        </View>

        <View
          style={[
            styles.matchCard,
            activeMatch ? styles.cardMatch : styles.cardWaiting,
          ]}
        >
          <Text style={styles.matchTitle}>
            {activeMatch
              ? `IDENTIFIED: ${activeMatch.name.toUpperCase()}`
              : employees.length === 0
              ? 'NO ENROLLED EMPLOYEES'
              : 'SEARCHING DATABASE...'}
          </Text>

          <Text style={styles.similarityText}>
            Match Score: {(liveSimilarity * 100).toFixed(0)}% (Threshold:{' '}
            {SIMILARITY_THRESHOLD * 100}%)
          </Text>
        </View>
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
    bottom: 120,
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
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  guideBoxAligned: {
    borderColor: '#f59e0b', // Yellow: oriented, ready to blink
    borderWidth: 2.5,
  },
  guideBoxIdentified: {
    borderColor: '#38bdf8', // Cyan: recognized, waiting for confirmation blink
    borderWidth: 3,
  },
  guideBoxMatch: {
    borderColor: '#22c55e', // Green: attendance punched!
    borderWidth: 4,
  },
  guideSubText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    marginTop: 10,
    fontWeight: '500',
  },
  pillContainer: {
    position: 'absolute',
    top: 55,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  pill: {
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#475569',
  },
  pillIdentified: {
    backgroundColor: '#0369a1',
    borderColor: '#38bdf8',
  },
  pillMatch: {
    backgroundColor: '#166534',
    borderColor: '#22c55e',
  },
  pillText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  successModal: {
    position: 'absolute',
    top: '30%',
    left: 30,
    right: 30,
    backgroundColor: '#15803d',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 16,
    zIndex: 100,
  },
  successIcon: {
    color: '#fff',
    fontSize: 44,
    fontWeight: 'bold',
  },
  successTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
  },
  successName: {
    color: '#f0fdf4',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6,
  },
  successSub: {
    color: '#bbf7d0',
    fontSize: 13,
    marginTop: 4,
  },
  successConfidence: {
    color: '#86efac',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },
  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 25,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  employeeBadge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  matchCard: {
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  cardWaiting: {
    backgroundColor: 'rgba(51, 65, 85, 0.4)',
    borderColor: '#475569',
    borderWidth: 1,
  },
  cardMatch: {
    backgroundColor: 'rgba(3, 105, 161, 0.35)',
    borderColor: '#38bdf8',
    borderWidth: 1,
  },
  matchTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  similarityText: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  modalIn: {backgroundColor: '#15803d'},
  modalOut: {backgroundColor: '#b45309'},
  typeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
  },
  typeBadgeText: {color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1},
  duplicateModal: {
    position: 'absolute',
    top: '30%',
    left: 30,
    right: 30,
    backgroundColor: '#b45309',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 16,
    zIndex: 100,
  },
  duplicateIcon: {fontSize: 40},
  duplicateTitle: {color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 4},
  duplicateName: {color: '#fef3c7', fontSize: 16, fontWeight: '700', marginTop: 4},
  duplicateSub: {color: '#fef3c7', fontSize: 13, marginTop: 6, textAlign: 'center'},
});
