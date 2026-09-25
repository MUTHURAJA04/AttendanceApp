import React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';

import LoginScreen from '../screens/LoginScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0f172a',
          borderTopColor: '#1e293b',
          height: 62,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: '#38bdf8',
        tabBarInactiveTintColor: '#64748b',
        tabBarIcon: () => {
          let icon = '📷';
          if (route.name === 'Employees') icon = '👥';
          if (route.name === 'History') icon = '📋';
          if (route.name === 'Settings') icon = '⚙️';
          return <Text style={{fontSize: 18}}>{icon}</Text>;
        },
      })}>
      <Tab.Screen name="Kiosk" component={AttendanceScreen} options={{tabBarLabel: 'Attendance'}} />
      <Tab.Screen name="Employees" component={EmployeesScreen} options={{tabBarLabel: 'Employees'}} />
      <Tab.Screen name="History" component={HistoryScreen} options={{tabBarLabel: 'Punch Logs'}} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{tabBarLabel: 'Settings'}} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{headerShown: false}} initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}