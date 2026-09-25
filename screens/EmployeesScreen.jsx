import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import RegisterFaceModal from './RegisterFaceModal';

export default function EmployeesScreen() {
  const isFocused = useIsFocused();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // 1. Fetch employees with face_embedding & face_updated_at
  const loadData = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('employees')
        .select(`
          id,
          full_name,
          employee_code,
          role,
          department,
          phone,
          status,
          face_embedding,
          face_updated_at
        `)
        .eq('status', 'ACTIVE')
        .order('full_name', { ascending: true });

      if (error) {
        throw error;
      }

      // Map backend fields to screen UI
      const formatted = (data || []).map((emp) => {
        const hasFace =
          emp.face_embedding !== null &&
          Array.isArray(emp.face_embedding) &&
          emp.face_embedding.length > 0;

        return {
          id: emp.id,
          name: emp.full_name || 'Unnamed Staff',
          code: emp.employee_code || emp.id.slice(0, 6).toUpperCase(),
          department: emp.department || emp.role || 'General',
          phone: emp.phone,
          hasFace: hasFace,
          faceEmbedding: emp.face_embedding,
          faceUpdatedAt: emp.face_updated_at,
        };
      });

      setEmployees(formatted);
    } catch (err) {
      console.error('[Fetch Employees Error]:', err);
      Alert.alert('Error', err.message || 'Failed to load employees.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isFocused) {
      loadData();
    }
  }, [isFocused]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Filter employees based on search bar
  const filteredEmployees = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.code.toLowerCase().includes(search.toLowerCase()) ||
      e.department?.toLowerCase().includes(search.toLowerCase()) ||
      e.phone?.includes(search)
  );

  const enrolledCount = employees.filter((e) => e.hasFace).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Staff Directory</Text>
          <Text style={styles.subtitle}>
            {loading
              ? 'Loading...'
              : `${enrolledCount} / ${employees.length} Faces Enrolled`}
          </Text>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, code or department..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Employee List */}
      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.emptySub}>Loading staff from database...</Text>
        </View>
      ) : filteredEmployees.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>
            {search ? 'No matching employee found' : 'No employees in database'}
          </Text>
          <Text style={styles.emptySub}>
            {search
              ? 'Try another search term'
              : 'Add employees from web dashboard to see them here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredEmployees}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#38bdf8"
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              {/* Avatar Initial */}
              <View
                style={[
                  styles.avatar,
                  item.hasFace ? styles.avatarEnrolled : styles.avatarUnenrolled,
                ]}
              >
                <Text style={styles.avatarText}>
                  {item.name ? item.name.charAt(0).toUpperCase() : '?'}
                </Text>
              </View>

              {/* Info & Face Status */}
              <View style={{ flex: 1 }}>
                <Text style={styles.empName}>{item.name}</Text>
                <Text style={styles.empId}>
                  Code: {item.code} • {item.department}
                </Text>

                {/* Face Status Pill */}
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      item.hasFace ? styles.dotGreen : styles.dotAmber,
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      item.hasFace ? styles.textGreen : styles.textAmber,
                    ]}
                  >
                    {item.hasFace ? 'Face Enrolled' : 'No Face'}
                  </Text>
                </View>
              </View>

              {/* Button: "Update Face" if enrolled, "+ Enroll" if not */}
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  item.hasFace ? styles.updateBtn : styles.enrollBtn,
                ]}
                onPress={() => {
                  setSelectedEmployee(item);
                  setShowRegisterModal(true);
                }}
              >
                <Text
                  style={[
                    styles.actionBtnText,
                    item.hasFace ? styles.updateBtnText : styles.enrollBtnText,
                  ]}
                >
                  {item.hasFace ? 'Update' : '+ Enroll'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Face Registration / Update Modal */}
      <RegisterFaceModal
        visible={showRegisterModal}
        employee={selectedEmployee}
        onClose={() => {
          setSelectedEmployee(null);
          setShowRegisterModal(false);
        }}
        onEnrolled={() => {
          setSelectedEmployee(null);
          setShowRegisterModal(false);
          loadData(); // Re-fetch to update the badge immediately
        }}
      />
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
  subtitle: { color: '#38bdf8', fontSize: 13, marginTop: 4, fontWeight: '600' },
  searchContainer: { paddingHorizontal: 16, paddingTop: 14 },
  searchInput: {
    backgroundColor: '#1e293b',
    color: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  emptySub: { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 4 },
  card: {
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
  avatarEnrolled: { backgroundColor: '#059669' },
  avatarUnenrolled: { backgroundColor: '#334155' },
  avatarText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  empName: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  empId: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  dotGreen: { backgroundColor: '#10b981' },
  dotAmber: { backgroundColor: '#f59e0b' },
  statusText: { fontSize: 11, fontWeight: '600' },
  textGreen: { color: '#10b981' },
  textAmber: { color: '#f59e0b' },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  enrollBtn: { backgroundColor: '#2563eb' },
  enrollBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  updateBtn: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569' },
  updateBtnText: { color: '#38bdf8', fontSize: 13, fontWeight: '600' },
});