import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Vibration } from 'react-native';
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
import { Camera as CameraIcon } from 'lucide-react-native';

import { EmployeeStorage } from '../services/employeeStorage';
import {
  loadKioskSettings,
  listenForRemoteLogout,
  subscribeToLiveSettings,
} from '../services/kioskSettings';
import { FACE_CONFIG } from '../constants/faceConfig';
import { findBestFaceMatch, validateFacePose } from '../utils/faceEmbeddingUtils';
import FaceGuideBox from '../components/FaceGuideBox';
import SimpleLoading from '../components/SimpleLoading';
import ttsService from '../services/ttsService';

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

  useEffect(() => {
    if (modelPlugin.state === 'error') {
      console.error('[Attendance] TFLite model failed to load:', modelPlugin.error);
    } else if (modelPlugin.state === 'loaded') {
      console.log('[Attendance] TFLite model loaded successfully.');
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

  // State
  const [activeMatch, setActiveMatch] = useState(null);
  const [boxState, setBoxState] = useState('DEFAULT'); // 'DEFAULT' | 'ALIGNED' | 'IDENTIFIED' | 'MATCH' | 'WARNING'
  const boxStateRef = useRef('DEFAULT');
  const [promptText, setPromptText] = useState('Align your face inside the frame');
  const [liveFaceBounds, setLiveFaceBounds] = useState(null);
  const [multipleFaces, setMultipleFaces] = useState(false);

  const updateBoxState = useCallback((val) => {
    boxStateRef.current = val;
    setBoxState(val);
  }, []);

  // Synchronization refs for callbacks and worklets
  const lastFaceCenterRef = useRef({ x: 0, y: 0 });
  const steadyStartRef = useRef(0);
  const isSteadyRef = useRef(false);
  const employeesRef = useRef([]);
  const activeMatchRef = useRef(null);
  const liveSimilarityRef = useRef(0);
  const isCooldownRef = useRef(false);
  const isLockedRef = useRef(false);
  const thresholdRef = useRef(FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD);
  const livenessEnabledRef = useRef(true);
  const yawAngleToleranceRef = useRef(FACE_CONFIG.MAX_HEAD_YAW_DEGREES);
  const cooldownMinutesRef = useRef(FACE_CONFIG.PUNCH_COOLDOWN_MINUTES);
  const sessionVersionRef = useRef(1);
  const consecutiveMatchRef = useRef({ id: null, count: 0 });
  const lastCandidateRef = useRef({ id: null, timestamp: 0, count: 0, match: null, score: 0 });
  const triggerPunchRef = useRef(null);
  const employeePunchStateRef = useRef(new Map()); // Map of employeeId -> 'IN' | 'OUT'
  const lastValidFaceTimeRef = useRef(0);
  const lastPunchedEmployeeIdRef = useRef(null);
  const noFaceFramesCountRef = useRef(0);
  const lastDuplicateWarnTimeRef = useRef(new Map()); // Map of employeeId -> timestamp

  // Blink state machine refs
  const eyesWereClosed = useRef(false);
  const closedFrameCount = useRef(0);
  const openFrameCount = useRef(0);
  const blinkCooldown = useRef(false);

  const chimeSoundRef = useRef(null);

  // Setup sound effect & TTS lifecycle
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
      ttsService.stopTts();
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
    employeesRef.current = enrolledOnly;

    // 2. Refresh today's punch state map for all employees
    await refreshTodayPunchStates();

    // 3. Background sync from cloud in case web added new staff or updated embeddings
    EmployeeStorage.syncEmployeesFromCloud()
      .then(async (updatedList) => {
        const updatedEnrolled = updatedList.filter((e) => e.hasFace && e.template);
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

    thresholdRef.current = thresh;
    livenessEnabledRef.current = liveness;
    yawAngleToleranceRef.current = yaw;
    cooldownMinutesRef.current = cooldown;
    sessionVersionRef.current = sessionVer;
  }, []);

  const resetKiosk = useCallback((clearLastPunched = true) => {
    if (clearLastPunched) {
      lastPunchedEmployeeIdRef.current = null;
    }
    noFaceFramesCountRef.current = 0;
    isCooldownRef.current = false;
    isLockedRef.current = false;
    setActiveMatch(null);
    activeMatchRef.current = null;
    liveSimilarityRef.current = 0;
    updateBoxState('DEFAULT');
    setPromptText('Align your face inside the frame');
    setLiveFaceBounds(null);
    setMultipleFaces(false);
    steadyStartRef.current = 0;
    isSteadyRef.current = false;
    consecutiveMatchRef.current = { id: null, count: 0 };
    lastCandidateRef.current = { id: null, timestamp: 0, count: 0, match: null, score: 0 };
    eyesWereClosed.current = false;
    closedFrameCount.current = 0;
    openFrameCount.current = 0;
    blinkCooldown.current = false;
  }, [updateBoxState]);

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
  }, [isFocused, loadEmployeeProfiles, applyKioskSettings, resetKiosk]);

  // ============================================================
  // ATTENDANCE PUNCH EXECUTION (Local DB + Cloud + UI Lockout)
  // ============================================================
  const triggerAttendancePunch = async (employee, score) => {
    // If locked, in cooldown, or this exact employee already punched/debounced and is still lingering in front of kiosk
    if (isCooldownRef.current || isLockedRef.current) return;
    if (
      lastPunchedEmployeeIdRef.current &&
      String(lastPunchedEmployeeIdRef.current) === String(employee.id)
    ) {
      return;
    }

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

    // Immediately lock and clear candidate to prevent subsequent frames from re-triggering
    isCooldownRef.current = true;
    isLockedRef.current = true;
    lastCandidateRef.current = { id: null, timestamp: 0, count: 0, match: null, score: 0 };

    // 1. Query the last recorded punch for that employee for today
    const lastPunch = await EmployeeStorage.getLatestPunchToday(employee.id);
    const activeCooldownMins = cooldownMinutesRef.current || FACE_CONFIG.PUNCH_COOLDOWN_MINUTES || 2;
    const cooldownMs = activeCooldownMins * 60 * 1000;

    let isDuplicate = false;
    let elapsedMinutes = 1;

    if (lastPunch) {
      const lastPunchTime = new Date(lastPunch.timestamp).getTime();
      const diffMs = now - lastPunchTime;
      if (diffMs < cooldownMs) {
        isDuplicate = true;
        elapsedMinutes = Math.max(1, Math.round(diffMs / (60 * 1000)));
      }
    }

    // --- CASE A: Duplicate / Accidental Linger (< cooldown elapsed) ---
    if (isDuplicate) {
      // Mark as handled so lingering in front of kiosk produces ZERO further checks or audio
      lastPunchedEmployeeIdRef.current = String(employee.id);

      const lastType = lastPunch?.type || 'IN';
      const lastWarnTime = lastDuplicateWarnTimeRef.current.get(String(employee.id)) || 0;
      const shouldSpeak = (now - lastWarnTime) > 20000; // Speak duplicate warning at most once per 20 seconds

      let spokenText = '';
      if (shouldSpeak) {
        spokenText = ttsService.speakDuplicateWarning(employee.name, elapsedMinutes, lastType);
        lastDuplicateWarnTimeRef.current.set(String(employee.id), now);
        Vibration.vibrate(350);
      } else {
        const action = String(lastType).toUpperCase() === 'OUT' ? 'புறப்பாடு' : 'வருகை';
        spokenText = `ஏற்கனவே ${elapsedMinutes} நிமிடம் முன் ${action} பதிவு செய்யப்பட்டது. தயவுசெய்து காத்திருக்கவும்.`;
      }

      updateBoxState('WARNING');
      setPromptText(spokenText);

      console.warn(`[Attendance] Duplicate punch debounced for ${employee.name} (${lastType} ${elapsedMinutes}m ago)`);

      // Release internal lock after 3.5s so next employee can scan, but keep lingering employee protected until they walk away
      setTimeout(() => {
        isCooldownRef.current = false;
        isLockedRef.current = false;
      }, 3500);
      return;
    }

    // Mark as punched immediately so lingering in front of kiosk produces ZERO duplicate warnings
    lastPunchedEmployeeIdRef.current = String(employee.id);

    // Determine alternating punch status:
    // If employee has no punch today, or last was OUT -> Check-IN
    // If last was IN and cooldown has elapsed -> Check-OUT
    const isCheckIn = !lastPunch || String(lastPunch.type).toUpperCase() === 'OUT';
    const punchType = isCheckIn ? 'IN' : 'OUT';

    // Record new punch record with current timestamp
    const result = await EmployeeStorage.logAttendancePunch({
      employeeId: employee.id,
      employeeName: employee.name,
      department: employee.department,
      branchId: employee.branch_id || employee.branchId,
      cooldownMinutes: activeCooldownMins,
      similarityScore: score,
      forcedType: punchType,
    });

    const punch = result?.punch || {
      type: punchType,
      timestamp: new Date().toISOString(),
    };

    // Update in-memory punch status for this employee
    employeePunchStateRef.current.set(String(employee.id), punch.type);

    let spokenText = '';

    if (punch.type === 'IN') {
      // --- CASE B: Check-IN (Tamil Voice Announcement) ---
      spokenText = ttsService.speakCheckIn(employee.name, punch.timestamp);
    } else {
      // --- CASE C: Check-OUT (Tamil Voice Announcement with Work Duration) ---
      const punchInTimestamp =
        lastPunch && String(lastPunch.type).toUpperCase() === 'IN'
          ? lastPunch.timestamp
          : null;
      spokenText = ttsService.speakCheckOut(
        employee.name,
        punch.timestamp,
        punchInTimestamp,
      );
    }

    // Audio & Haptic confirmation
    Vibration.vibrate([0, 70, 50, 70]);
    if (chimeSoundRef.current) {
      chimeSoundRef.current.stop(() => {
        chimeSoundRef.current.play((success) => {
          if (!success) chimeSoundRef.current.reset();
        });
      });
    }

    // Synchronize UI on-screen pill text with exact TTS utterance
    updateBoxState('MATCH');
    setPromptText(spokenText);

    console.log(`[Attendance] ✓ Verified: ${employee.name} | Type: ${punch.type} | Score: ${(score * 100).toFixed(1)}% | TTS: "${spokenText}"`);

    // Lockout scanner for 4 seconds, then release lock so subsequent employees in queue can scan,
    // while lastPunchedEmployeeIdRef keeps protecting this lingering employee until they walk away.
    setTimeout(() => {
      isCooldownRef.current = false;
      isLockedRef.current = false;
    }, 4000);
  };

  triggerPunchRef.current = triggerAttendancePunch;

  // ============================================================
  // PHASE 1: ML KIT FACE DETECTION, POSE & BLINK LIVENESS
  // ============================================================
  const handleFacesDetected = useCallback(
    (faces) => {
      if (!isFocused) return;

      // Walk-away detection: count consecutive frames with no face
      if (!faces || faces.length === 0) {
        noFaceFramesCountRef.current += 1;
        // If no face has been seen for ~1.2 seconds (>= 15 frames)
        if (noFaceFramesCountRef.current >= 15) {
          if (lastPunchedEmployeeIdRef.current !== null || boxStateRef.current !== 'DEFAULT') {
            resetKiosk(true);
          }
        }
        return;
      }

      // Reset empty frame counter when any face is detected
      noFaceFramesCountRef.current = 0;

      // 1. Multi-face check
      if (faces && faces.length > 1) {
        setMultipleFaces(true);
        setLiveFaceBounds(null);
        isSteadyRef.current = false;
        steadyStartRef.current = 0;
        updateBoxState('WARNING');
        setPromptText('Please ensure only one person is in front of the camera');
        setActiveMatch(null);
        activeMatchRef.current = null;
        eyesWereClosed.current = false;
        closedFrameCount.current = 0;
        openFrameCount.current = 0;
        return;
      }
      setMultipleFaces(false);

      const validation = validateFacePose(faces, {
        maxYaw: yawAngleToleranceRef.current || FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
        maxPitch: FACE_CONFIG.MAX_HEAD_PITCH_DEGREES,
        maxRoll: FACE_CONFIG.MAX_HEAD_ROLL_DEGREES,
        minBoxSize: FACE_CONFIG.MIN_FACE_BOX_SIZE,
      });

      if (!validation.isValid) {
        const now = Date.now();
        if (now - lastValidFaceTimeRef.current > 1500) {
          // If face turned away or walked out for > 1.5 seconds, reset lingering punch lock
          if (lastPunchedEmployeeIdRef.current !== null) {
            resetKiosk(true);
            return;
          }
        }
        if (now - lastValidFaceTimeRef.current > 250 && lastPunchedEmployeeIdRef.current === null) {
          setLiveFaceBounds(null);
          isSteadyRef.current = false;
          steadyStartRef.current = 0;
          updateBoxState(validation.status === 'NO_FACE' ? 'DEFAULT' : 'WARNING');
          setPromptText(validation.status === 'NO_FACE' ? 'Align your face inside the frame' : validation.message);
          setActiveMatch(null);
          activeMatchRef.current = null;
        }
        eyesWereClosed.current = false;
        closedFrameCount.current = 0;
        openFrameCount.current = 0;
        return;
      }

      lastValidFaceTimeRef.current = Date.now();
      const face = validation.face;
      setLiveFaceBounds(face.bounds || null);

      // If this face belongs to the employee who just punched or was duplicate-debounced,
      // keep tracking the face bounding box [ ] in green, but bypass blink and punch logic.
      if (lastPunchedEmployeeIdRef.current !== null) {
        return;
      }

      // If kiosk is in cooldown or locked for an in-flight operation, stop here
      if (isCooldownRef.current || isLockedRef.current) return;

      // Steady face tracking gate (>= 300ms)
      const now = Date.now();
      const faceBounds = face.bounds || {};
      const centerX = (faceBounds.x || 0) + (faceBounds.width || 0) / 2;
      const centerY = (faceBounds.y || 0) + (faceBounds.height || 0) / 2;
      const prev = lastFaceCenterRef.current;
      const displacement = Math.hypot(centerX - prev.x, centerY - prev.y);

      if (displacement < 24) {
        if (steadyStartRef.current === 0) {
          steadyStartRef.current = now;
        } else if (now - steadyStartRef.current >= 300) {
          isSteadyRef.current = true;
        }
      } else {
        steadyStartRef.current = now;
        isSteadyRef.current = false;
      }
      lastFaceCenterRef.current = { x: centerX, y: centerY };

      const currentMatchedEmp = activeMatchRef.current;

      if (currentMatchedEmp) {
        updateBoxState('IDENTIFIED');
        
        // Check current punch status to tell user whether they are checking IN or checking OUT
        const currentPunchType = employeePunchStateRef.current.get(String(currentMatchedEmp.id)) || 'OUT';
        const nextAction = currentPunchType === 'IN' ? 'Check OUT' : 'Check IN';

        if (!livenessEnabledRef.current) {
          setPromptText(`Hi ${currentMatchedEmp.name}! Processing ${nextAction}...`);
        } else {
          setPromptText(`Hi ${currentMatchedEmp.name}! Blink to ${nextAction}`);
        }
      } else if (employeesRef.current.length === 0) {
        updateBoxState('DEFAULT');
        setPromptText('No Enrolled Employees Locally');
        return;
      } else {
        updateBoxState('ALIGNED');
        setPromptText(isSteadyRef.current ? 'Hold still...' : 'Scanning Face...');
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
    [isFocused, resetKiosk, updateBoxState],
  );

  // ============================================================
  // PHASE 2: CONTINUOUS 1:N RECOGNITION (MobileFaceNet 512-D Embedding)
  // ============================================================
  const handleEmbeddingFromWorklet = (embeddingArray) => {
    if (!isFocused) return;

    const currentList = employeesRef.current;
    if (!currentList || currentList.length === 0) {
      setActiveMatch(null);
      activeMatchRef.current = null;
      lastCandidateRef.current = { id: null, timestamp: 0, count: 0, match: null, score: 0 };
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

    // Lingering face check:
    // If the recognized face is the employee who just punched or was duplicate debounced:
    if (bestMatch && lastPunchedEmployeeIdRef.current !== null) {
      if (String(bestMatch.id) === String(lastPunchedEmployeeIdRef.current)) {
        // Same employee lingering in front of kiosk: suppress completely
        return;
      } else if (isMatch && similarityScore >= currentThreshold) {
        // A NEW, different employee (Person B) has stepped up!
        // Release the lingering lock immediately for Person B!
        lastPunchedEmployeeIdRef.current = null;
        isCooldownRef.current = false;
        isLockedRef.current = false;
      }
    }

    // If kiosk is in cooldown or locked for an in-flight operation, stop here
    if (isCooldownRef.current || isLockedRef.current) return;

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
          runLandmarks={false}
          performanceMode="fast"
          onFacesDetected={handleFacesDetected}
        />
      )}

      {/* Reusable Guide Overlay & Guidance Pill (Plain camera with dynamic brackets [ ]) */}
      <FaceGuideBox
        boxState={boxState}
        promptText={promptText}
        showReticle={true}
        faceBounds={liveFaceBounds}
        isIdentified={Boolean(activeMatch)}
        multipleFacesDetected={multipleFaces}
      />
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
});
