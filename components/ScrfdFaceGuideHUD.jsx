import React, { useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { AlertTriangle } from 'lucide-react-native';

/**
 * SCRFD Live Face Guide & Dynamic Tracking HUD
 * 
 * Features:
 * 1. Plain camera view with top floating pill (no fixed oval)
 * 2. Dynamic Face Reticle [ ┌ ┐ └ ┘ ] that smoothly tracks where the face actually is
 * 3. Front-camera cover-scale and mirrored coordinate mapping with EMA smoothing
 * 4. Multi-face warning alert
 * 5. Instant green glow flash upon successful match
 */
export default function ScrfdFaceGuideHUD({
  boxState = 'DEFAULT', // 'DEFAULT' | 'ALIGNED' | 'IDENTIFIED' | 'MATCH' | 'WARNING'
  promptText = 'Align your face inside the frame',
  faceBounds = null, // Object with x, y, width, height of detected face
  multipleFacesDetected = false,
  isIdentified = false,
  isLoading = false,
  showReticle = true, // Dynamic face tracking corners [ ]
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Smoothing ref for jitter-free tracking reticle
  const smoothBoxRef = useRef(null);

  // Match flash animation
  const matchFlashAnim = useRef(new Animated.Value(0)).current;

  // Flash green upon match
  useEffect(() => {
    if (boxState === 'MATCH') {
      Animated.sequence([
        Animated.timing(matchFlashAnim, {
          toValue: 1.0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(matchFlashAnim, {
          toValue: 0.0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [boxState, matchFlashAnim]);

  // Helper: Front-Camera Cover-Scale & Mirrored Coordinate Transform
  // CameraX portrait buffer is 720x1280 (or 1080x1920)
  const getCameraTransform = useMemo(() => {
    return (rawX, rawY, rawW = 0, rawH = 0) => {
      const is1080 = (rawX + rawW > 750) || (rawY + rawH > 1300);
      const bufferW = is1080 ? 1080 : 720;
      const bufferH = is1080 ? 1920 : 1280;

      // VisionCamera 'cover' scaling: fills screen, keeps aspect ratio
      const scale = Math.max(screenWidth / bufferW, screenHeight / bufferH);
      const offsetX = (screenWidth - bufferW * scale) / 2;
      const offsetY = (screenHeight - bufferH * scale) / 2;

      // Front camera preview is mirrored horizontally in React Native
      const mirroredX = bufferW - (rawX + rawW);
      const screenX = mirroredX * scale + offsetX;
      const screenY = rawY * scale + offsetY;
      const screenW = rawW * scale;
      const screenH = rawH * scale;

      return {
        x: screenX,
        y: screenY,
        width: screenW,
        height: screenH,
      };
    };
  }, [screenWidth, screenHeight]);

  // Dynamic Face Tracker Box with EMA Smoothing
  const faceTrackingBox = useMemo(() => {
    if (!faceBounds) {
      smoothBoxRef.current = null;
      return null;
    }

    const rawX = faceBounds.x ?? faceBounds.originX ?? 0;
    const rawY = faceBounds.y ?? faceBounds.originY ?? 0;
    const rawW = faceBounds.width ?? faceBounds.size?.width ?? 0;
    const rawH = faceBounds.height ?? faceBounds.size?.height ?? 0;

    if (rawW <= 0 || rawH <= 0) {
      smoothBoxRef.current = null;
      return null;
    }

    const target = getCameraTransform(rawX, rawY, rawW, rawH);

    // Padding around face box for aesthetic biometric reticle
    const padX = target.width * 0.08;
    const padY = target.height * 0.08;
    const paddedBox = {
      x: target.x - padX,
      y: target.y - padY,
      width: target.width + padX * 2,
      height: target.height + padY * 2,
    };

    // EMA smoothing to eliminate micro-jitter
    let smoothed;
    if (!smoothBoxRef.current) {
      smoothed = paddedBox;
    } else {
      const prev = smoothBoxRef.current;
      const dist = Math.hypot(paddedBox.x - prev.x, paddedBox.y - prev.y);
      // Snap instantly if large movement, otherwise smooth
      const alpha = dist > 140 ? 1.0 : 0.45;
      smoothed = {
        x: prev.x + (paddedBox.x - prev.x) * alpha,
        y: prev.y + (paddedBox.y - prev.y) * alpha,
        width: prev.width + (paddedBox.width - prev.width) * alpha,
        height: prev.height + (paddedBox.height - prev.height) * alpha,
      };
    }
    smoothBoxRef.current = smoothed;

    // Clamp inside screen bounds
    const clampedW = Math.min(smoothed.width, screenWidth * 0.95);
    const clampedH = Math.min(smoothed.height, screenHeight * 0.85);
    const clampedX = Math.max(4, Math.min(smoothed.x, screenWidth - clampedW - 4));
    const clampedY = Math.max(48, Math.min(smoothed.y, screenHeight - clampedH - 48));

    return { x: clampedX, y: clampedY, width: clampedW, height: clampedH };
  }, [faceBounds, getCameraTransform, screenWidth, screenHeight]);

  const getReticleColor = () => {
    switch (boxState) {
      case 'MATCH':
        return '#22c55e';
      case 'IDENTIFIED':
        return '#38bdf8';
      case 'ALIGNED':
        return isIdentified ? '#38bdf8' : '#f59e0b';
      case 'WARNING':
        return '#ef4444';
      default:
        return '#38bdf8';
    }
  };

  const getPillStyle = () => {
    switch (boxState) {
      case 'MATCH':
        return styles.pillMatch;
      case 'IDENTIFIED':
        return styles.pillIdentified;
      case 'WARNING':
        return styles.pillWarning;
      case 'ALIGNED':
        return isIdentified ? styles.pillIdentified : styles.pillAligned;
      default:
        return styles.pillDefault;
    }
  };

  return (
    <>
      {/* 1. Top Floating Status & Guidance Pill */}
      <View style={styles.pillContainer} pointerEvents="none">
        <View style={[styles.pill, getPillStyle(), styles.pillRow]}>
          {isLoading && (
            <ActivityIndicator size="small" color="#38bdf8" style={styles.pillSpinner} />
          )}
          <Text style={styles.pillText}>{promptText}</Text>
        </View>

        {/* 2. Multi-Face Warning Banner */}
        {multipleFacesDetected && (
          <View style={styles.multiFaceWarningRow}>
            <AlertTriangle size={15} color="#ef4444" style={styles.warningIcon} />
            <Text style={styles.multiFaceWarningText}>
              Please ensure only one person is in front of the camera
            </Text>
          </View>
        )}
      </View>

      {/* 3. Dynamic Face Tracking Corners [ ] (Only shown when a face arrives) */}
      {showReticle && faceTrackingBox && (
        <View
          style={[
            styles.dynamicFaceBox,
            {
              left: faceTrackingBox.x,
              top: faceTrackingBox.y,
              width: faceTrackingBox.width,
              height: faceTrackingBox.height,
            },
          ]}
          pointerEvents="none"
        >
          {/* High-Tech Corner Brackets framing the detected face */}
          <View style={[styles.corner, styles.cornerTopLeft, { borderColor: getReticleColor() }]} />
          <View style={[styles.corner, styles.cornerTopRight, { borderColor: getReticleColor() }]} />
          <View style={[styles.corner, styles.cornerBottomLeft, { borderColor: getReticleColor() }]} />
          <View style={[styles.corner, styles.cornerBottomRight, { borderColor: getReticleColor() }]} />

          {/* Match green flash fill inside face box */}
          {boxState === 'MATCH' && (
            <Animated.View
              style={[
                styles.dynamicFaceMatchOverlay,
                { opacity: matchFlashAnim },
              ]}
            />
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    position: 'absolute',
    top: 52,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSpinner: {
    marginRight: 8,
  },
  pillDefault: {
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    borderColor: '#475569',
  },
  pillAligned: {
    backgroundColor: 'rgba(120, 53, 15, 0.92)',
    borderColor: '#f59e0b',
  },
  pillIdentified: {
    backgroundColor: 'rgba(3, 105, 161, 0.94)',
    borderColor: '#38bdf8',
  },
  pillMatch: {
    backgroundColor: 'rgba(22, 101, 52, 0.95)',
    borderColor: '#22c55e',
  },
  pillWarning: {
    backgroundColor: 'rgba(153, 27, 27, 0.92)',
    borderColor: '#ef4444',
  },
  pillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  multiFaceWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(153, 27, 27, 0.95)',
    borderColor: '#ef4444',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    marginTop: 8,
  },
  multiFaceWarningText: {
    color: '#fee2e2',
    fontSize: 12,
    fontWeight: '600',
  },
  warningIcon: {
    marginRight: 6,
  },
  // Dynamic Face Tracking Reticle [ ]
  dynamicFaceBox: {
    position: 'absolute',
    zIndex: 12,
  },
  dynamicFaceMatchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(34, 197, 94, 0.22)',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#22c55e',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
});
