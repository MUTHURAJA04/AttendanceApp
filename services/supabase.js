import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bztspepijnvskcwjwjeb.supabase.co';
const supabaseAnonKey = 'sb_publishable_WmVF8jHtS-OYJd6OnhD6wQ_KjU63bf6';
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

export async function testSupabaseConnection() {
  try {
    const startTime = Date.now();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error('❌ Supabase handshake failed:', error.message);
      return { success: false, error: error.message };
    }

    const latency = Date.now() - startTime;
    console.log(`✅ Supabase handshake successful! (${latency}ms)`);
    console.log('Session state:', data.session ? 'Active session restored' : 'No active session');

    return { success: true, latency, session: data.session };
  } catch (err) {
    console.error('❌ Connection or network error:', err?.message || err);
    return { success: false, error: err?.message || 'Network error' };
  }
}