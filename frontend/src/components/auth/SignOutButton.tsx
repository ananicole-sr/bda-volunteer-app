import { Text, TouchableOpacity } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const loginRoute = '/login' as Href;

export default function SignOutButton() {
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace(loginRoute);
  };
  return <TouchableOpacity onPress={signOut} className="rounded-full border border-zinc-300 px-4 py-2 active:opacity-70"><Text className="text-sm font-bold text-zinc-700">Salir</Text></TouchableOpacity>;
}
