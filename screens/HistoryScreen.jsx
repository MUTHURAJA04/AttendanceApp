import React, {useState, useEffect} from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {EmployeeStorage} from '../services/employeeStorage';

export default function HistoryScreen() {
  const isFocused = useIsFocused();
  const [logs, setLogs] = useState([]);

  const loadLogs = async () => {
    const data = await EmployeeStorage.getAttendanceLogs();
    setLogs(data);
    console.log("HISTORY LOGS", data)
  };

  useEffect(() => {
    if (isFocused) {
      loadLogs();
    }
  }, [isFocused]);

  const handleClearHistory = () => {
    Alert.alert(
      'Clear Punch Records',
      'Are you sure you want to permanently clear all recorded punch history?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await EmployeeStorage.clearLogs?.() ?? (async () => {
              // Fallback if clearLogs isn't defined explicitly
              const AsyncStorage = require('@react-native-async-storage/async-storage').default;
              await AsyncStorage.removeItem('@attendance_logs');
            })();
            loadLogs();
          },
        },
      ],
    );
  };
const formatTime = (isoString) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', {
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
      return d.toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'});
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
          <Text style={styles.sub}>{logs.length} Total Attendance Punches</Text>
        </View>

        {logs.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearHistory}>
            <Text style={styles.clearBtnText}>Clear History</Text>
          </TouchableOpacity>
        )}
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
          keyExtractor={(item, index) => item.id || index.toString()}
          contentContainerStyle={{padding: 16}}
        renderItem={({item}) => {
            const scorePercent = typeof item.score === 'number' 
              ? (item.score * 100).toFixed(0) 
              : typeof item.similarityScore === 'number' 
              ? (item.similarityScore * 100).toFixed(0) 
              : '95';

            const isCheckIn = item.type !== 'OUT'; // Default to IN if undefined

            return (
              <View style={styles.logCard}>
                {/* Employee Initial Avatar */}
                <View style={[styles.avatar, isCheckIn ? styles.avatarIn : styles.avatarOut]}>
                  <Text style={styles.avatarText}>
                    {(item.employeeName || 'E').charAt(0).toUpperCase()}
                  </Text>
                </View>

                {/* Name, ID & Punch Type Badge */}
                <View style={{flex: 1}}>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                    <Text style={styles.empName}>{item.employeeName || 'Unknown Employee'}</Text>
                    <View
                      style={[
                        styles.typeBadge,
                        isCheckIn ? styles.badgeIn : styles.badgeOut,
                      ]}>
                      <Text style={styles.badgeText}>{isCheckIn ? 'IN' : 'OUT'}</Text>
                    </View>
                  </View>
                  <Text style={styles.empId}>ID: {item.employeeId || '--'}</Text>
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
  container: {flex: 1, backgroundColor: '#0f172a'},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {color: '#fff', fontSize: 22, fontWeight: '700'},
  sub: {color: '#94a3b8', fontSize: 13, marginTop: 2},
  clearBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  clearBtnText: {color: '#ef4444', fontSize: 13, fontWeight: '600'},
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyTitle: {color: '#fff', fontSize: 16, fontWeight: '600'},
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
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {color: '#fff', fontSize: 18, fontWeight: 'bold'},
  empName: {color: '#fff', fontSize: 15, fontWeight: '600'},
  empId: {color: '#94a3b8', fontSize: 12, marginTop: 2},
  timeBlock: {alignItems: 'flex-end'},
  timeText: {color: '#38bdf8', fontSize: 14, fontWeight: '700'},
  dateText: {color: '#64748b', fontSize: 11, marginTop: 2},
  scoreText: {color: '#22c55e', fontSize: 11, marginTop: 2, fontWeight: '600'},
  avatarIn: {
    backgroundColor: '#166534', // Green for Check-In
  },
  avatarOut: {
    backgroundColor: '#b45309', // Amber for Check-Out
  },
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
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});