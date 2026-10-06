import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Href, useRouter } from 'expo-router';

const loginRoute = '/login' as Href;

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 justify-center items-center bg-zinc-50 px-6">
      <View className="items-center mb-8">
        <View className="flex-row items-center gap-2 mb-2">
          <Text className="text-3xl font-black text-zinc-900 tracking-tight">RED BAMX</Text>
        </View>
        <Text className="text-[#666665] text-sm font-semibold uppercase tracking-wider">Guadalajara Volunteer Portal</Text>
      </View>

      <TouchableOpacity 
        className="w-full max-w-sm bg-[#e88e29] py-4 rounded-2xl shadow-sm items-center active:opacity-90"
        onPress={() => router.push(loginRoute)}
      >
        <Text className="text-white font-bold text-base">Entrar al admin</Text>
      </TouchableOpacity>
            
    </View>
  );
}
