import React from 'react';

import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';

import VolunteerForm from '@/components/admin/dashboard/VolunteerForm';

export default function RegisterVolunteerScreen() {
  const router = useRouter();

  return (
    <ScrollView
      className="flex-1 bg-[#f4f4f2]"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingBottom: 30,
      }}
    >
      <TouchableOpacity
        onPress={() => router.back()}
        className="mb-4 self-start py-2"
      >
        <Text className="text-sm font-bold text-[#666665]">
          ← Volver al dashboard
        </Text>
      </TouchableOpacity>

      <View className="mb-5">
        <Text className="text-2xl font-extrabold text-zinc-900">
          Registrar voluntario
        </Text>

        <Text className="mt-1 text-sm leading-5 text-[#666665]">
          Agrega un nuevo voluntario al sistema
        </Text>
      </View>

      <VolunteerForm />
    </ScrollView>
  );
}