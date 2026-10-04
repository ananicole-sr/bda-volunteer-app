import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
} from 'react-native';

import RewardList from '@/components/admin/rewards/RewardList';
import { getRewards } from '@/services/rewards';
import type { Reward } from '@/types/reward';
import { useRouter } from 'expo-router';


export default function AdminRewardsScreen() {
  const router = useRouter();

  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRewards = useCallback(async () => {
    try {
      setError(null);

      const data = await getRewards();

      setRewards(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error desconocido al cargar recompensas'
      );
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadRewards();
      setLoading(false);
    })();
  }, [loadRewards]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRewards();
    setRefreshing(false);
  }, [loadRewards]);

  return (
    <View className="flex-1 bg-[#f4f4f2] px-6 pb-4">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-wider text-[#666665]">
          Gestión de catálogo
        </Text>

        <TouchableOpacity
          onPress={() => router.push('/admin/rewards/add')}
          className="rounded-xl bg-[#e88e29] px-4 py-2.5">
          <Text className="text-sm font-bold text-white">
            + Añadir
          </Text>
        </TouchableOpacity>

        </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#e88e29" />

          <Text className="mt-2 text-xs text-[#666665]">
            Cargando recompensas desde Supabase...
          </Text>
        </View>
      ) : error ? (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          }
        >
          <View className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <Text className="text-xs font-semibold text-red-700">
              No se pudieron cargar las recompensas
            </Text>

            <Text className="mt-1 text-xs text-red-600">
              {error}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <RewardList
          data={rewards}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </View>
  );
}