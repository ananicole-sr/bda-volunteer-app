import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// Variables públicas de Expo: deben empezar con EXPO_PUBLIC_ para quedar
// disponibles en el bundle del cliente. Se definen en frontend/.env.local
// (ver frontend/.env.example) y NUNCA deben ser la service_role key, solo
// la anon/public key — la service_role vive exclusivamente en el backend.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copia frontend/.env.example a frontend/.env.local y llena los valores de tu proyecto de Supabase.'
  );
}

// NOTA (MASVS-STORAGE-1, ver Stage2Cybersecurity.pdf sección 5): este
// dashboard todavía no tiene pantalla de login, así que el cliente no
// persiste sesión/tokens en ningún storage. Cuando se implemente 1.5.1
// (Autenticación de administrador), la sesión debe guardarse con
// expo-secure-store, nunca con AsyncStorage plano.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
