import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, Vibration } from 'react-native';
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
import { useIsFocused } from '@react-navigation/native';
import Sound from 'react-native-sound';
import { Users, UserCheck, ScanFace, Camera as CameraIcon } from 'lucide-react-native';

import { EmployeeStorage } from '../services/employeeStorage';
import {
  loadKioskSettings,
  listenForRemoteLogout,
  subscribeToLiveSettings,
} from '../services/kioskSettings';
import { FACE_CONFIG } from '../constants/faceConfig';
import { findBestFaceMatch, validateFacePose } from '../utils/faceEmbeddingUtils';
import FaceGuideBox from '../components/FaceGuideBox';
import AttendanceResultModal from '../components/AttendanceResultModal';
import SimpleLoading from '../components/SimpleLoading';

export default function AttendanceScreen() {
  const isFocused = useIsFocused();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();

  // ML Model & Frame Resizer
  const modelPlugin = useTensorflowModel(
    require('../assets/models/mobile_facenet.tflite'),
    [],
  );
  const model = modelPlugin.state === 'loaded' ? modelPlugin.model : null;
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : null),
    [model],
  );

  const { resizer } = useResizer({
    width: FACE_CONFIG.MODEL_INPUT_WIDTH,
    height: FACE_CONFIG.MODEL_INPUT_HEIGHT,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'cover',
  });

  // State
  const [employees, setEmployees] = useState([]);
  const [activeMatch, setActiveMatch] = useState(null);
  const [liveSimilarity, setLiveSimilarity] = useState(0);
  const [boxState, setBoxState] = useState('DEFAULT'); // 'DEFAULT' | 'ALIGNED' | 'IDENTIFIED' | 'MATCH' | 'WARNING'
  const [promptText, setPromptText] = useState('Position Face in Box');
  const [punchSuccess, setPunchSuccess] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [threshold, setThreshold] = useState(FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD);

  // Synchronization refs for callbacks and worklets
  const employeesRef = useRef([]);
  const activeMatchRef = useRef(null);
  const liveSimilarityRef = useRef(0);
  const isCooldownRef = useRef(false);
  const thresholdRef = useRef(FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD);
  const livenessEnabledRef = useRef(true);
  const yawAngleToleranceRef = useRef(FACE_CONFIG.MAX_HEAD_YAW_DEGREES);
  const cooldownMinutesRef = useRef(FACE_CONFIG.PUNCH_COOLDOWN_MINUTES);
  const sessionVersionRef = useRef(1);
  const consecutiveMatchRef = useRef({ id: null, count: 0 });
  const lastCandidateRef = useRef({ id: null, timestamp: 0, count: 0, match: null, score: 0 });
  const triggerPunchRef = useRef(null);
  const employeePunchStateRef = useRef(new Map()); // Map of employeeId -> 'IN' | 'OUT'

  // Blink state machine refs
  const eyesWereClosed = useRef(false);
  const closedFrameCount = useRef(0);
  const openFrameCount = useRef(0);
  const blinkCooldown = useRef(false);

  const chimeSoundRef = useRef(null);

  // Setup sound effect
  useEffect(() => {
    const chime = new Sound('alert.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.warn('[Sound] Sound file not found or failed to load:', error);
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

  // Request camera permissions if needed
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const refreshTodayPunchStates = useCallback(async () => {
    try {
      const logs = await EmployeeStorage.getAttendanceLogs();
      const todayDateStr = new Date().toDateString();
      const stateMap = new Map();

      // Sort logs ascending so later logs overwrite earlier ones
      const sortedAsc = [...logs].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      for (const log of sortedAsc) {
        if (new Date(log.timestamp).toDateString() === todayDateStr && log.employeeId) {
          stateMap.set(String(log.employeeId), String(log.type || 'IN').toUpperCase());
        }
      }

      employeePunchStateRef.current = stateMap;
    } catch {
      // Non-blocking
    }
  }, []);

  const loadEmployeeProfiles = useCallback(async () => {
    // 1. Fast load from local storage
    const localList = await EmployeeStorage.getAllEmployees();
    const enrolledOnly = localList.filter((e) => e.hasFace && e.template);
    setEmployees(enrolledOnly);
    employeesRef.current = enrolledOnly;

    // 2. Refresh today's punch state map for all employees
    await refreshTodayPunchStates();

    // 3. Background sync from cloud in case web added new staff or updated embeddings
    EmployeeStorage.syncEmployeesFromCloud()
      .then(async (updatedList) => {
        const updatedEnrolled = updatedList.filter((e) => e.hasFace && e.template);
        setEmployees(updatedEnrolled);
        employeesRef.current = updatedEnrolled;
        await refreshTodayPunchStates();
      })
      .catch((e) => console.log('[AttendanceScreen] Cloud sync non-critical warning:', e));
  }, [refreshTodayPunchStates]);

  // Apply live kiosk settings helper
  const applyKioskSettings = useCallback((cfg) => {
    if (!cfg) return;
    const thresh = Number(cfg.similarityThreshold ?? FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD);
    const liveness = cfg.antiSpoofing !== undefined ? Boolean(cfg.antiSpoofing) : Boolean(cfg.requireBlink ?? true);
    const yaw = Number(cfg.yawTolerance ?? FACE_CONFIG.MAX_HEAD_YAW_DEGREES);
    const cooldown = Number(cfg.doublePunchLockout ?? FACE_CONFIG.PUNCH_COOLDOWN_MINUTES);
    const sessionVer = Number(cfg.sessionVersion ?? 1);

    setThreshold(thresh);
    thresholdRef.current = thresh;
    livenessEnabledRef.current = liveness;
    yawAngleToleranceRef.current = yaw;
    cooldownMinutesRef.current = cooldown;
    sessionVersionRef.current = sessionVer;
  }, []);

  // Reload employee profiles & live DB config when screen gains focus, plus real-time listeners
  useEffect(() => {
    if (!isFocused) return;

    loadEmployeeProfiles();
    resetKiosk();

    // 1. Initial live configuration fetch from DB
    loadKioskSettings().then((cfg) => {
      applyKioskSettings(cfg);
    });

    // 2. Subscribe to real-time configuration changes from Web Dashboard
    const liveSettingsSub = subscribeToLiveSettings((updated) => {
      console.log('[AttendanceScreen] Applying updated live settings from dashboard:', updated);
      applyKioskSettings(updated);
    });

    // 3. Subscribe to remote security logout
    const remoteLogoutSub = listenForRemoteLogout(sessionVersionRef.current, () => {
      console.warn('[AttendanceScreen] Remote logout event received');
      resetKiosk();
    });

    return () => {
      if (liveSettingsSub?.unsubscribe) liveSettingsSub.unsubscribe();
      if (remoteLogoutSub?.unsubscribe) remoteLogoutSub.unsubscribe();
    };
  }, [isFocused, loadEmployeeProfiles, applyKioskSettings]);

  const resetKiosk = () => {
    isCooldownRef.current = false;
    setActiveMatch(null);
    activeMatchRef.current = null;
    setLiveSimilarity(0);
    liveSimilarityRef.current = 0;
    setBoxState('DEFAULT');
    setPromptText('Position Face in Box');
    setPunchSuccess(null);
    setDuplicateWarning(null);
    consecutiveMatchRef.current = { id: null, count: 0 };
    lastCandidateRef.current = { id: null, timestamp: 0, count: 0, match: null, score: 0 };
    eyesWereClosed.current = false;
    closedFrameCount.current = 0;
    openFrameCount.current = 0;
    blinkCooldown.current = false;
  };

  // ============================================================
  // ATTENDANCE PUNCH EXECUTION (Local DB + Cloud + UI Lockout)
  // ============================================================
  const triggerAttendancePunch = async (employee, score) => {
    if (isCooldownRef.current) return;

    // Strict 2-frame consensus gate: 2 consecutive frames within 400ms with similarity >= live threshold
    const candidate = lastCandidateRef.current;
    const now = Date.now();
    const requiredThreshold = thresholdRef.current || FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD;
    const isConsensusValid =
      candidate.id &&
      String(candidate.id) === String(employee.id) &&
      candidate.count >= 2 &&
      (now - candidate.timestamp) <= 400 &&
      score >= requiredThreshold;

    if (!isConsensusValid) {
      console.warn('[Attendance] Blocked punch: 2-frame consensus not verified within 400ms');
      return;
    }

    isCooldownRef.current = true;

    // 1. Record punch in storage (evaluates duplicate lockout & alternates strictly IN -> OUT -> IN)
    const result = await EmployeeStorage.logAttendancePunch({
      employeeId: employee.id,
      employeeName: employee.name,
      department: employee.department,
      branchId: employee.branch_id || employee.branchId,
      cooldownMinutes: cooldownMinutesRef.current,
      similarityScore: score,
    });

    // --- CASE A: DUPLICATE PUNCH (< 2 minutes) ---
    if (result.status === 'DUPLICATE_BLOCKED') {
      Vibration.vibrate(350);
      setBoxState('WARNING');
      setPromptText(`Already Punched ${result.lastType}!`);

      setDuplicateWarning({
        name: result.employeeName,
        lastType: result.lastType,
        waitSeconds: result.waitSeconds,
      });

      setTimeout(() => {
        resetKiosk();
      }, FACE_CONFIG.PUNCH_DUPLICATE_LOCKOUT_MS);
      return;
    }

    // --- CASE B: SUCCESSFUL VERIFICATION & PUNCH (IN / OUT) ---
    Vibration.vibrate([0, 70, 50, 70]);

    if (chimeSoundRef.current) {
      chimeSoundRef.current.stop(() => {
        chimeSoundRef.current.play((success) => {
          if (!success) chimeSoundRef.current.reset();
        });
      });
    }

    const punch = result.punch;
    
    // Update in-memory punch status for this employee
    employeePunchStateRef.current.set(String(employee.id), punch.type);

    setBoxState('MATCH');
    setPromptText(`${employee.name}: PRESENT (Checked ${punch.type})!`);

    setPunchSuccess({
      name: employee.name,
      id: employee.id,
      department: employee.department || 'Staff',
      type: punch.type,
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      score: (score * 100).toFixed(0),
    });

    console.log(`[Attendance] ✓ Verified: ${employee.name} | Type: ${punch.type} | Score: ${(score * 100).toFixed(1)}%`);

    // Lockout period before returning to search mode
    setTimeout(() => {
      resetKiosk();
    }, FACE_CONFIG.PUNCH_SUCCESS_LOCKOUT_MS);
  };

  triggerPunchRef.current = triggerAttendancePunch;

  // ============================================================
  // PHASE 1: ML KIT FACE DETECTION, POSE & BLINK LIVENESS
  // ============================================================
  const handleFacesDetected = useCallback(
    (faces) => {
      if (isCooldownRef.current || !isFocused) return;

      const validation = validateFacePose(faces, {
        maxYaw: yawAngleToleranceRef.current || FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
        maxPitch: FACE_CONFIG.MAX_HEAD_PITCH_DEGREES,
        maxRoll: FACE_CONFIG.MAX_HEAD_ROLL_DEGREES,
        minBoxSize: FACE_CONFIG.MIN_FACE_BOX_SIZE,
      });

      if (!validation.isValid) {
        setBoxState(validation.status === 'NO_FACE' ? 'DEFAULT' : 'WARNING');
        setPromptText(validation.message);
        setActiveMatch(null);
        activeMatchRef.current = null;
        eyesWereClosed.current = false;
        closedFrameCount.current = 0;
        openFrameCount.current = 0;
        return;
      }

      const face = validation.face;
      const currentMatchedEmp = activeMatchRef.current;

      if (currentMatchedEmp) {
        setBoxState('IDENTIFIED');
        
        // Check current punch status to tell user whether they are checking IN or checking OUT
        const currentPunchType = employeePunchStateRef.current.get(String(currentMatchedEmp.id)) || 'OUT';
        const nextAction = currentPunchType === 'IN' ? 'Check OUT' : 'Check IN';

        if (!livenessEnabledRef.current) {
          setPromptText(`Hi ${currentMatchedEmp.name}! Processing ${nextAction}...`);
        } else {
          setPromptText(`Hi ${currentMatchedEmp.name}! Blink to ${nextAction}`);
        }
      } else if (employeesRef.current.length === 0) {
        setBoxState('DEFAULT');
        setPromptText('No Enrolled Employees Locally');
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
        leftEye < FACE_CONFIG.EYE_CLOSED_THRESHOLD &&
        rightEye < FACE_CONFIG.EYE_CLOSED_THRESHOLD;
      const eyesOpen =
        leftEye > FACE_CONFIG.EYE_OPEN_THRESHOLD &&
        rightEye > FACE_CONFIG.EYE_OPEN_THRESHOLD;

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
          eyesWereClosed.current = false;
          blinkCooldown.current = true;

          // If face is identified with 2-frame consensus within 400ms when blink completes -> Stamp attendance
          const candidate = lastCandidateRef.current;
          const now = Date.now();
          const requiredThreshold = thresholdRef.current || FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD;
          const hasConsensus =
            candidate.id != null &&
            candidate.count >= 2 &&
            (now - candidate.timestamp) <= 400 &&
            candidate.score >= requiredThreshold;

          const targetEmp = hasConsensus ? candidate.match : currentMatchedEmp;

          if (targetEmp && hasConsensus && triggerPunchRef.current) {
            triggerPunchRef.current(
              targetEmp,
              candidate.score || liveSimilarityRef.current,
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
  // PHASE 2: CONTINUOUS 1:N RECOGNITION (MobileFaceNet 512-D Embedding)
  // ============================================================
  const handleEmbeddingFromWorklet = (embeddingArray) => {
    if (isCooldownRef.current || !isFocused) return;

    const currentList = employeesRef.current;
    if (!currentList || currentList.length === 0) {
      setActiveMatch(null);
      activeMatchRef.current = null;
      lastCandidateRef.current = { id: null, timestamp: 0, count: 0, match: null, score: 0 };
      setLiveSimilarity(0);
      liveSimilarityRef.current = 0;
      return;
    }

    const currentThreshold = thresholdRef.current || FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD;

    // Fast 1:N vector cosine similarity verification with margin check (using live threshold from DB)
    const { bestMatch, similarityScore, isMatch, isAmbiguous } = findBestFaceMatch(
      embeddingArray,
      currentList,
      currentThreshold,
      FACE_CONFIG.MIN_MATCH_MARGIN || 0.08,
    );

    liveSimilarityRef.current = similarityScore;
    setLiveSimilarity(similarityScore);

    const now = Date.now();

    // 2-frame consensus voting logic:
    // Only confirm identification if two consecutive frames within 400ms identify the exact same employee ID with similarity >= currentThreshold
    if (isMatch && bestMatch != null && similarityScore >= currentThreshold) {
      const prev = lastCandidateRef.current;
      const isSameCandidate = prev.id === bestMatch.id;
      const isWithin400ms = (now - prev.timestamp) <= 400;

      if (isSameCandidate && isWithin400ms) {
        const newCount = prev.count + 1;
        lastCandidateRef.current = {
          id: bestMatch.id,
          timestamp: now,
          count: newCount,
          match: bestMatch,
          score: similarityScore,
        };

        if (newCount >= 2) {
          setActiveMatch(bestMatch);
          activeMatchRef.current = bestMatch;

          // If Liveness (blink) is turned off, punch immediately upon 2-frame consensus
          if (!livenessEnabledRef.current && triggerPunchRef.current) {
            triggerPunchRef.current(bestMatch, similarityScore);
          }
        }
      } else {
        lastCandidateRef.current = {
          id: bestMatch.id,
          timestamp: now,
          count: 1,
          match: bestMatch,
          score: similarityScore,
        };
      }
    } else {
      if (now - lastCandidateRef.current.timestamp > 400) {
        lastCandidateRef.current = { id: null, timestamp: 0, count: 0, match: null, score: 0 };
        setActiveMatch(null);
        activeMatchRef.current = null;
      }
      if (isAmbiguous) {
        setPromptText('Multiple Similar Faces - Align Steadily');
      }
    }
  };

  // ============================================================
  // WORKLET PIPELINE (Camera Frames -> TFLite -> 512-D Embeddings)
  // ============================================================
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

  if (!hasPermission || !device) {
    return (
      <View style={styles.center}>
        <CameraIcon size={46} color="#475569" style={{ marginBottom: 14 }} />
        <SimpleLoading
          size="medium"
          text={!hasPermission ? 'Camera Permission Required' : 'Initializing Biometric Sensor...'}
          subtext={
            !hasPermission
              ? 'Please grant camera access to use kiosk attendance'
              : 'Warming up front camera & face recognition engine'
          }
        />
      </View>
    );
  }

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

      {/* Reusable Guide Overlay & Guidance Pill */}
      <FaceGuideBox
        boxState={boxState}
        promptText={promptText}
        subText="Keep face steady inside frame"
        isIdentified={Boolean(activeMatch)}
      />

      {/* Reusable Attendance Verification Modal (IN / OUT / Duplicate) */}
      <AttendanceResultModal
        punchSuccess={punchSuccess}
        duplicateWarning={duplicateWarning}
      />

      {/* Bottom Live Metrics & Enrolled Database Status */}
      <View style={styles.overlay}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Attendance Kiosk</Text>
          <View style={styles.employeeBadgeRow}>
            <Users size={12} color="#38bdf8" />
            <Text style={styles.employeeBadgeText}>{employees.length} Enrolled</Text>
          </View>
        </View>

        <View
          style={[
            styles.matchCard,
            activeMatch ? styles.cardMatch : styles.cardWaiting,
          ]}>
          <View style={styles.matchTitleRow}>
            {activeMatch ? (
              <UserCheck size={16} color="#38bdf8" />
            ) : (
              <ScanFace size={16} color="#94a3b8" />
            )}
            <Text style={styles.matchTitle}>
              {activeMatch
                ? `IDENTIFIED: ${activeMatch.name.toUpperCase()}`
                : employees.length === 0
                ? 'NO ENROLLED EMPLOYEES LOCALLY'
                : 'SEARCHING LOCAL DATABASE...'}
            </Text>
          </View>

          <Text style={styles.similarityText}>
            Match Score: {(liveSimilarity * 100).toFixed(0)}% (Threshold:{' '}
            {(threshold * 100).toFixed(0)}%)
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  center: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
  },
  overlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 22,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  employeeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  employeeBadgeText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
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
  matchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  matchTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  similarityText: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
});
