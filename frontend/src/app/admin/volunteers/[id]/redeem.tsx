import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import RedeemRewardPicker from '@/components/admin/redemptions/RedeemRewardPicker';
import { adminRedeemRewards } from '@/services/redemptions';
import { getVolunteerById } from '@/services/volunteers';
import type { Volunteer } from '@/types/volunteer';

export default function RedeemForVolunteerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [volunteer, setVolunteer] = useState<Volunteer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      setVolunteer(await getVolunteerById(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar el voluntario');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2]">
        <ActivityIndicator size="large" color="#e88e29" />
      </View>
    );
  }

  if (error || !volunteer) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2] px-6">
        <Text className="text-center text-sm font-bold text-red-600">{error ?? 'Voluntario no encontrado'}</Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="font-bold text-[#e88e29]">← Regresar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-[#f4f4f2]"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 30 }}
    >
      <TouchableOpacity onPress={() => router.back()} className="mb-4 self-start py-2">
        <Text className="text-sm font-bold text-[#666665]">← Volver al perfil</Text>
      </TouchableOpacity>

      <View className="mb-5">
        <Text className="text-2xl font-extrabold text-zinc-900">Canjear recompensa</Text>
        <Text className="mt-1 text-sm text-[#666665]">Para {volunteer.name}</Text>
      </View>

      <View className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <Text className="text-[10px] font-bold uppercase tracking-wider text-[#666665]">Puntos disponibles</Text>
        <Text className="mt-2 text-2xl font-extrabold text-[#e88e29]">{volunteer.points}</Text>
      </View>

      <RedeemRewardPicker
        points={volunteer.points}
        redeem={(rewardIds, clientRequestId) => adminRedeemRewards(volunteer.id, rewardIds, clientRequestId)}
        onRedeemed={(balance) => setVolunteer((current) => (current ? { ...current, points: balance } : current))}
      />
    </ScrollView>
  );
}
