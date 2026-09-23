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
  async logAttendancePunch({employeeId, employeeName, similarityScore}) {
    try {
      const logs = await this.getAttendanceLogs();
      const newPunch = {
        id: Date.now().toString(),
        employeeId,
        employeeName,
        timestamp: new Date().toISOString(),
        score: similarityScore,
      };
      logs.unshift(newPunch);
      await AsyncStorage.setItem(ATTENDANCE_LOGS_KEY, JSON.stringify(logs.slice(0, 100))); // keep last 100
      return newPunch;
    } catch (e) {
      console.error('Failed to log attendance', e);
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