import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';

import {
  useLocalSearchParams,
  useRouter,
} from 'expo-router';

import RewardForm from '@/components/admin/rewards/RewardForm';
import { getRewardById } from '@/services/rewards';
import type { Reward } from '@/types/reward';

export default function EditRewardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [reward, setReward] = useState<Reward | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReward = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const data = await getRewardById(id);

      setReward(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error desconocido al cargar la recompensa'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReward();
  }, [loadReward]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2]">
        <ActivityIndicator
          size="large"
          color="#e88e29"
        />

        <Text className="mt-2 text-xs text-[#666665]">
          Cargando recompensa...
        </Text>
      </View>
    );
  }

  if (error || !reward) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2] px-6">
        <Text className="text-center text-sm font-bold text-red-600">
          {error ?? 'Recompensa no encontrada'}
        </Text>

        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-4"
        >
          <Text className="font-bold text-[#e88e29]">
            ← Regresar
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

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
          Editar recompensa
        </Text>

        <Text className="mt-1 text-sm text-[#666665]">
          Modifica la información de la recompensa
        </Text>
      </View>

      <RewardForm
        name={reward.name}
        description={reward.description}
        points={reward.points}
        stock={reward.stock}
        buttonLabel="Guardar cambios"
      />
    </ScrollView>
  );
}