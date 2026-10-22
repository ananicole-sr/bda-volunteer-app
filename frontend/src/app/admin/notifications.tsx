import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { listAdminNotifications, markAdminNotificationsRead } from '@/services/adminNotifications';
import { getRedemptionStatuses, markRedemptionDelivered } from '@/services/redemptions';
import type { AdminInAppNotification, RedemptionStatus } from '@/types/redemption';

export default function AdminNotificationsScreen() {
  const [items, setItems] = useState<AdminInAppNotification[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RedemptionStatus>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [deliverError, setDeliverError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      const page = await listAdminNotifications();
      const requestIds = page.items.map((item) => item.requestId).filter((id): id is string => !!id);
      setStatuses(await getRedemptionStatuses(requestIds));
      setItems(page.items);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar las alertas.'); }
  }, []);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Entregar no se puede deshacer, asi que la casilla pide confirmacion y solo va de pendiente a entregada.
  const markDelivered = async (item: AdminInAppNotification) => {
    if (!item.requestId) return;
    try {
      setDelivering(item.id); setDeliverError(null);
      const result = await markRedemptionDelivered(item.requestId);
      if (result.code !== 'ok') { setDeliverError(result.message ?? 'La solicitud de canje ya no existe.'); return; }
      setStatuses((current) => ({ ...current, [item.requestId as string]: 'delivered' }));
      setConfirming(null);
      // Una entrega atendida tambien cuenta como leida.
      if (!item.readAt) {
        await markAdminNotificationsRead([item.id]);
        setItems((current) => current.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
      }
    } catch (err) { setDeliverError(err instanceof Error ? err.message : 'No se pudo marcar como entregada. Intenta de nuevo.'); }
    finally { setDelivering(null); }
  };

  return (
    <View className="flex-1 bg-[#f4f4f2] px-6 pb-4">

      <View className="mb-4">
        <Text className="text-xs font-bold uppercase tracking-wider text-[#666665]">
          Alertas en tiempo real
        </Text>
      </View>
      {deliverError ? <Text className="mb-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{deliverError}</Text> : null}
      {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator color="#e88e29" /></View> : (
        <ScrollView className="flex-1" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
          {error ? <Text className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</Text> : items.length === 0 ? <Text className="mt-8 text-center text-sm text-[#666665]">No hay notificaciones.</Text> : items.map((item) => {
            const status = item.requestId ? statuses[item.requestId] : undefined;
            const delivered = status === 'delivered';
            const busy = delivering === item.id;
            const askingConfirm = confirming === item.id && !delivered;
            return (
              <View key={item.id} className={`mb-3 rounded-2xl border p-4 ${delivered ? 'border-zinc-200 bg-white' : 'border-orange-200 bg-orange-50'}`}>
              <View className="flex-row">
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white"><Text className="text-lg font-bold text-[#e88e29]">★</Text></View>
                <View className="flex-1">
                  <Text className="text-sm font-extrabold text-zinc-900">{item.title}</Text>
                  <Text className="mt-1 text-xs leading-5 text-[#666665]">{item.message}</Text>
                  <Text className="mt-1 text-[10px] text-[#a0a09e]">{new Date(item.createdAt).toLocaleDateString('es-MX')}</Text>
                </View>
                {status ? (
                  <TouchableOpacity
                    disabled={delivered || busy}
                    onPress={() => setConfirming(askingConfirm ? null : item.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: delivered, disabled: delivered || busy }}
                    className="ml-2 items-center self-center"
                  >
                    <View className={`h-7 w-7 items-center justify-center rounded-lg border-2 ${delivered ? 'border-[#218750] bg-[#218750]' : 'border-[#e88e29] bg-white'}`}>
                      {busy ? <ActivityIndicator size="small" color="#e88e29" /> : delivered ? <Text className="text-sm font-extrabold text-white">✓</Text> : null}
                    </View>
                    <Text className={`mt-1 text-[10px] font-bold ${delivered ? 'text-[#218750]' : 'text-[#e88e29]'}`}>
                      {delivered ? 'Entregada' : 'Entregar'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {askingConfirm ? (
                <View className="mt-3 border-t border-orange-200 pt-3">
                  <Text className="mb-3 text-xs font-bold text-zinc-900">
                    ¿Confirmar entrega{item.payload.volunteer_name ? ` a ${item.payload.volunteer_name}` : ''}? No se puede deshacer.
                  </Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      disabled={busy}
                      onPress={() => setConfirming(null)}
                      className="flex-1 items-center rounded-xl border border-zinc-300 bg-white py-2.5"
                    >
                      <Text className="text-xs font-bold text-zinc-700">Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={busy}
                      onPress={() => markDelivered(item)}
                      className={`flex-1 items-center rounded-xl bg-[#218750] py-2.5 ${busy ? 'opacity-60' : ''}`}
                    >
                      <Text className="text-xs font-bold text-white">{busy ? 'Guardando…' : 'Sí, entregada'}</Text>
                    </TouchableOpacity>
                  </View>
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
