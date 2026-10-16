import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
  Easing,
  StatusBar,
} from 'react-native';
import { ScanFace } from 'lucide-react-native';
import { supabase } from '../services/supabase';

export default function SplashScreen({ navigation }) {
  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const pulseRingAnim = useRef(new Animated.Value(0.85)).current;
  const ringOpacityAnim = useRef(new Animated.Value(0.4)).current;
  const scanBeamAnim = useRef(new Animated.Value(-26)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const [statusMessage, setStatusMessage] = useState('Initializing');

  useEffect(() => {
    // 1. Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Pulse radar ring
    const ringLoop = Animated.loop(
      Animated.parallel([
        Animated.timing(pulseRingAnim, {
          toValue: 1.5,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(ringOpacityAnim, {
            toValue: 0.6,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacityAnim, {
            toValue: 0,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    ringLoop.start();

    // 3. Scan laser line
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanBeamAnim, {
          toValue: 26,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanBeamAnim, {
          toValue: -26,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    scanLoop.start();

    // 4. Progress track
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 1800,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 5. Auth check with modern, snappy delay
    let isMounted = true;

    const prepareAndNavigate = async () => {
      // 1.8s is optimal for brand impression without feeling laggy
      const minDisplayPromise = new Promise((resolve) => setTimeout(resolve, 1800));

      let destination = 'Login';
      try {
        if (isMounted) setStatusMessage('Connecting');

        const sessionPromise = supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const [, sessionResult] = await Promise.all([minDisplayPromise, sessionPromise]);

        const session = sessionResult?.data?.session;
        if (session) {
          if (isMounted) setStatusMessage('Ready');
          destination = 'MainTabs';
        } else {
          destination = 'Login';
        }
      } catch (err) {
        console.warn('[SplashScreen] Session check error:', err);
        destination = 'Login';
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!isMounted) return;

      // Smooth exit
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 350,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.04,
          duration: 350,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        ringLoop.stop();
        scanLoop.stop();
        navigation.replace(destination);
      });
    };

    prepareAndNavigate();

    return () => {
      isMounted = false;
      ringLoop.stop();
      scanLoop.stop();
    };
  }, [fadeAnim, scaleAnim, pulseRingAnim, ringOpacityAnim, scanBeamAnim, progressAnim, navigation]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#090d16" />

      {/* Ambient background glow */}
      <View style={styles.ambientGlow} />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}>
        
        {/* Biometric Icon & Radar */}
        <View style={styles.iconContainer}>
          <Animated.View
            style={[
              styles.radarRing,
              {
                transform: [{ scale: pulseRingAnim }],
                opacity: ringOpacityAnim,
              },
            ]}
          />

          <View style={styles.badgeWrapper}>
            <ScanFace size={48} color="#38bdf8" strokeWidth={1.8} />

            <Animated.View
              style={[
                styles.scanBeam,
                {
                  transform: [{ translateY: scanBeamAnim }],
                },
              ]}
            />
          </View>
        </View>

        {/* Minimal Two-Tone Title */}
        <Text style={styles.brandTitle}>
          Face<Text style={styles.brandAccent}>Flow</Text>
        </Text>

        {/* Sleek Hairline Progress Bar */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
        </View>

        {/* Status indicator */}
        <Text style={styles.statusText}>{statusMessage}</Text>
      </Animated.View>

      {/* Ultra-clean bottom version mark */}
      <Text style={styles.minimalFooter}>KIOSK OS</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  ambientGlow: {
    position: 'absolute',
    top: '30%',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
  },
  iconContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  radarRing: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1.5,
    borderColor: '#38bdf8',
  },
  badgeWrapper: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  scanBeam: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: '#38bdf8',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 3,
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 28,
  },
  brandAccent: {
    color: '#38bdf8',
    fontWeight: '300',
  },
  progressTrack: {
    width: 130,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  statusText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  minimalFooter: {
    position: 'absolute',
    bottom: 36,
    color: '#334155',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
  },
});