import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { UserCheck, UserPlus, CheckCircle2, AlertCircle } from 'lucide-react-native';

/**
 * Reusable Employee Item Card for Staff Directory
 * @param {object} props
 * @param {object} props.employee
 * @param {() => void} props.onEnrollPress
 */
export default function EmployeeItemCard({ employee, onEnrollPress }) {
  const hasFace = Boolean(employee.hasFace);
  const initial = (employee.name ? employee.name.charAt(0) : '?').toUpperCase();

  return (
    <View style={styles.card}>
      {/* Avatar with status indicator */}
      <View style={[styles.avatar, hasFace ? styles.avatarEnrolled : styles.avatarUnenrolled]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>

      {/* Employee Details */}
      <View style={styles.infoContainer}>
        <Text style={styles.empName} numberOfLines={1}>
          {employee.name}
        </Text>
        <Text style={styles.empId} numberOfLines={1}>
          Code: {employee.code} • {employee.department}
        </Text>

        {/* Status indicator */}
        <View style={styles.statusRow}>
          {hasFace ? (
            <CheckCircle2 size={13} color="#10b981" />
          ) : (
            <AlertCircle size={13} color="#f59e0b" />
          )}
          <Text style={[styles.statusText, hasFace ? styles.textGreen : styles.textAmber]}>
            {hasFace ? 'Face Enrolled (Local & Cloud)' : 'No Face Registered'}
          </Text>
        </View>
      </View>

      {/* Action Button */}
      <TouchableOpacity
        style={[styles.actionBtn, hasFace ? styles.updateBtn : styles.enrollBtn]}
        onPress={onEnrollPress}
        activeOpacity={0.75}>
        <View style={styles.btnContent}>
          {hasFace ? (
            <UserCheck size={14} color="#38bdf8" />
          ) : (
            <UserPlus size={14} color="#ffffff" />
          )}
          <Text style={[styles.actionBtnText, hasFace ? styles.updateBtnText : styles.enrollBtnText]}>
            {hasFace ? 'Update' : 'Enroll'}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarEnrolled: {
    backgroundColor: '#059669',
  },
  avatarUnenrolled: {
    backgroundColor: '#334155',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoContainer: {
    flex: 1,
    marginRight: 8,
  },
  empName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  empId: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotGreen: {
    backgroundColor: '#10b981',
  },
  dotAmber: {
    backgroundColor: '#f59e0b',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  textGreen: {
    color: '#10b981',
  },
  textAmber: {
    color: '#f59e0b',
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  enrollBtn: {
    backgroundColor: '#2563eb',
  },
  enrollBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  updateBtn: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#475569',
  },
  updateBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
});
