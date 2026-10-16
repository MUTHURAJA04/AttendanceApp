import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Mail, Lock, LogIn, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../services/supabase';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      Alert.alert('Required Fields', 'Please enter both email and password.');
      return;
    }

    setLoading(true);

    try {
      console.log('[Auth] Attempting login with:', cleanEmail);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password,
      });

      console.log('[Auth] Response data:', JSON.stringify(data));
      console.log('[Auth] Response error:', JSON.stringify(error));

      if (error) {
        Alert.alert('Supabase Error', error.message);
        return;
      }

      if (data?.session) {
        console.log('[Auth] Session obtained! Navigating...');
        try {
          navigation.replace('MainTabs');
        } catch (navError) {
          console.error('[Navigation Error]:', navError);
          Alert.alert('Navigation Error', 'Login worked, but screen MainTabs failed to load: ' + navError.message);
        }
      } else {
        Alert.alert('No Session', 'Check if email confirmation is required.');
      }
    } catch (err) {
      console.error('[Catch Error]:', err);
      Alert.alert('Unexpected Error', err.message || JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <ShieldCheck size={16} color="#38bdf8" />
            <Text style={styles.badge}>ATTENDANCE PORTAL</Text>
          </View>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in with your work email and password</Text>

          <Text style={styles.label}>Email Address</Text>
          <View style={styles.inputWrapper}>
            <Mail size={18} color="#64748b" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="name@company.com"
              placeholderTextColor="#64748b"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrapper}>
            <Lock size={18} color="#64748b" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="••••••••••••"
              placeholderTextColor="#64748b"
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <View style={styles.btnContent}>
                <ActivityIndicator color="#ffffff" size="small" />
                <Text style={styles.buttonText}>Signing In...</Text>
              </View>
            ) : (
              <View style={styles.btnContent}>
                <LogIn size={18} color="#ffffff" />
                <Text style={styles.buttonText}>Sign In</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1e293b',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  badge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 24,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputWrapper: {
    position: 'relative',
    marginBottom: 16,
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    top: 14,
    zIndex: 1,
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#ffffff',
    borderRadius: 8,
    paddingLeft: 42,
    paddingRight: 16,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});