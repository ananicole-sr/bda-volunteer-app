import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const loginRoute = '/login' as Href;

export default function AdminHeader() {
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace(loginRoute);
  };

  return (
    <View className="-ml-12 flex-row items-center justify-between">
      <Image 
        source={require('frontend/assets/logo.png')} 
        className="h-20 w-60"
        resizeMode="contain" 
      />
      <TouchableOpacity
        className="rounded-full border border-zinc-300 px-4 py-2 active:opacity-70"
        onPress={handleSignOut}
      >
        <Text className="text-sm font-bold text-zinc-700">Salir</Text>
      </TouchableOpacity>
    </View>
  );
}
