import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { listAdminNotifications, markAllAdminNotificationsRead } from '@/services/adminNotifications';
import type { AdminInAppNotification } from '@/types/redemption';

export default function AdminNotificationsScreen() {
  const [items, setItems] = useState<AdminInAppNotification[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setError(null); setItems((await listAdminNotifications()).items); } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar las alertas.'); } }, []);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const markAll = async () => { await markAllAdminNotificationsRead(); await load(); };
  return (
    <View className="flex-1 bg-[#f4f4f2] px-6 pb-4">
      
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-wider text-[#666665]">
          Alertas en tiempo real
        </Text>
        {items.some((item) => !item.readAt) ? <TouchableOpacity onPress={markAll}><Text className="text-xs font-bold text-[#218750]">Marcar leídas</Text></TouchableOpacity> : null}
      </View>
      {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator color="#e88e29" /></View> : (
        <ScrollView className="flex-1" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
          {error ? <Text className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</Text> : items.length === 0 ? <Text className="mt-8 text-center text-sm text-[#666665]">No hay notificaciones.</Text> : items.map((item) => (
            <View key={item.id} className={`mb-3 flex-row rounded-2xl border p-4 ${item.readAt ? 'border-zinc-200 bg-white' : 'border-orange-200 bg-orange-50'}`}>
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white"><Text className="text-lg font-bold text-[#e88e29]">★</Text></View>
              <View className="flex-1"><Text className="text-sm font-extrabold text-zinc-900">{item.title}</Text><Text className="mt-1 text-xs leading-5 text-[#666665]">{item.message}</Text></View>
              <Text className="ml-2 text-[10px] text-[#a0a09e]">{new Date(item.createdAt).toLocaleDateString('es-MX')}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
