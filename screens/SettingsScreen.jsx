import React, {useState, useEffect} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Switch,
  Alert,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {EmployeeStorage} from '../services/employeeStorage';

export default function SettingsScreen({navigation}) {
  const [similarityThreshold, setSimilarityThreshold] = useState('0.70');
  const [livenessEnabled, setLivenessEnabled] = useState(true);
  const [totalEnrolled, setTotalEnrolled] = useState(0);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedThreshold = await AsyncStorage.getItem('@config_threshold');
      if (savedThreshold) setSimilarityThreshold(savedThreshold);

      const savedLiveness = await AsyncStorage.getItem('@config_liveness');
      if (savedLiveness !== null) setLivenessEnabled(savedLiveness === 'true');

      const emps = await EmployeeStorage.getAllEmployees();
      setTotalEnrolled(emps.length);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectThreshold = async (val) => {
    setSimilarityThreshold(val);
    await AsyncStorage.setItem('@config_threshold', val);
  };

  const handleToggleLiveness = async (val) => {
    setLivenessEnabled(val);
    await AsyncStorage.setItem('@config_liveness', val ? 'true' : 'false');
  };

  const handleLogout = () => {
    Alert.alert('Lock Kiosk', 'Lock this kiosk terminal and return to Login PIN screen?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Lock',
        style: 'destructive',
        onPress: () => navigation.replace('Login'),
      },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>System Settings</Text>
        <Text style={styles.sub}>Terminal configuration & inference controls</Text>
      </View>

      <View style={styles.content}>
        {/* ML Configuration Section */}
        <Text style={styles.sectionHeader}>RECOGNITION ENGINE</Text>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View>
              <Text style={styles.cardTitle}>Anti-Spoofing (Liveness)</Text>
              <Text style={styles.cardDesc}>Requires real eye blink before punching</Text>
            </View>
            <Switch
              value={livenessEnabled}
              onValueChange={handleToggleLiveness}
              trackColor={{false: '#334155', true: '#16a34a'}}
              thumbColor={livenessEnabled ? '#fff' : '#94a3b8'}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Similarity Match Threshold</Text>
          <Text style={styles.cardDesc}>
            Higher values reduce false positives; lower values improve recognition under low lighting.
          </Text>

          <View style={styles.thresholdRow}>
            {['0.65', '0.70', '0.75'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.thresholdBtn,
                  similarityThreshold === t && styles.thresholdBtnActive,
                ]}
                onPress={() => handleSelectThreshold(t)}>
                <Text
                  style={[
                    styles.thresholdBtnText,
                    similarityThreshold === t && styles.thresholdBtnTextActive,
                  ]}>
                  {t} {t === '0.70' ? '(Default)' : t === '0.75' ? '(Strict)' : '(Lenient)'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* System Diagnostics */}
        <Text style={styles.sectionHeader}>TERMINAL DIAGNOSTICS</Text>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Neural Network</Text>
            <Text style={styles.infoValue}>MobileFaceNet (128-D)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Input Resolution</Text>
            <Text style={styles.infoValue}>112 × 112 Planar RGB</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Enrolled Templates</Text>
            <Text style={styles.infoValue}>{totalEnrolled} Registered</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Liveness Tracker</Text>
            <Text style={styles.infoValue}>Google ML Kit Vision</Text>
          </View>
        </View>

        {/* Lock / Exit */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Lock Terminal (Exit Kiosk)</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0f172a'},
  header: {
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {color: '#fff', fontSize: 22, fontWeight: '700'},
  sub: {color: '#94a3b8', fontSize: 13, marginTop: 2},
  content: {padding: 16},
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
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {color: '#fff', fontSize: 15, fontWeight: '600'},
  cardDesc: {color: '#94a3b8', fontSize: 12, marginTop: 3, lineHeight: 16},
  thresholdRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  thresholdBtn: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  thresholdBtnActive: {
    backgroundColor: '#2563eb',
    borderColor: '#38bdf8',
  },
  thresholdBtnText: {color: '#94a3b8', fontSize: 12, fontWeight: '600'},
  thresholdBtnTextActive: {color: '#fff', fontWeight: '700'},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoLabel: {color: '#94a3b8', fontSize: 13},
  infoValue: {color: '#f8fafc', fontSize: 13, fontWeight: '600'},
  divider: {height: 1, backgroundColor: '#334155', marginVertical: 8},
  logoutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 40,
  },
  logoutText: {color: '#ef4444', fontSize: 15, fontWeight: '700'},
});