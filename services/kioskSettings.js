import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { FACE_CONFIG } from '../constants/faceConfig';

const KIOSK_SETTINGS_CACHE_KEY = '@kiosk_live_settings';

/**
 * Helper to safely extract primitive/typed value from jsonb or string
 */
function parseSettingValue(val, fallback) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'boolean' || typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (val.toLowerCase() === 'true') return true;
    if (val.toLowerCase() === 'false') return false;
    const num = Number(val);
    if (!isNaN(num) && val.trim() !== '') return num;
    try {
      const parsed = JSON.parse(val);
      if (parsed !== undefined && parsed !== null) return parsed;
    } catch {
      return val;
    }
  }
  return val;
}

/**
 * 1. Fetch current live settings from Supabase Database on App Start / Screen focus
 */
export const loadKioskSettings = async () => {
  let cached = {};
  try {
    const local = await AsyncStorage.getItem(KIOSK_SETTINGS_CACHE_KEY);
    if (local) cached = JSON.parse(local);
  } catch {
    cached = {};
  }

  try {
    const { data, error } = await supabase
      .from('organization_settings')
      .select('key, value');

    if (error || !Array.isArray(data)) {
      console.warn('[KioskSettings] Using cached settings (DB notice):', error?.message);
      return {
        antiSpoofing: cached.antiSpoofing ?? true,
        requireBlink: cached.requireBlink ?? true,
        similarityThreshold: cached.similarityThreshold ?? FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD,
        yawTolerance: cached.yawTolerance ?? FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
        doublePunchLockout: cached.doublePunchLockout ?? FACE_CONFIG.PUNCH_COOLDOWN_MINUTES,
        enrollmentSamples: cached.enrollmentSamples ?? FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET,
        sampleIntervalMs: cached.sampleIntervalMs ?? FACE_CONFIG.SAMPLE_INTERVAL_MS,
        sessionVersion: cached.sessionVersion ?? 1,
        allowOfflinePunches: cached.allowOfflinePunches ?? true,
      };
    }

    const config = {};
    data.forEach((row) => {
      config[row.key] = parseSettingValue(row.value, row.value);
    });

    const parsedSettings = {
      antiSpoofing: config.anti_spoofing_enabled ?? config.antiSpoofing ?? cached.antiSpoofing ?? true,
      requireBlink: config.liveness_blink_required ?? config.requireBlink ?? cached.requireBlink ?? true,
      similarityThreshold: config.similarity_threshold ?? config.similarityThreshold ?? cached.similarityThreshold ?? FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD,
      yawTolerance: config.yaw_angle_tolerance ?? config.yawTolerance ?? cached.yawTolerance ?? FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
      doublePunchLockout: config.double_punch_lockout_mins ?? config.doublePunchLockout ?? cached.doublePunchLockout ?? FACE_CONFIG.PUNCH_COOLDOWN_MINUTES,
      enrollmentSamples: config.enrollment_samples ?? config.enrollmentSamples ?? cached.enrollmentSamples ?? FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET,
      sampleIntervalMs: config.sample_interval_ms ?? config.sampleIntervalMs ?? cached.sampleIntervalMs ?? FACE_CONFIG.SAMPLE_INTERVAL_MS,
      sessionVersion: Number(config.kiosk_session_version ?? config.sessionVersion ?? cached.sessionVersion ?? 1),
      allowOfflinePunches: config.allow_offline_punches ?? cached.allowOfflinePunches ?? true,
      lastSynced: new Date().toISOString(),
    };

    // Cache locally for offline resilience
    await AsyncStorage.setItem(KIOSK_SETTINGS_CACHE_KEY, JSON.stringify(parsedSettings));
    console.log('[KioskSettings] Live database configuration loaded:', parsedSettings);
    return parsedSettings;
  } catch (err) {
    console.warn('[KioskSettings] Live fetch exception, using offline cache:', err?.message || err);
    return {
      antiSpoofing: cached.antiSpoofing ?? true,
      requireBlink: cached.requireBlink ?? true,
      similarityThreshold: cached.similarityThreshold ?? FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD,
      yawTolerance: cached.yawTolerance ?? FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
      doublePunchLockout: cached.doublePunchLockout ?? FACE_CONFIG.PUNCH_COOLDOWN_MINUTES,
      enrollmentSamples: cached.enrollmentSamples ?? FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET,
      sampleIntervalMs: cached.sampleIntervalMs ?? FACE_CONFIG.SAMPLE_INTERVAL_MS,
      sessionVersion: cached.sessionVersion ?? 1,
      allowOfflinePunches: cached.allowOfflinePunches ?? true,
      lastSynced: cached.lastSynced || null,
    };
  }
};

/**
 * 2. Listen in real-time for Remote Force Logout from Dashboard
 * @param {number} currentSessionVersion
 * @param {() => void} onLogoutRequired
 */
export const listenForRemoteLogout = (currentSessionVersion, onLogoutRequired) => {
  return supabase
    .channel('kiosk_security')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'organization_settings',
        filter: 'key=eq.kiosk_session_version',
      },
      (payload) => {
        const rawNewVal = payload?.new?.value;
        const newVersion = Number(parseSettingValue(rawNewVal, 1));
        console.log(`[Kiosk Security] Received remote session version: ${newVersion} (current: ${currentSessionVersion})`);
        if (newVersion > currentSessionVersion) {
          console.warn('[Kiosk Security] Remote force logout triggered from web dashboard!');
          onLogoutRequired();
        }
      },
    )
    .subscribe();
};

/**
 * 3. Listen in real-time for ANY live setting change from Web Dashboard (Anti-spoofing, threshold, etc.)
 * @param {(newSettings: object) => void} onSettingsChanged
 */
export const subscribeToLiveSettings = (onSettingsChanged) => {
  return supabase
    .channel('kiosk_settings_live')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'organization_settings',
      },
      async () => {
        console.log('[KioskSettings] Real-time setting change detected, refreshing...');
        const updated = await loadKioskSettings();
        onSettingsChanged(updated);
      },
    )
    .subscribe();
};
