import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

/**
 * Reusable modal popup for punch success (IN/OUT) with PRESENT status badge and duplicate lockout notification
 * @param {object} props
 * @param {object | null} props.punchSuccess
 * @param {object | null} props.duplicateWarning
 */
export default function AttendanceResultModal({ punchSuccess, duplicateWarning }) {
  if (duplicateWarning) {
    return (
      <View style={styles.duplicateModal}>
        <Text style={styles.duplicateIcon}>⚠️</Text>
        <Text style={styles.duplicateTitle}>
          Already Punched {duplicateWarning.lastType}!
        </Text>
        <Text style={styles.duplicateName}>{duplicateWarning.name}</Text>
        <Text style={styles.duplicateSub}>
          Please wait {duplicateWarning.waitSeconds}s before punching again.
        </Text>
      </View>
    );
  }

  if (punchSuccess) {
    const isOut = punchSuccess.type === 'OUT';
    return (
      <View style={[styles.successModal, isOut ? styles.modalOut : styles.modalIn]}>
        {/* Badges Row: PRESENT status + Action Type */}
        <View style={styles.badgeRow}>
          <View style={styles.presentBadge}>
            <Text style={styles.presentBadgeText}>✓ PRESENT</Text>
          </View>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {isOut ? 'CHECK-OUT' : 'CHECK-IN'}
            </Text>
          </View>
        </View>

        <Text style={styles.successIcon}>{isOut ? '👋' : '✓'}</Text>
        <Text style={styles.successTitle}>
          {isOut ? 'Attendance Verified' : 'Attendance Marked'}
        </Text>
        <Text style={styles.successName}>{punchSuccess.name}</Text>
        <Text style={styles.successSub}>
          {punchSuccess.department || 'Staff'} • {punchSuccess.time}
        </Text>
        <Text style={styles.successConfidence}>
          Verification Confidence: {punchSuccess.score}%
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  successModal: {
    position: 'absolute',
    top: '26%',
    left: 26,
    right: 26,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    zIndex: 100,
  },
  modalIn: {
    backgroundColor: '#15803d',
    borderColor: '#22c55e',
    borderWidth: 1.5,
  },
  modalOut: {
    backgroundColor: '#b45309',
    borderColor: '#f59e0b',
    borderWidth: 1.5,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  presentBadge: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  presentBadgeText: {
    color: '#15803d',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  typeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  successIcon: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: 'bold',
  },
  successTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 4,
  },
  successName: {
    color: '#f0fdf4',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  successSub: {
    color: '#e2e8f0',
    fontSize: 13,
    marginTop: 4,
  },
  successConfidence: {
    color: '#86efac',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },
  duplicateModal: {
    position: 'absolute',
    top: '28%',
    left: 28,
    right: 28,
    backgroundColor: '#9a3412',
    borderColor: '#ea580c',
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    zIndex: 100,
  },
  duplicateIcon: {
    fontSize: 38,
  },
  duplicateTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 6,
  },
  duplicateName: {
    color: '#fed7aa',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  duplicateSub: {
    color: '#ffedd5',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
});
