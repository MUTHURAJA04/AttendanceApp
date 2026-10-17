import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { FACE_CONFIG } from '../constants/faceConfig';
import { checkForDuplicateFace } from '../utils/faceEmbeddingUtils';

const EMPLOYEES_KEY = '@attendance_employees';
const ATTENDANCE_LOGS_KEY = '@attendance_logs';
const LAST_SYNCED_KEY = '@attendance_last_synced';
const CONFIG_KEY = '@app_dashboard_config';

/**
 * Standardizes an employee data object from local or cloud source
 */
function formatEmployeeData(emp) {
  if (!emp) return null;

  const rawTemplate = emp.template || emp.face_embedding || null;
  const templateArray = Array.isArray(rawTemplate) && rawTemplate.length > 0 ? Array.from(rawTemplate) : null;
  const hasFace = templateArray !== null && templateArray.length >= (FACE_CONFIG.EMBEDDING_SIZE || 512);

  return {
    id: String(emp.id),
    name: emp.full_name || emp.name || 'Unnamed Staff',
    code: emp.employee_code || emp.code || (emp.id ? String(emp.id).slice(0, 6).toUpperCase() : 'EMP'),
    department: emp.department || emp.role || 'General',
    branch_id: emp.branch_id || emp.branchId || null,
    branchId: emp.branch_id || emp.branchId || null,
    phone: emp.phone || '',
    role: emp.role || '',
    template: templateArray,
    face_embedding: templateArray,
    hasFace: hasFace,
    enrolledAt: emp.enrolledAt || emp.face_updated_at || (hasFace ? new Date().toISOString() : null),
    updatedAt: emp.updated_at || emp.face_updated_at || new Date().toISOString(),
  };
}

export const EmployeeStorage = {
  /**
   * Get all employees stored locally in device storage
   * @returns {Promise<Array>}
   */
  async getAllEmployees() {
    try {
      const data = await AsyncStorage.getItem(EMPLOYEES_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed.map(formatEmployeeData).filter(Boolean) : [];
    } catch (e) {
      console.error('[EmployeeStorage] Failed to load local employees:', e);
      return [];
    }
  },

  /**
   * Get only employees that have enrolled face embeddings (ready for instant matching)
   * @returns {Promise<Array>}
   */
  async getEnrolledEmployees() {
    const list = await this.getAllEmployees();
    return list.filter(emp => emp.hasFace && emp.template && emp.template.length >= FACE_CONFIG.EMBEDDING_SIZE);
  },

  /**
   * Returns the most recent punch for an employee today
   * @param {string} employeeId
   * @returns {Promise<object | null>}
   */
  async getLatestPunchToday(employeeId) {
    try {
      const logs = await this.getAttendanceLogs();
      const now = new Date();
      const todayDateStr = now.toDateString();

      const employeePunchesToday = logs
        .filter(
          (log) =>
            String(log.employeeId) === String(employeeId) &&
            new Date(log.timestamp).toDateString() === todayDateStr,
        )
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return employeePunchesToday.length > 0 ? employeePunchesToday[0] : null;
    } catch {
      return null;
    }
  },

  /**
   * Save or update an employee profile and face embedding locally in AsyncStorage
   * @param {object} employeeData
   * @returns {Promise<object>}
   */
  async saveEmployeeLocally(employeeData) {
    try {
      const employees = await this.getAllEmployees();
      const formatted = formatEmployeeData(employeeData);

      if (!formatted || !formatted.id) {
        throw new Error('Invalid employee data for local storage');
      }

      const updated = employees.filter(emp => String(emp.id) !== String(formatted.id));
      updated.push(formatted);

      // Sort alphabetically by name
      updated.sort((a, b) => a.name.localeCompare(b.name));

      await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(updated));
      console.log(`[EmployeeStorage] Saved local profile & embedding for: ${formatted.name} (${formatted.id})`);
      return formatted;
    } catch (e) {
      console.error('[EmployeeStorage] Failed to save employee locally:', e);
      throw e;
    }
  },

  /**
   * Complete Enrollment Flow: Save face embedding locally AND update Supabase database
   * @param {object} params
   * @param {object} params.employee
   * @param {Array<number>} params.template - 512-D vector
   * @returns {Promise<object>}
   */
  async saveEmployeeFaceCloudAndLocal({ employee, template, skipDuplicateCheck = false }) {
    if (!employee || !employee.id) {
      throw new Error('Missing employee profile for face enrollment');
    }
    if (!template || template.length < FACE_CONFIG.EMBEDDING_SIZE) {
      throw new Error('Invalid embedding vector size');
    }

    const templateArray = Array.from(template);
    const nowIso = new Date().toISOString();

    // Prevent duplicate biometric enrollment across different employees
    if (!skipDuplicateCheck) {
      const allEmployees = await this.getAllEmployees();
      const duplicate = checkForDuplicateFace(templateArray, allEmployees, employee.id);
      if (duplicate.isDuplicate) {
        const existingName = duplicate.existingEmployee.name || duplicate.existingEmployee.full_name || 'Existing Staff';
        const existingCode = duplicate.existingEmployee.code || duplicate.existingEmployee.employee_code || '';
        const matchPct = (duplicate.similarity * 100).toFixed(1);
        const err = new Error(
          `This face is already enrolled for ${existingName}${existingCode ? ` (${existingCode})` : ''} with ${matchPct}% match. The same person cannot be enrolled under multiple employee profiles.`,
        );
        err.code = 'DUPLICATE_FACE';
        err.existingEmployee = duplicate.existingEmployee;
        err.similarity = duplicate.similarity;
        throw err;
      }
    }

    const employeeToSave = {
      ...employee,
      template: templateArray,
      face_embedding: templateArray,
      face_updated_at: nowIso,
      enrolledAt: nowIso,
    };

    // 1. ALWAYS save locally first to guarantee instant offline verification
    const savedLocal = await this.saveEmployeeLocally(employeeToSave);

    // 2. Upload to Supabase in parallel/next step
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          face_embedding: templateArray,
          face_updated_at: nowIso,
        })
        .eq('id', employee.id);

      if (error) {
        console.warn('[EmployeeStorage] Supabase cloud update failed (saved locally only):', error.message);
      } else {
        console.log(`[EmployeeStorage] Cloud face embedding synced successfully for ${employee.name || employee.full_name}`);
      }
    } catch (cloudErr) {
      console.warn('[EmployeeStorage] Cloud sync exception (saved locally):', cloudErr);
    }

    return savedLocal;
  },

  /**
   * Sync staff records and embeddings + remote dashboard configurations from Supabase to local device storage
   * @returns {Promise<Array>}
   */
  async syncEmployeesFromCloud() {
    try {
      // Sync cloud settings simultaneously
      ConfigStorage.syncConfigFromCloud().catch(() => {});

      const { data, error } = await supabase
        .from('employees')
        .select(`
          id,
          full_name,
          employee_code,
          role,
          department,
          branch_id,
          phone,
          status,
          face_embedding,
          face_updated_at
        `)
        .eq('status', 'ACTIVE')
        .order('full_name', { ascending: true });

      const nowIso = new Date().toISOString();
      await AsyncStorage.setItem(LAST_SYNCED_KEY, nowIso);

      if (error) {
        console.warn('[EmployeeStorage] Cloud fetch error, falling back to local:', error.message);
        return await this.getAllEmployees();
      }

      if (Array.isArray(data)) {
        const localList = await this.getAllEmployees();
        const localMap = new Map(localList.map(e => [String(e.id), e]));

        const formattedList = data.map(remoteEmp => {
          const localEmp = localMap.get(String(remoteEmp.id));
          
          // Use remote embedding if available, otherwise preserve local embedding if local was newer
          let chosenTemplate = remoteEmp.face_embedding;
          if ((!chosenTemplate || chosenTemplate.length === 0) && localEmp?.template) {
            chosenTemplate = localEmp.template;
          }

          return formatEmployeeData({
            ...remoteEmp,
            template: chosenTemplate,
          });
        });

        // Store updated list in local storage
        await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(formattedList));
        console.log(`[EmployeeStorage] Synced ${formattedList.length} employees from cloud to local storage at ${nowIso}.`);
        return formattedList;
      }

      return await this.getAllEmployees();
    } catch (err) {
      console.warn('[EmployeeStorage] Sync exception, using local:', err);
      return await this.getAllEmployees();
    }
  },

  /**
   * Get timestamp of last successful cloud synchronization
   * @returns {Promise<string | null>}
   */
  async getLastSyncedTime() {
    try {
      return await AsyncStorage.getItem(LAST_SYNCED_KEY);
    } catch {
      return null;
    }
  },

  /**
   * Log an attendance punch with duplicate prevention & strict alternating IN -> OUT -> IN logic
   * @param {object} params
   * @param {string} params.employeeId
   * @param {string} params.employeeName
   * @param {number} params.similarityScore
   * @param {string} [params.department]
   * @param {string} [params.branchId]
   * @param {string} [params.forcedType]
   * @returns {Promise<{ status: string, waitSeconds?: number, elapsedMinutes?: number, lastType?: string, lastPunch?: object, punch?: object }>}
   */
  async logAttendancePunch({ employeeId, employeeName, similarityScore, department, branchId, cooldownMinutes, forcedType }) {
    try {
      const logs = await this.getAttendanceLogs();
      const now = new Date();
      const todayDateStr = now.toDateString();

      // Find all punches today for this specific employee, sorted descending (newest first)
      const todayPunches = logs
        .filter(
          (log) =>
            String(log.employeeId) === String(employeeId) &&
            new Date(log.timestamp).toDateString() === todayDateStr,
        )
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // --- 1. DUPLICATE PUNCH RULE (Cooldown Check from DB setting) ---
      const activeCooldownMinutes = cooldownMinutes || FACE_CONFIG.PUNCH_COOLDOWN_MINUTES;
      if (todayPunches.length > 0) {
        const lastPunch = todayPunches[0]; // Guaranteed most recent punch
        const diffMs = now.getTime() - new Date(lastPunch.timestamp).getTime();
        const cooldownMs = activeCooldownMinutes * 60 * 1000;

        if (diffMs < cooldownMs) {
          const waitSeconds = Math.ceil((cooldownMs - diffMs) / 1000);
          const elapsedMinutes = Math.max(1, Math.round(diffMs / (60 * 1000)));
          return {
            status: 'DUPLICATE_BLOCKED',
            waitSeconds,
            elapsedMinutes,
            lastType: lastPunch.type || 'IN',
            lastPunch,
            employeeName,
          };
        }
      }

      // --- 2. STRICT IN -> OUT -> IN ALTERNATING LOGIC ---
      let punchType = forcedType || 'IN';
      if (!forcedType && todayPunches.length > 0) {
        const lastType = String(todayPunches[0].type || '').toUpperCase();
        punchType = lastType === 'IN' ? 'OUT' : 'IN';
      }

      const dateStr = now.toISOString().split('T')[0];

      const newPunch = {
        id: Date.now().toString(),
        employeeId: String(employeeId),
        employeeName,
        department: department || 'General',
        branchId: branchId || null,
        timestamp: now.toISOString(),
        date: dateStr,
        status: 'PRESENT',
        attendanceStatus: 'PRESENT',
        score: Number(similarityScore || 0),
        similarityScore: Number(similarityScore || 0),
        type: punchType,
        synced: false,
      };

      logs.unshift(newPunch);
      await AsyncStorage.setItem(ATTENDANCE_LOGS_KEY, JSON.stringify(logs.slice(0, 500)));

      // 3. Background sync punch log & daily attendance to Supabase database
      this._syncPunchToCloud(newPunch).catch((e) => console.log('[EmployeeStorage] Cloud sync non-blocking error:', e));

      return {
        status: 'SUCCESS',
        punch: newPunch,
      };
    } catch (e) {
      console.error('[EmployeeStorage] Failed to log attendance punch:', e);
      return { status: 'ERROR' };
    }
  },

  /**
   * Background cloud punch sync helper (compatible with web app attendance_logs schema)
   */
  async _syncPunchToCloud(punch) {
    try {
      const nowIso = punch.timestamp;
      const todayStart = new Date(nowIso);
      todayStart.setHours(0, 0, 0, 0);

      // If branchId is not in punch object, resolve it from local employee record
      let targetBranchId = punch.branchId;
      if (!targetBranchId) {
        const localList = await this.getAllEmployees();
        const emp = localList.find(e => String(e.id) === String(punch.employeeId));
        targetBranchId = emp?.branch_id || emp?.branchId || null;
      }

      if (punch.type === 'OUT') {
        // Find today's open attendance log for this employee to update check_out
        const { data: openLogs } = await supabase
          .from('attendance_logs')
          .select('id, check_in, check_out')
          .eq('employee_id', punch.employeeId)
          .gte('check_in', todayStart.toISOString())
          .is('check_out', null)
          .order('check_in', { ascending: false })
          .limit(1);

        if (openLogs && openLogs.length > 0) {
          // Update the open check-in with check-out timestamp
          await supabase
            .from('attendance_logs')
            .update({
              check_out: nowIso,
              status: 'PRESENT',
            })
            .eq('id', openLogs[0].id);

          await this._markPunchSyncedLocally(punch.id);
          console.log(`[EmployeeStorage] Cloud attendance_logs check_out updated for ${punch.employeeName}`);
          return;
        }
      }

      // Default or IN punch: Insert new attendance_logs row with status 'PRESENT'
      const { error: logError } = await supabase.from('attendance_logs').insert([
        {
          employee_id: punch.employeeId,
          branch_id: targetBranchId,
          check_in: nowIso,
          check_out: punch.type === 'OUT' ? nowIso : null,
          status: 'PRESENT',
          source: 'BIOMETRIC',
          metadata: {
            similarity_score: punch.score,
            punch_type: punch.type,
            employee_name: punch.employeeName,
            client: 'KIOSK_FACE_VERIFIED',
          },
        },
      ]);

      if (logError) {
        console.warn('[EmployeeStorage] attendance_logs insert error (cached offline):', logError.message);
      } else {
        await this._markPunchSyncedLocally(punch.id);
        console.log(`[EmployeeStorage] ✓ Cloud DB updated: ${punch.employeeName} marked PRESENT (${punch.type})`);
      }
    } catch (err) {
      console.warn('[EmployeeStorage] Cloud attendance sync failed (cached offline):', err?.message || err);
    }
  },

  async _markPunchSyncedLocally(punchId) {
    try {
      const logs = await this.getAttendanceLogs();
      const updated = logs.map(l => (String(l.id) === String(punchId) ? { ...l, synced: true } : l));
      await AsyncStorage.setItem(ATTENDANCE_LOGS_KEY, JSON.stringify(updated));
    } catch {
      // Non-blocking
    }
  },

  /**
   * Syncs any locally cached offline punches that failed to upload when device had no network
   */
  async syncPendingOfflinePunches() {
    try {
      const logs = await this.getAttendanceLogs();
      const unsynced = logs.filter(l => l && !l.synced);
      if (unsynced.length === 0) return 0;
      console.log(`[EmployeeStorage] Found ${unsynced.length} offline punches to sync...`);
      for (const p of unsynced) {
        await this._syncPunchToCloud(p);
      }
      return unsynced.length;
    } catch (e) {
      console.warn('[EmployeeStorage] Offline punch queue sync exception:', e);
      return 0;
    }
  },

  /**
   * Retrieve all recorded attendance logs
   * @returns {Promise<Array>}
   */
  async getAttendanceLogs() {
    try {
      const data = await AsyncStorage.getItem(ATTENDANCE_LOGS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },
};

export const ConfigStorage = {
  /**
   * Default fallback settings if DB is not reachable
   */
  getDefaults() {
    return {
      threshold: FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD,
      liveness: true,
      enrollmentSamples: FACE_CONFIG.ENROLLMENT_SAMPLE_TARGET,
      sampleIntervalMs: FACE_CONFIG.SAMPLE_INTERVAL_MS,
      yawAngleTolerance: FACE_CONFIG.MAX_HEAD_YAW_DEGREES,
      cooldownMinutes: FACE_CONFIG.PUNCH_COOLDOWN_MINUTES,
    };
  },

  /**
   * Read locally cached settings
   */
  async getConfig() {
    try {
      const data = await AsyncStorage.getItem(CONFIG_KEY);
      if (data) {
        return { ...this.getDefaults(), ...JSON.parse(data) };
      }
      return this.getDefaults();
    } catch {
      return this.getDefaults();
    }
  },

  /**
   * Fetch all app & biometric configuration from Supabase organization_settings table
   */
  async syncConfigFromCloud() {
    try {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('key, value');

      if (error || !Array.isArray(data)) {
        console.warn('[ConfigStorage] Cloud config fetch warning, using local:', error?.message);
        return await this.getConfig();
      }

      const settingsMap = {};
      for (const row of data) {
        let val = row.value;
        try {
          val = JSON.parse(row.value);
        } catch {
          val = row.value;
        }
        settingsMap[row.key] = val;
      }

      const current = await this.getConfig();
      const updated = {
        ...current,
        // Anti-spoofing / Liveness
        liveness: typeof settingsMap.anti_spoofing_enabled === 'boolean'
          ? settingsMap.anti_spoofing_enabled
          : typeof settingsMap.liveness_blink_required === 'boolean'
          ? settingsMap.liveness_blink_required
          : current.liveness,

        // Similarity Match Threshold
        threshold: typeof settingsMap.similarity_threshold === 'number'
          ? settingsMap.similarity_threshold
          : typeof settingsMap.similarity_threshold === 'string'
          ? parseFloat(settingsMap.similarity_threshold)
          : current.threshold,

        // Sample Count for Face Registration
        enrollmentSamples: typeof settingsMap.enrollment_samples === 'number'
          ? settingsMap.enrollment_samples
          : typeof settingsMap.enrollment_samples === 'string'
          ? parseInt(settingsMap.enrollment_samples, 10)
          : current.enrollmentSamples,

        // Sample Interval (ms)
        sampleIntervalMs: typeof settingsMap.sample_interval_ms === 'number'
          ? settingsMap.sample_interval_ms
          : typeof settingsMap.sample_interval_ms === 'string'
          ? parseInt(settingsMap.sample_interval_ms, 10)
          : current.sampleIntervalMs,

        // Yaw Angle Tolerance (degrees)
        yawAngleTolerance: typeof settingsMap.yaw_angle_tolerance === 'number'
          ? settingsMap.yaw_angle_tolerance
          : typeof settingsMap.yaw_angle_tolerance === 'string'
          ? parseInt(settingsMap.yaw_angle_tolerance, 10)
          : current.yawAngleTolerance,

        // Cooldown Lockout (minutes)
        cooldownMinutes: typeof settingsMap.double_punch_lockout_mins === 'number'
          ? settingsMap.double_punch_lockout_mins
          : typeof settingsMap.double_punch_lockout_mins === 'string'
          ? parseInt(settingsMap.double_punch_lockout_mins, 10)
          : current.cooldownMinutes,
      };

      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
      console.log('[ConfigStorage] ✓ Synced configuration from DB:', updated);
      return updated;
    } catch (err) {
      console.warn('[ConfigStorage] Sync exception:', err);
      return await this.getConfig();
    }
  },

  async setConfig(key, value) {
    try {
      const current = await this.getConfig();
      current[key] = value;
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(current));
    } catch {
      // Non-blocking
    }
  },
};