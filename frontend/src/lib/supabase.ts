import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copia frontend/.env.example a frontend/.env.local y llena los valores de tu proyecto de Supabase.'
    );
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  return supabaseClient;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, property, receiver);

    return typeof value === 'function' ? value.bind(client) : value;
  },
});
