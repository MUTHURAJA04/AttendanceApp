import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import {
  Camera,
  Face,
} from 'react-native-vision-camera-face-detector';

type FaceDetectionCameraProps = {
  onLivenessVerified?: () => void;
};

export default function FaceDetectionCamera({
  onLivenessVerified,
}: FaceDetectionCameraProps) {
  const device = useCameraDevice('front');
  const {hasPermission, requestPermission} = useCameraPermission();

  const [faceCount, setFaceCount] = useState(0);
  const [faceStatus, setFaceStatus] = useState('NO FACE');

  const [blinkStatus, setBlinkStatus] = useState('EYES OPEN');
  const [blinkCount, setBlinkCount] = useState(0);

  const [leftEyeOpen, setLeftEyeOpen] = useState(0);
  const [rightEyeOpen, setRightEyeOpen] = useState(0);

  // Liveness state
  const [livenessVerified, setLivenessVerified] = useState(false);
  const [livenessStatus, setLivenessStatus] =
    useState('WAITING FOR FACE');

  const lastLoggedState = useRef('');

  // -----------------------------------------
  // BLINK STATE
  // -----------------------------------------

  const eyesWereClosed = useRef(false);
  const closedFrameCount = useRef(0);
  const openFrameCount = useRef(0);
  const blinkCooldown = useRef(false);

  // -----------------------------------------
  // LIVENESS STATE
  // -----------------------------------------

  const hasValidFace = useRef(false);
  const isLookingAtCamera = useRef(false);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const handleFacesDetected = (faces: Face[]) => {
    // -----------------------------------------
    // NO FACE
    // -----------------------------------------

    if (!Array.isArray(faces) || faces.length === 0) {
      setFaceCount(0);
      setFaceStatus('NO FACE');
      setBlinkStatus('NO FACE');

      setLeftEyeOpen(0);
      setRightEyeOpen(0);

      hasValidFace.current = false;
      isLookingAtCamera.current = false;

      setLivenessVerified(false);
      setLivenessStatus('WAITING FOR FACE');

      eyesWereClosed.current = false;
      closedFrameCount.current = 0;
      openFrameCount.current = 0;
      blinkCooldown.current = false;

      if (lastLoggedState.current !== 'NO_FACE') {
        console.log('FACE: NO FACE');
        lastLoggedState.current = 'NO_FACE';
      }

      return;
    }

    // -----------------------------------------
    // MULTIPLE FACES
    // -----------------------------------------

    setFaceCount(faces.length);

    if (faces.length > 1) {
      setFaceStatus('MULTIPLE FACES');

      setLivenessVerified(false);
      setLivenessStatus('ONLY ONE FACE ALLOWED');

      hasValidFace.current = false;
      isLookingAtCamera.current = false;

      eyesWereClosed.current = false;
      closedFrameCount.current = 0;
      openFrameCount.current = 0;

      if (lastLoggedState.current !== 'MULTIPLE_FACES') {
        console.log(
          `FACE: MULTIPLE | COUNT: ${faces.length}`,
        );

        lastLoggedState.current = 'MULTIPLE_FACES';
      }

      return;
    }

    // -----------------------------------------
    // ONE FACE
    // -----------------------------------------

    const face = faces[0];

    const yaw =
      typeof face.yawAngle === 'number'
        ? face.yawAngle
        : 0;

    const roll =
      typeof face.rollAngle === 'number'
        ? face.rollAngle
        : 0;

    // -----------------------------------------
    // FACE DIRECTION
    // -----------------------------------------

    let side = 'CENTER';

    if (yaw > 15) {
      side = 'RIGHT';
    } else if (yaw < -15) {
      side = 'LEFT';
    }

    const lookingAtCamera =
      Math.abs(yaw) <= 15;

    isLookingAtCamera.current = lookingAtCamera;

    // -----------------------------------------
    // EYE PROBABILITIES
    // -----------------------------------------

    const leftEye =
      typeof face.leftEyeOpenProbability === 'number'
        ? face.leftEyeOpenProbability
        : 0;

    const rightEye =
      typeof face.rightEyeOpenProbability === 'number'
        ? face.rightEyeOpenProbability
        : 0;

    setLeftEyeOpen(leftEye);
    setRightEyeOpen(rightEye);

    // -----------------------------------------
    // FACE STATUS
    // -----------------------------------------

    let currentFaceStatus =
      'FACE LOOKING AT CAMERA';

    if (side === 'LEFT') {
      currentFaceStatus = 'FACE TURNED LEFT';
    } else if (side === 'RIGHT') {
      currentFaceStatus = 'FACE TURNED RIGHT';
    }

    setFaceStatus(currentFaceStatus);

    // -----------------------------------------
    // LIVENESS FACE VALIDATION
    // -----------------------------------------

    if (!lookingAtCamera) {
      hasValidFace.current = false;

      setLivenessVerified(false);
      setLivenessStatus('PLEASE LOOK AT CAMERA');
    } else {
      hasValidFace.current = true;

      if (!livenessVerified) {
        setLivenessStatus('BLINK TO VERIFY');
      }
    }

    // -----------------------------------------
    // EYE STATE
    // -----------------------------------------

    const EYE_CLOSED_THRESHOLD = 0.25;

    const eyesClosed =
      leftEye < EYE_CLOSED_THRESHOLD &&
      rightEye < EYE_CLOSED_THRESHOLD;

    // -----------------------------------------
    // REAL BLINK DETECTION
    // OPEN -> CLOSED -> OPEN
    // -----------------------------------------

    if (eyesClosed) {
      closedFrameCount.current += 1;
      openFrameCount.current = 0;

      if (closedFrameCount.current >= 2) {
        eyesWereClosed.current = true;
      }

      setBlinkStatus('EYES CLOSED');
    } else {
      openFrameCount.current += 1;
      closedFrameCount.current = 0;

      if (
        eyesWereClosed.current &&
        openFrameCount.current >= 2 &&
        !blinkCooldown.current
      ) {
        setBlinkCount(prev => prev + 1);

        setBlinkStatus('BLINK DETECTED');

        console.log('👁️ BLINK DETECTED');

        eyesWereClosed.current = false;

        blinkCooldown.current = true;

        // -----------------------------------------
        // LIVENESS VERIFIED
        // -----------------------------------------

        if (
          hasValidFace.current &&
          isLookingAtCamera.current
        ) {
          setLivenessVerified(true);
          setLivenessStatus('LIVENESS VERIFIED');

          console.log('✅ LIVENESS VERIFIED');

          // Notify parent
          onLivenessVerified?.();
        }

        setTimeout(() => {
          blinkCooldown.current = false;
        }, 500);
      } else if (!blinkCooldown.current) {
        setBlinkStatus('EYES OPEN');
      }
    }

    // -----------------------------------------
    // LOGGING
    // -----------------------------------------

    const currentEyeState = eyesClosed
      ? 'CLOSED'
      : 'OPEN';

    const currentState =
      `${side}_${currentEyeState}`;

    if (lastLoggedState.current !== currentState) {
      console.log(
        `FACE: YES | ` +
          `COUNT: ${faces.length} | ` +
          `SIDE: ${side} | ` +
          `YAW: ${yaw.toFixed(1)}° | ` +
          `ROLL: ${roll.toFixed(1)}° | ` +
          `LEFT EYE: ${leftEye.toFixed(2)} | ` +
          `RIGHT EYE: ${rightEye.toFixed(2)} | ` +
          `EYES: ${eyesClosed ? 'CLOSED' : 'OPEN'}`,
      );

      lastLoggedState.current = currentState;
    }
  };

  // -----------------------------------------
  // PERMISSION
  // -----------------------------------------

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          Awaiting Camera Permission...
        </Text>
      </View>
    );
  }

  // -----------------------------------------
  // DEVICE
  // -----------------------------------------

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          Front camera not found
        </Text>
      </View>
    );
  }

  // -----------------------------------------
  // CAMERA UI
  // -----------------------------------------

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        runClassifications={true}
        runLandmarks={true}
        runContours={false}
        trackingEnabled={true}
        performanceMode="fast"
        onFacesDetected={handleFacesDetected}
      />

      <View style={styles.overlay}>
        <Text style={styles.count}>
          Faces detected: {faceCount}
        </Text>

        <Text style={styles.status}>
          {faceStatus}
        </Text>

        <Text style={styles.eyeText}>
          LEFT EYE: {leftEyeOpen.toFixed(2)}
        </Text>

        <Text style={styles.eyeText}>
          RIGHT EYE: {rightEyeOpen.toFixed(2)}
        </Text>

        <Text style={styles.blinkText}>
          {blinkStatus}
        </Text>

        <Text style={styles.blinkCount}>
          BLINKS: {blinkCount}
        </Text>

        <Text
          style={[
            styles.livenessText,
            livenessVerified &&
              styles.livenessVerified,
          ]}>
          {livenessStatus}
        </Text>
      </View>
    </View>
  );
}

// -----------------------------------------
// STYLES
// -----------------------------------------

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
    fontSize: 18,
  },

  overlay: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    alignItems: 'center',
  },

  count: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    backgroundColor: '#00000099',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 10,
  },

  status: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    backgroundColor: '#00000099',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 10,
  },

  eyeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    backgroundColor: '#00000099',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 5,
  },

  blinkText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: '#00000099',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 5,
  },

  blinkCount: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: '#00000099',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
  },

  livenessText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: '#00000099',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 8,
  },

  livenessVerified: {
    backgroundColor: '#166534',
  },
});