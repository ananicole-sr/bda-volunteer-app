import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';

import RegisterButton from '@/components/admin /RegisterButton';
import AdminTable from '@/components/admin /AdminTable';
import { getVolunteers } from '@/services/volunteers';
import type { Volunteer } from '@/types/volunteer';

export default function AdminDashboardScreen() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVolunteers = useCallback(async () => {
    try {
      setError(null);
      const data = await getVolunteers();
      setVolunteers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar voluntarios');
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadVolunteers();
      setLoading(false);
    })();
  }, [loadVolunteers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadVolunteers();
    setRefreshing(false);
  }, [loadVolunteers]);

  return (
    <View className="flex-1 px-6 pb-4 bg-[#f4f4f2]">
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-xs text-[#666665] font-bold uppercase tracking-wider">
          Voluntarios activos
        </Text>
        <RegisterButton />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#e88e29" />
          <Text className="text-[#666665] text-xs mt-2">Cargando voluntarios desde Supabase...</Text>
        </View>
      ) : error ? (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4">
            <Text className="text-red-700 text-xs font-semibold">No se pudo conectar a Supabase</Text>
            <Text className="text-red-600 text-xs mt-1">{error}</Text>
          </View>
        </ScrollView>
      ) : (
        <AdminTable data={volunteers} refreshing={refreshing} onRefresh={onRefresh} />
      )}
    </View>
  );
}
