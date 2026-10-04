import React from 'react';

import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';

import RewardForm from '@/components/admin/rewards/RewardForm';

export default function AddRewardScreen() {
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
          ← Volver a recompensas
        </Text>
      </TouchableOpacity>

      <View className="mb-5">
        <Text className="text-2xl font-extrabold text-zinc-900">
          Agregar recompensa
        </Text>

        <Text className="mt-1 text-sm text-[#666665]">
          Agrega una nueva recompensa al catálogo
        </Text>
      </View>

      <RewardForm buttonLabel="Agregar recompensa" />
    </ScrollView>
  );
}