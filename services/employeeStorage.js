import AsyncStorage from '@react-native-async-storage/async-storage';

const EMPLOYEES_KEY = '@attendance_employees';
const ATTENDANCE_LOGS_KEY = '@attendance_logs';

export const EmployeeStorage = {
  // Get all registered employees
  async getAllEmployees() {
    try {
      const data = await AsyncStorage.getItem(EMPLOYEES_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load employees', e);
      return [];
    }
  },

  // Save new employee
  async saveEmployee({id, name, department, template}) {
    try {
      const employees = await this.getAllEmployees();
      
      // Convert Float32Array to standard Array for JSON serialization
      const templateArray = Array.from(template);

      const newEmployee = {
        id,
        name,
        department,
        enrolledAt: new Date().toISOString(),
        template: templateArray,
      };

      // Replace if ID exists, else append
      const updated = employees.filter(emp => emp.id !== id);
      updated.push(newEmployee);

      await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(updated));
      console.log(`Saved employee ${name} (${id})`);
      return newEmployee;
    } catch (e) {
      console.error('Failed to save employee', e);
      throw e;
    }
  },

  // Log attendance punch
// Replace logAttendancePunch in EmployeeStorage:
  async logAttendancePunch({employeeId, employeeName, similarityScore}) {
    try {
      const logs = await this.getAttendanceLogs();
      const now = new Date();
      const todayDateStr = now.toDateString();

      // Find all punches today for this specific employee
      const todayPunches = logs.filter(
        (log) =>
          log.employeeId === employeeId &&
          new Date(log.timestamp).toDateString() === todayDateStr,
      );

      // --- 1. DUPLICATE PUNCH RULE (2-Minute Cooldown) ---
      if (todayPunches.length > 0) {
        const lastPunch = todayPunches[0]; // Most recent punch
        const diffMs = now.getTime() - new Date(lastPunch.timestamp).getTime();
        const diffMinutes = diffMs / (1000 * 60);

        if (diffMinutes < 2) {
          const waitSeconds = Math.ceil((2 * 60 * 1000 - diffMs) / 1000);
          return {
            status: 'DUPLICATE_BLOCKED',
            waitSeconds,
            lastType: lastPunch.type,
            employeeName,
          };
        }
      }

      // --- 2. SHIFT IN / OUT LOGIC ---
      // If no punch today -> 'IN'
      // If last punch was 'IN' -> 'OUT'
      // If last punch was 'OUT' -> 'IN'
      let punchType = 'IN';
      if (todayPunches.length > 0) {
        punchType = todayPunches[0].type === 'IN' ? 'OUT' : 'IN';
      }

      const newPunch = {
        id: Date.now().toString(),
        employeeId,
        employeeName,
        timestamp: now.toISOString(),
        score: similarityScore,
        type: punchType,
      };

      logs.unshift(newPunch);
      await AsyncStorage.setItem(ATTENDANCE_LOGS_KEY, JSON.stringify(logs.slice(0, 300)));
      return {
        status: 'SUCCESS',
        punch: newPunch,
      };
    } catch (e) {
      console.error('Failed to log punch', e);
      return { status: 'ERROR' };
    }
  },

  async getAttendanceLogs() {
    try {
      const data = await AsyncStorage.getItem(ATTENDANCE_LOGS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  async clearAll() {
    await AsyncStorage.removeItem(EMPLOYEES_KEY);
    await AsyncStorage.removeItem(ATTENDANCE_LOGS_KEY);
  }
};


export const ConfigStorage = {
  async getConfig() {
    try {
      const [threshold, liveness] = await Promise.all([
        AsyncStorage.getItem('@config_threshold'),
        AsyncStorage.getItem('@config_liveness'),
      ]);
      return {
        threshold: threshold ? parseFloat(threshold) : 0.70,
        liveness: liveness !== null ? liveness === 'true' : true,
      };
    } catch {
      return { threshold: 0.70, liveness: true };
    }
  },
  async setConfig(key, value) {
    await AsyncStorage.setItem(key, String(value));
  }
};