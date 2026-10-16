import React from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { ScanFace, Users, ClipboardList, Settings } from 'lucide-react-native';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { loadKioskSettings, subscribeToLiveSettings } from '../services/kioskSettings';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const renderTabIcon = (routeName, color, size = 22) => {
  if (routeName === 'Employees') return <Users color={color} size={size} />;
  if (routeName === 'History') return <ClipboardList color={color} size={size} />;
  if (routeName === 'Settings') return <Settings color={color} size={size} />;
  return <ScanFace color={color} size={size} />;
};

function MainTabs({ navigation }) {
  const resetTimerRef = React.useRef(null);
  const timeoutSecondsRef = React.useRef(60);

  React.useEffect(() => {
    loadKioskSettings().then((cfg) => {
      if (cfg?.autoResetSeconds) {
        timeoutSecondsRef.current = Number(cfg.autoResetSeconds);
      }
    });

    const sub = subscribeToLiveSettings((updated) => {
      if (updated?.autoResetSeconds) {
        timeoutSecondsRef.current = Number(updated.autoResetSeconds);
      }
    });

    return () => {
      if (sub?.unsubscribe) sub.unsubscribe();
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleStateChange = (state) => {
    if (!state) return;
    const currentRoute = state.routes[state.index];

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    // If screen is not Kiosk (e.g. Employees, History, Settings), start auto-reset countdown
    if (currentRoute && currentRoute.name !== 'Kiosk') {
      const ms = (timeoutSecondsRef.current || 60) * 1000;
      resetTimerRef.current = setTimeout(() => {
        console.log(`[Kiosk Inactivity] Screen reset timeout (${timeoutSecondsRef.current}s). Navigating back to Kiosk camera.`);
        navigation.navigate('Kiosk');
      }, ms);
    }
  };

  return (
    <Tab.Navigator
      screenListeners={{
        state: (e) => handleStateChange(e.data?.state),
      }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#38bdf8',
        tabBarInactiveTintColor: '#64748b',
        tabBarIcon: ({ color, size }) => renderTabIcon(route.name, color, size),
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
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'fade' }}
        initialRouteName="Splash">
        <Stack.Screen name="Splash" component={SplashScreen} />
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