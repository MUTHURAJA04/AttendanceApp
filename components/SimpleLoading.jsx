import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Animated, Easing } from 'react-native';
import { Loader2 } from 'lucide-react-native';

/**
 * SimpleLoading
 * A lightweight, high-performance loading animation component using React Native's native Animated driver.
 *
 * Props:
 * - text: string (e.g., "Loading Staff Directory...")
 * - subtext: string (optional, e.g., "Syncing local and cloud records")
 * - size: 'small' | 'medium' | 'large' (default: 'medium')
 * - horizontal: boolean (horizontal row layout for badges/bars, auto for 'small')
 * - overlay: boolean (renders as a centered overlay with dark backdrop)
 * - color: string (default: '#38bdf8')
 * - style: ViewStyle (optional additional container styles)
 */
export default function SimpleLoading({
  subtext,
  size = 'medium',
  horizontal = size === 'small',
  overlay = false,
  color = '#38bdf8',
  style,
}) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.9)).current;
  const fadeAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    // 1. Continuous smooth 360-degree rotation
    const rotate = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    // 2. Subtle rhythmic radar/breathing pulse
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.9,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    // 3. Subtle text opacity breathing
    const textBreath = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.65,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    rotate.start();
    pulse.start();
    textBreath.start();

    return () => {
      rotate.stop();
      pulse.stop();
      textBreath.stop();
    };
  }, [spinAnim, pulseAnim, fadeAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const iconSizes = {
    small: 18,
    medium: 36,
    large: 52,
  };

  const ringSizes = {
    small: 26,
    medium: 64,
    large: 88,
  };

  const iconSize = iconSizes[size] || iconSizes.medium;
  const ringSize = ringSizes[size] || ringSizes.medium;

  const content = (
    <View style={[horizontal ? styles.horizontalBox : styles.centerBox]}>
      {/* Animated Spinner with Outer Glow Ring */}
      <View
        style={[
          styles.animationContainer,
          { width: ringSize, height: ringSize },
          horizontal && styles.animationContainerHorizontal,
        ]}>
        {/* Soft breathing radar glow behind the spinner (for medium & large) */}
        {size !== 'small' && (
          <Animated.View
            style={[
              styles.glowRing,
              {
                width: ringSize,
                height: ringSize,
                borderRadius: ringSize / 2,
                borderColor: color,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
        )}

        {/* Smooth 360-degree rotating loader */}
        <Animated.View
          style={[
            styles.spinnerWrapper,
            {
              transform: [{ rotate: spin }],
            },
          ]}>
          <Loader2 size={iconSize} color={color} strokeWidth={size === 'small' ? 2.2 : 2.5} />
        </Animated.View>
      </View>

      {/* Loading Text and Optional Subtext */}
      <View style={horizontal ? styles.textColumnHorizontal : styles.textColumnCenter}>
        {subtext ? <Text style={styles.subText}>{subtext}</Text> : null}
      </View>
    </View>
  );

  if (overlay) {
    return <View style={[styles.overlayContainer, style]}>{content}</View>;
  }

  return (
    <View
      style={[
        size === 'small' ? styles.smallContainer : styles.inlineContainer,
        style,
      ]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallContainer: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 24,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  horizontalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  animationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  animationContainerHorizontal: {
    marginBottom: 0,
  },
  glowRing: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  spinnerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumnCenter: {
    alignItems: 'center',
  },
  textColumnHorizontal: {
    alignItems: 'flex-start',
  },
  titleText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  titleSmall: {
    fontSize: 13,
    fontWeight: '600',
    color: '#38bdf8',
  },
  titleLarge: {
    fontSize: 18,
  },
  subText: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 280,
    lineHeight: 18,
  },
});
