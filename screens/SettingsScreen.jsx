import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { EmployeeStorage } from '../services/employeeStorage';
import {
  loadKioskSettings,
  subscribeToLiveSettings,
} from '../services/kioskSettings';
import { FACE_CONFIG } from '../constants/faceConfig';

export default function SettingsScreen() {
  const isFocused = useIsFocused();
  const [config, setConfig] = useState({
    antiSpoofing: true,
    requireBlink: true,
    similarityThreshold: FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD,
    yawTolerance: FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
    doublePunchLockout: FACE_CONFIG.PUNCH_COOLDOWN_MINUTES,
    enrollmentSamples: FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET,
    sampleIntervalMs: FACE_CONFIG.SAMPLE_INTERVAL_MS,
    sessionVersion: 1,
  });
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [lastSynced, setLastSynced] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadSettingsAndDiagnostics = useCallback(async () => {
    try {
      // 1. Auto-fetch live biometric settings from DB
      const liveSettings = await loadKioskSettings();
      setConfig(liveSettings);

      // 2. Load local employee directory counts
      const allEmps = await EmployeeStorage.getAllEmployees();
      const enrolledEmps = allEmps.filter((e) => e.hasFace && e.template);

      setTotalEmployees(allEmps.length);
      setTotalEnrolled(enrolledEmps.length);

      // 3. Load last employee sync timestamp
      const syncTime = await EmployeeStorage.getLastSyncedTime();
      setLastSynced(syncTime);
    } catch (e) {
      console.error('[Settings] Load diagnostics error:', e);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadSettingsAndDiagnostics();

      // Subscribe to real-time database changes for configuration so it always reflects live
      const liveSub = subscribeToLiveSettings((updated) => {
        console.log('[SettingsScreen] Live settings update received from DB:', updated);
        setConfig(updated);
      });

      return () => {
        if (liveSub?.unsubscribe) liveSub.unsubscribe();
      };
    }
  }, [isFocused, loadSettingsAndDiagnostics]);

  // Sync button specifically handles Employee & Face Embedding data synchronization
  const handleSyncEmployees = async () => {
    try {
      setIsSyncing(true);

      const syncedEmployees = await EmployeeStorage.syncEmployeesFromCloud();
      const enrolled = syncedEmployees.filter((e) => e.hasFace && e.template);

      setTotalEmployees(syncedEmployees.length);
      setTotalEnrolled(enrolled.length);

      const nowIso = new Date().toISOString();
      setLastSynced(nowIso);

      Alert.alert(
        'Employee Sync Complete! ✓',
        `Successfully synchronized:\n• ${syncedEmployees.length} Staff Profiles\n• ${enrolled.length} Enrolled Face Embeddings`,
      );
    } catch (err) {
      Alert.alert('Sync Notice', err?.message || 'Could not connect to cloud server.');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLastSyncTime = (isoString) => {
    if (!isoString) return 'Not synced yet';
    try {
      const d = new Date(isoString);
      return d.toLocaleString([], {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const isLivenessActive = Boolean(config.antiSpoofing ?? config.requireBlink);
  const similarityScoreVal = Number(config.similarityThreshold ?? FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD);
  const thresholdPercent = (similarityScoreVal * 100).toFixed(0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>System Settings</Text>
        <Text style={styles.sub}>Dashboard-managed configuration & diagnostics (Read-Only)</Text>
      </View>

      <View style={styles.content}>
        {/* 1. EMPLOYEE DATA SYNC CARD */}
        <Text style={styles.sectionHeader}>STAFF PROFILES SYNCHRONIZATION</Text>
        <View style={styles.card}>
          <View style={styles.syncRow}>
            <View style={styles.syncInfo}>
              <Text style={styles.cardTitle}>Employee & Face Database</Text>
              <Text style={styles.lastSyncText}>
                Last Staff Sync: {formatLastSyncTime(lastSynced)}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.syncBtn, isSyncing && styles.syncBtnDisabled]}
              onPress={handleSyncEmployees}
              disabled={isSyncing}
              activeOpacity={0.75}>
              {isSyncing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.syncBtnText}>🔄 Sync Employees</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. RECOGNITION ENGINE (Dynamic Live Dashboard Settings) */}
        <Text style={styles.sectionHeader}>DASHBOARD BIOMETRIC AI CONTROLS</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Anti-Spoofing (Liveness Engine)</Text>
            <View style={isLivenessActive ? styles.badgeActive : styles.badgeDisabled}>
              <Text style={isLivenessActive ? styles.badgeActiveText : styles.badgeDisabledText}>
                {isLivenessActive ? '● Active (Blink Required)' : '○ Disabled'}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Similarity Match Threshold</Text>
            <Text style={styles.infoValue}>
              {thresholdPercent}% ({similarityScoreVal})
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Enrollment Target Samples</Text>
            <Text style={styles.infoValue}>
              {config.enrollmentSamples || FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET} Verified Angles
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Sample Capture Interval</Text>
            <Text style={styles.infoValue}>
              {config.sampleIntervalMs || FACE_CONFIG.SAMPLE_INTERVAL_MS} ms
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Head Yaw Orientation Limit</Text>
            <Text style={styles.infoValue}>
              ±{config.yawTolerance || FACE_CONFIG.MAX_HEAD_YAW_DEGREES}°
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Duplicate Punch Cooldown</Text>
            <Text style={styles.infoValue}>
              {config.doublePunchLockout || FACE_CONFIG.PUNCH_COOLDOWN_MINUTES} Minutes
            </Text>
          </View>
        </View>

        {/* 3. TERMINAL & SYSTEM DIAGNOSTICS */}
        <Text style={styles.sectionHeader}>TERMINAL DIAGNOSTICS</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Terminal Mode</Text>
            <Text style={styles.infoValue}>Autonomous Face Kiosk</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Locally Cached Profiles</Text>
            <Text style={styles.infoValue}>
              {totalEnrolled} / {totalEmployees} Staff Enrolled
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Neural Network Architecture</Text>
            <Text style={styles.infoValue}>MobileFaceNet (128-D Vector)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Neural Input Resolution</Text>
            <Text style={styles.infoValue}>
              {FACE_CONFIG.MODEL_INPUT_WIDTH} × {FACE_CONFIG.MODEL_INPUT_HEIGHT} Planar RGB
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Shift Alternation</Text>
            <Text style={styles.infoValue}>Strict IN ➔ OUT ➔ IN</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Vision Pipeline</Text>
            <Text style={styles.infoValue}>Google ML Kit + Vision Camera</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Platform</Text>
            <Text style={styles.infoValue}>
              {Platform.OS === 'android' ? 'Android Native' : Platform.OS === 'ios' ? 'iOS Native' : 'React Native'} (v0.0.1)
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  sub: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    padding: 16,
  },
  sectionHeader: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncInfo: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  lastSyncText: {
    color: '#38bdf8',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  syncBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  syncBtnDisabled: {
    opacity: 0.6,
  },
  syncBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoLabel: {
    color: '#94a3b8',
    fontSize: 13,
    flexShrink: 1,
  },
  infoValue: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
  badgeActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderColor: '#22c55e',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeActiveText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '700',
  },
  badgeDisabled: {
    backgroundColor: 'rgba(100, 116, 139, 0.2)',
    borderColor: '#64748b',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeDisabledText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 10,
  },
});