import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
  Modal,
  TextInput,
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
import {EmployeeStorage} from './services/employeeStorage'; // Adjust path if needed

const {width: SCREEN_WIDTH} = Dimensions.get('window');
const GUIDE_BOX_SIZE = Math.floor(SCREEN_WIDTH * 0.70);

const MODEL_INPUT_WIDTH = 112;
const MODEL_INPUT_HEIGHT = 112;
const EMBEDDING_SIZE = 128;
const NORMALIZATION_EPSILON = 1e-12;

const ENROLLMENT_SAMPLE_TARGET = 10;
const SIMILARITY_THRESHOLD = 0.70;
const EYE_CLOSED_THRESHOLD = 0.25;
const EYE_OPEN_THRESHOLD = 0.65;

export default function UnifiedAttendanceCamera() {
  const device = useCameraDevice('front');
  const {hasPermission, requestPermission} = useCameraPermission();

  // Model & Resizer
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

  // App Modes: 'IDLE' | 'ENROLLING' | 'RECOGNIZING'
  const [mode, setMode] = useState('RECOGNIZING');
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [matchResult, setMatchResult] = useState(null);

  // Enrolled employees list loaded in memory
  const [employees, setEmployees] = useState([]);
  const employeesRef = useRef([]);

  // Modal State for saving new employee
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empId, setEmpId] = useState('');
  const [empDept, setEmpDept] = useState('');
  const pendingTemplateRef = useRef(null);

  // Liveness UI State
  const [faceStatus, setFaceStatus] = useState('NO FACE');
  const [livenessStatus, setLivenessStatus] = useState('ALIGN FACE');
  const [isLivenessVerified, setIsLivenessVerified] = useState(false);
  const [cooldownMessage, setCooldownMessage] = useState(null);

  // Thread-safe Refs for JS evaluation
  const modeRef = useRef('RECOGNIZING');
  const livenessVerifiedRef = useRef(false);
  const samplesRef = useRef([]);
  const isCooldownRef = useRef(false);

  // Blink state machines
  const eyesWereClosed = useRef(false);
  const closedFrameCount = useRef(0);
  const openFrameCount = useRef(0);
  const blinkCooldown = useRef(false);

  // Load existing employees on boot
  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    const list = await EmployeeStorage.getAllEmployees();
    setEmployees(list);
    employeesRef.current = list;
    console.log(`Loaded ${list.length} employees from storage.`);
  };

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    livenessVerifiedRef.current = isLivenessVerified;
  }, [isLivenessVerified]);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ============================================================
  // PHASE 1: ML KIT FACE DETECTION & LIVENESS GATE
  // ============================================================
  const handleFacesDetected = useCallback((faces) => {
    if (isCooldownRef.current || showRegisterModal) return;

    if (!Array.isArray(faces) || faces.length === 0) {
      setFaceStatus('NO FACE DETECTED');
      setLivenessStatus('ALIGN FACE IN BOX');
      setIsLivenessVerified(false);
      eyesWereClosed.current = false;
      closedFrameCount.current = 0;
      openFrameCount.current = 0;
      return;
    }

    if (faces.length > 1) {
      setFaceStatus('MULTIPLE FACES');
      setLivenessStatus('ONLY ONE PERSON ALLOWED');
      setIsLivenessVerified(false);
      return;
    }

    const face = faces[0];
    const yaw = typeof face.yawAngle === 'number' ? face.yawAngle : 0;

    if (Math.abs(yaw) > 15) {
      setFaceStatus(yaw > 15 ? 'TURNED RIGHT' : 'TURNED LEFT');
      setLivenessStatus('LOOK DIRECTLY AT CAMERA');
      setIsLivenessVerified(false);
      return;
    }

    setFaceStatus('FACE POSITION VALID');

    if (livenessVerifiedRef.current) {
      setLivenessStatus('LIVENESS VERIFIED');
      return;
    }

    setLivenessStatus('PLEASE BLINK TO VERIFY');

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

      if (
        eyesWereClosed.current &&
        openFrameCount.current >= 1 &&
        !blinkCooldown.current
      ) {
        console.log('👁️ NATURAL BLINK DETECTED');
        eyesWereClosed.current = false;
        blinkCooldown.current = true;
        setIsLivenessVerified(true);
        setLivenessStatus('LIVENESS VERIFIED');

        setTimeout(() => {
          blinkCooldown.current = false;
        }, 800);
      }
    }
  }, [showRegisterModal]);

  // ============================================================
  // PHASE 2: 1:N RECOGNITION & ENROLLMENT RECEIVER
  // ============================================================
  const handleEmbeddingFromWorklet = (embeddingArray) => {
    if (
      isCooldownRef.current ||
      !livenessVerifiedRef.current ||
      showRegisterModal
    ) {
      return;
    }

    const currentMode = modeRef.current;

    // --- ENROLLING MODE ---
    if (currentMode === 'ENROLLING') {
      samplesRef.current.push(new Float32Array(embeddingArray));
      const count = samplesRef.current.length;
      setEnrollProgress(count);

      if (count >= ENROLLMENT_SAMPLE_TARGET) {
        // Average 10 samples
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

        pendingTemplateRef.current = finalTemplate;
        samplesRef.current = [];
        setShowRegisterModal(true); // Open modal to name the employee
      }
    }

    // --- RECOGNITION MODE (1:N Matching) ---
    else if (currentMode === 'RECOGNIZING') {
      const currentEmployeeList = employeesRef.current;

      if (!currentEmployeeList || currentEmployeeList.length === 0) {
        setMatchResult({similarity: 0, isMatch: false, employee: null});
        return;
      }

      const liveVec = new Float32Array(embeddingArray);

      // Perform 1:N dot product search
      let bestMatch = null;
      let highestSim = -1;

      for (let e = 0; e < currentEmployeeList.length; e++) {
        const emp = currentEmployeeList[e];
        const storedTemplate = emp.template;

        let dot = 0;
        for (let i = 0; i < EMBEDDING_SIZE; i++) {
          dot += liveVec[i] * storedTemplate[i];
        }

        if (dot > highestSim) {
          highestSim = dot;
          bestMatch = emp;
        }
      }

      const isMatch = highestSim >= SIMILARITY_THRESHOLD && bestMatch != null;
      setMatchResult({
        similarity: highestSim,
        isMatch,
        employee: isMatch ? bestMatch : null,
      });

      if (isMatch) {
        triggerAttendanceSuccess(bestMatch, highestSim);
      }
    }
  };

  // Cooldown & Attendance Punch trigger
  const triggerAttendanceSuccess = async (employee, score) => {
    isCooldownRef.current = true;
    setCooldownMessage(
      `Welcome, ${employee.name}!\nAttendance Marked (${(score * 100).toFixed(0)}%)`,
    );

    // Save punch to local database
    await EmployeeStorage.logAttendancePunch({
      employeeId: employee.id,
      employeeName: employee.name,
      similarityScore: score,
    });

    setTimeout(() => {
      isCooldownRef.current = false;
      setIsLivenessVerified(false);
      setMatchResult(null);
      setCooldownMessage(null);
      setLivenessStatus('ALIGN FACE IN BOX');
    }, 4500);
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

  // Modal save handler
  const handleSaveEmployee = async () => {
    if (!empName.trim() || !empId.trim()) {
      Alert.alert('Required', 'Please enter Name and Employee ID');
      return;
    }

    try {
      await EmployeeStorage.saveEmployee({
        id: empId.trim(),
        name: empName.trim(),
        department: empDept.trim() || 'General',
        template: pendingTemplateRef.current,
      });

      await loadEmployees();
      setShowRegisterModal(false);
      setEmpName('');
      setEmpId('');
      setEmpDept('');
      pendingTemplateRef.current = null;
      setMode('RECOGNIZING');
      setIsLivenessVerified(false);
      Alert.alert('Success', 'Employee face registered successfully!');
    } catch {
      Alert.alert('Error', 'Failed to save employee profile.');
    }
  };

  const startEnrollment = () => {
    samplesRef.current = [];
    setMatchResult(null);
    setEnrollProgress(0);
    setIsLivenessVerified(false);
    setMode('ENROLLING');
  };

  const handleClearDatabase = () => {
    Alert.alert(
      'Reset Data',
      'Are you sure you want to delete all enrolled employees?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            await EmployeeStorage.clearAll();
            await loadEmployees();
          },
        },
      ],
    );
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
        runClassifications={true}
        runLandmarks={false}
        runContours={false}
        trackingEnabled={true}
        performanceMode="fast"
        onFacesDetected={handleFacesDetected}
      />

      {/* Visual Alignment Guide */}
      <View style={styles.guideContainer} pointerEvents="none">
        <View
          style={[
            styles.guideBox,
            isLivenessVerified ? styles.guideBoxVerified : styles.guideBoxDefault,
          ]}
        />
        <Text style={styles.guideStatusText}>{faceStatus}</Text>
      </View>

      {/* Floating Status Pill */}
      <View style={styles.pillContainer}>
        <View
          style={[
            styles.livenessPill,
            isLivenessVerified && styles.livenessPillVerified,
          ]}>
          <Text style={styles.livenessPillText}>{livenessStatus}</Text>
        </View>
      </View>

      {/* Attendance Punch Success Overlay */}
      {cooldownMessage && (
        <View style={styles.successModal}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successText}>{cooldownMessage}</Text>
        </View>
      )}

      {/* Bottom Controls */}
      <View style={styles.overlay}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Face Attendance Engine</Text>
          <Text style={styles.employeeCountBadge}>
            {employees.length} Enrolled
          </Text>
        </View>

        <Text style={styles.modeText}>Mode: {mode}</Text>

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
                  ? `MATCH: ${matchResult.employee?.name}`
                  : employees.length === 0
                  ? 'NO EMPLOYEES ENROLLED YET'
                  : 'SCANNING FOR EMPLOYEE...'}
              </Text>
              <Text style={styles.similarityText}>
                Similarity:{' '}
                {matchResult?.similarity
                  ? matchResult.similarity.toFixed(3)
                  : '--'}{' '}
                (Min: {SIMILARITY_THRESHOLD})
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  !isLivenessVerified && styles.buttonDisabled,
                ]}
                disabled={!isLivenessVerified}
                onPress={startEnrollment}>
                <Text style={styles.buttonText}>
                  {isLivenessVerified
                    ? '+ Add New Employee'
                    : 'Blink to Add Employee'}
                </Text>
              </TouchableOpacity>

              {employees.length > 0 && (
                <TouchableOpacity
                  style={styles.dangerButton}
                  onPress={handleClearDatabase}>
                  <Text style={styles.buttonText}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {mode === 'ENROLLING' && (
          <View style={styles.metricBox}>
            <Text style={styles.progressText}>
              Capturing verified face samples: {enrollProgress} /{' '}
              {ENROLLMENT_SAMPLE_TARGET}
            </Text>
            <TouchableOpacity
              style={[styles.secondaryButton, {marginTop: 10}]}
              onPress={() => setMode('RECOGNIZING')}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Employee Details Modal */}
      <Modal visible={showRegisterModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Register New Employee</Text>
            <Text style={styles.modalSub}>
              10 face samples captured successfully.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Full Name (e.g.  Kumar)"
              placeholderTextColor="#94a3b8"
              value={empName}
              onChangeText={setEmpName}
            />

            <TextInput
              style={styles.input}
              placeholder="Employee ID (e.g. EMP001)"
              placeholderTextColor="#94a3b8"
              value={empId}
              onChangeText={setEmpId}
              autoCapitalize="characters"
            />

            <TextInput
              style={styles.input}
              placeholder="Department (e.g. Operations)"
              placeholderTextColor="#94a3b8"
              value={empDept}
              onChangeText={setEmpDept}
            />

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowRegisterModal(false);
                  setMode('RECOGNIZING');
                }}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveEmployee}>
                <Text style={styles.buttonText}>Save Profile</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  guideBoxVerified: {
    borderColor: '#22c55e',
    borderWidth: 3,
  },
  guideStatusText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    marginTop: 10,
    fontWeight: '500',
  },
  pillContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  livenessPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#475569',
  },
  livenessPillVerified: {
    backgroundColor: '#166534',
    borderColor: '#22c55e',
  },
  livenessPillText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  successModal: {
    position: 'absolute',
    top: '32%',
    left: 30,
    right: 30,
    backgroundColor: '#15803d',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    elevation: 10,
  },
  successIcon: {
    color: '#fff',
    fontSize: 40,
    fontWeight: 'bold',
  },
  successText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 30,
    padding: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  employeeCountBadge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
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
  progressText: {
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
    fontSize: 16,
    fontWeight: '700',
  },
  similarityText: {
    color: '#e2e8f0',
    fontSize: 13,
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerButton: {
    backgroundColor: '#b91c1c',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
  },
  buttonDisabled: {
    backgroundColor: '#334155',
    opacity: 0.6,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSub: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#475569',
  },
  modalSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#16a34a',
  },
});