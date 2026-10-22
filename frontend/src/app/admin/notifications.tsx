import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import RedemptionDeliveryRow from '@/components/admin/redemptions/RedemptionDeliveryRow';
import { listAdminNotifications, markAdminNotificationsRead } from '@/services/adminNotifications';
import { getRedemptionsByRequest } from '@/services/redemptions';
import type { AdminInAppNotification, RedemptionRecord, RedemptionStatus } from '@/types/redemption';

export default function AdminNotificationsScreen() {
  const [items, setItems] = useState<AdminInAppNotification[]>([]);
  // Canjes de cada solicitud: cada uno se entrega por separado.
  const [records, setRecords] = useState<Record<string, RedemptionRecord[]>>({});
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      const page = await listAdminNotifications();
      const requestIds = page.items.map((item) => item.requestId).filter((id): id is string => !!id);
      setRecords(await getRedemptionsByRequest(requestIds));
      setItems(page.items);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar las alertas.'); }
  }, []);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const onDelivered = async (item: AdminInAppNotification, record: RedemptionRecord, requestStatus: RedemptionStatus | null) => {
    if (!item.requestId) return;
    const requestId = item.requestId;
    setRecords((current) => ({
      ...current,
      [requestId]: (current[requestId] ?? []).map((r) => (r.id === record.id ? record : r)),
    }));
    // Cuando la solicitud ya no tiene nada pendiente, la notificacion cuenta como leida.
    if (requestStatus === 'delivered' && !item.readAt) {
      try {
        await markAdminNotificationsRead([item.id]);
        setItems((current) => current.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
      } catch {
        // La entrega ya quedo guardada; el estado de leido se reintenta al recargar.
      }
    }
  };

  return (
    <View className="flex-1 bg-[#f4f4f2] px-6 pb-4">

      <View className="mb-4">
        <Text className="text-xs font-bold uppercase tracking-wider text-[#666665]">
          Alertas en tiempo real
        </Text>
      </View>
      {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator color="#e88e29" /></View> : (
        <ScrollView className="flex-1" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
          {error ? <Text className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</Text> : items.length === 0 ? <Text className="mt-8 text-center text-sm text-[#666665]">No hay notificaciones.</Text> : items.map((item) => {
            const requestRecords = item.requestId ? records[item.requestId] ?? [] : [];
            const pending = requestRecords.some((r) => r.status === 'pending_delivery');
            return (
              <View key={item.id} className={`mb-3 rounded-2xl border p-4 ${pending ? 'border-orange-200 bg-orange-50' : 'border-zinc-200 bg-white'}`}>
                <View className="flex-row">
                  <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white"><Text className="text-lg font-bold text-[#e88e29]">★</Text></View>
                  <View className="flex-1">
                    <Text className="text-sm font-extrabold text-zinc-900">{item.title}</Text>
                    <Text className="mt-1 text-xs leading-5 text-[#666665]">{item.message}</Text>
                    <Text className="mt-1 text-[10px] text-[#a0a09e]">{new Date(item.createdAt).toLocaleDateString('es-MX')}</Text>
                  </View>
                </View>
                {requestRecords.length > 0 ? (
                  <View className="mt-3 rounded-xl bg-white p-2 pb-0">
                    {requestRecords.map((record) => (
                      <RedemptionDeliveryRow
                        key={record.id}
                        record={record}
                        volunteerName={item.payload.volunteer_name}
                        onDelivered={(updated, requestStatus) => onDelivered(item, updated, requestStatus)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
