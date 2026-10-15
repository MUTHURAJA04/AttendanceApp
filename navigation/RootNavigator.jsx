import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import LoginScreen from '../screens/LoginScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const renderTabIcon = (routeName) => {
  let icon = '📷';
  if (routeName === 'Employees') icon = '👥';
  if (routeName === 'History') icon = '📋';
  if (routeName === 'Settings') icon = '⚙️';
  return <Text style={styles.tabIcon}>{icon}</Text>;
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#38bdf8',
        tabBarInactiveTintColor: '#64748b',
        tabBarIcon: () => renderTabIcon(route.name),
      })}>
      <Tab.Screen name="Kiosk" component={AttendanceScreen} options={{ tabBarLabel: 'Attendance' }} />
      <Tab.Screen name="Employees" component={EmployeesScreen} options={{ tabBarLabel: 'Employees' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ tabBarLabel: 'Punch Logs' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0f172a',
    borderTopColor: '#1e293b',
    height: 62,
    paddingBottom: 8,
  },
  tabIcon: {
    fontSize: 18,
  },
});