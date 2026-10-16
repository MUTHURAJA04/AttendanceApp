import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Sparkles, X } from 'lucide-react-native';

/**
 * Reusable Bottom Progress Card for Face Enrollment
 * @param {object} props
 * @param {string} props.employeeName
 * @param {number} props.samplesCount
 * @param {number} props.targetSamples
 * @param {boolean} props.isSaving
 * @param {() => void} props.onCancel
 */
export default function EnrollmentProgressCard({
  employeeName,
  samplesCount = 0,
  targetSamples = 10,
  isSaving = false,
  onCancel,
}) {
  const progressPercent = Math.min(100, (samplesCount / targetSamples) * 100);

  return (
    <View style={styles.progressCard}>
      <Text style={styles.progressTitle}>
        Enrolling: {employeeName || 'Staff Member'}
      </Text>

      {isSaving ? (
        <View style={styles.savingRow}>
          <ActivityIndicator color="#38bdf8" size="small" />
          <Text style={styles.savingText}>Saving Embedding Locally & Cloud...</Text>
        </View>
      ) : (
        <>
          <View style={styles.countRow}>
            <Sparkles size={14} color="#38bdf8" />
            <Text style={styles.progressCount}>
              Verified Face Samples: {samplesCount} / {targetSamples}
            </Text>
          </View>

          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
        </>
      )}

      <TouchableOpacity
        style={styles.cancelBtn}
        onPress={onCancel}
        disabled={isSaving}
        activeOpacity={0.7}>
        <View style={styles.cancelContent}>
          <X size={14} color="#ef4444" />
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  progressCard: {
    position: 'absolute',
    bottom: 36,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  progressTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  progressCount: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBarTrack: {
    width: '100%',
    height: 7,
    backgroundColor: '#1e293b',
    borderRadius: 4,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 4,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  savingText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  cancelContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cancelBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
});
