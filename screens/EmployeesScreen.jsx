import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  RefreshControl,
  Alert,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Search, Users, UserX } from 'lucide-react-native';
import { EmployeeStorage } from '../services/employeeStorage';
import RegisterFaceModal from './RegisterFaceModal';
import EmployeeItemCard from '../components/EmployeeItemCard';
import SimpleLoading from '../components/SimpleLoading';

export default function EmployeesScreen() {
  const isFocused = useIsFocused();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Load employees from Local Storage & Sync with Supabase Cloud
  const loadEmployeesData = useCallback(async (isPullRefresh = false) => {
    try {
      if (!isPullRefresh) setLoading(true);

      // 1. Initial immediate load from local cache
      const localData = await EmployeeStorage.getAllEmployees();
      if (localData && localData.length > 0) {
        setEmployees(localData);
      }

      // 2. Fetch fresh updates from cloud and update local storage
      const syncedData = await EmployeeStorage.syncEmployeesFromCloud();
      setEmployees(syncedData);
    } catch (err) {
      console.error('[EmployeesScreen] Load error:', err);
      // If error occurs, at least ensure local data is shown
      const fallbackData = await EmployeeStorage.getAllEmployees();
      setEmployees(fallbackData);
      if (isPullRefresh) {
        Alert.alert('Sync Notice', 'Could not reach cloud database. Showing local offline data.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadEmployeesData(false);
    }
  }, [isFocused, loadEmployeesData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadEmployeesData(true);
  };

  // Filter employees based on search query
  const filteredEmployees = employees.filter((e) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (e.name && e.name.toLowerCase().includes(q)) ||
      (e.code && e.code.toLowerCase().includes(q)) ||
      (e.department && e.department.toLowerCase().includes(q)) ||
      (e.phone && e.phone.includes(q))
    );
  });

  const enrolledCount = employees.filter((e) => e.hasFace).length;

  return (
    <View style={styles.container}>
      {/* Screen Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Staff Directory</Text>
          <View style={styles.subtitleRow}>
            <Users size={13} color="#38bdf8" />
            <Text style={styles.subtitle}>
              {loading
                ? 'Syncing staff database...'
                : `${enrolledCount} / ${employees.length} Faces Enrolled Locally`}
            </Text>
          </View>
        </View>
      </View>

      {/* Search Bar with Search Icon */}
      <View style={styles.searchContainer}>
        <Search size={18} color="#64748b" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, code or department..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Employee List */}
      {loading && employees.length === 0 ? (
        <View style={styles.emptyContainer}>
          <SimpleLoading
            text="Loading Staff Directory"
            subtext="Fetching profiles & local face vectors..."
            size="medium"
          />
        </View>
      ) : filteredEmployees.length === 0 ? (
        <View style={styles.emptyContainer}>
          <UserX size={44} color="#475569" style={{ marginBottom: 12 }} />
          <Text style={styles.emptyTitle}>
            {search ? 'No matching employee found' : 'No staff registered'}
          </Text>
          <Text style={styles.emptySub}>
            {search
              ? 'Try adjusting your search keywords.'
              : 'Add staff members to database or pull down to refresh.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredEmployees}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#38bdf8"
            />
          }
          renderItem={({ item }) => (
            <EmployeeItemCard
              employee={item}
              onEnrollPress={() => {
                setSelectedEmployee(item);
                setShowRegisterModal(true);
              }}
            />
          )}
        />
      )}

      {/* Face Registration / Update Modal */}
      {showRegisterModal && selectedEmployee && (
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
            loadEmployeesData(false); // Reload to update face badges
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
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
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  subtitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    position: 'relative',
  },
  searchIcon: {
    position: 'absolute',
    left: 28,
    top: 25,
    zIndex: 1,
  },
  searchInput: {
    backgroundColor: '#1e293b',
    color: '#ffffff',
    borderRadius: 10,
    paddingLeft: 38,
    paddingRight: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySub: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  listContent: {
    padding: 16,
  },
});