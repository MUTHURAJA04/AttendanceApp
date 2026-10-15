import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { EmployeeStorage } from '../services/employeeStorage';

export default function HistoryScreen() {
  const isFocused = useIsFocused();
  const [logs, setLogs] = useState([]);

  const loadLogs = async () => {
    const data = await EmployeeStorage.getAttendanceLogs();
    setLogs(data);
  };

  useEffect(() => {
    if (isFocused) {
      loadLogs();
    }
  }, [isFocused]);

  const formatTime = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return '--:--';
    }
  };

  const formatDate = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Punch History</Text>
          <Text style={styles.sub}>{logs.length} Total Attendance Records</Text>
        </View>
      </View>

      {/* Log Entries */}
      {logs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No punches recorded</Text>
          <Text style={styles.emptySub}>
            Successful face verifications from the Kiosk will appear here in real time.
          </Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const scorePercent =
              typeof item.score === 'number'
                ? (item.score * 100).toFixed(0)
                : typeof item.similarityScore === 'number'
                ? (item.similarityScore * 100).toFixed(0)
                : '95';

            const isCheckIn = item.type !== 'OUT';

            return (
              <View style={styles.logCard}>
                {/* Employee Initial Avatar */}
                <View style={[styles.avatar, isCheckIn ? styles.avatarIn : styles.avatarOut]}>
                  <Text style={styles.avatarText}>
                    {(item.employeeName || 'E').charAt(0).toUpperCase()}
                  </Text>
                </View>

                {/* Name, ID, PRESENT status & Punch Type Badge */}
                <View style={styles.infoCol}>
                  <View style={styles.nameBadgeRow}>
                    <Text style={styles.empName} numberOfLines={1}>
                      {item.employeeName || 'Staff Member'}
                    </Text>
                    <View style={styles.presentPill}>
                      <Text style={styles.presentPillText}>PRESENT</Text>
                    </View>
                    <View
                      style={[
                        styles.typeBadge,
                        isCheckIn ? styles.badgeIn : styles.badgeOut,
                      ]}>
                      <Text style={styles.badgeText}>{isCheckIn ? 'IN' : 'OUT'}</Text>
                    </View>
                  </View>
                  <Text style={styles.empId}>
                    ID: {item.employeeId || '--'} {item.department ? `• ${item.department}` : ''}
                  </Text>
                </View>

                {/* Time, Date & Confidence Score */}
                <View style={styles.timeBlock}>
                  <Text style={styles.timeText}>{formatTime(item.timestamp)}</Text>
                  <Text style={styles.dateText}>{formatDate(item.timestamp)}</Text>
                  <Text style={styles.scoreText}>Match: {scorePercent}%</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  sub: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyTitle: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  emptySub: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarIn: {
    backgroundColor: '#166534',
  },
  avatarOut: {
    backgroundColor: '#b45309',
  },
  avatarText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  empName: { color: '#ffffff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  empId: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  timeBlock: { alignItems: 'flex-end', marginLeft: 8 },
  timeText: { color: '#38bdf8', fontSize: 14, fontWeight: '700' },
  dateText: { color: '#64748b', fontSize: 11, marginTop: 2 },
  scoreText: { color: '#22c55e', fontSize: 11, marginTop: 2, fontWeight: '600' },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeIn: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderColor: '#22c55e',
    borderWidth: 1,
  },
  badgeOut: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderColor: '#f59e0b',
    borderWidth: 1,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  presentPill: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderColor: '#22c55e',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  presentPillText: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  listContent: {
    padding: 16,
  },
  infoCol: {
    flex: 1,
  },
  nameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});