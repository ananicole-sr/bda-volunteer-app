import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { markRedemptionItemDelivered } from '@/services/redemptions';
import type { RedemptionRecord, RedemptionStatus } from '@/types/redemption';

interface RedemptionDeliveryRowProps {
  record: RedemptionRecord;
  /** Para el texto de confirmacion ("¿Confirmar entrega a ...?"). */
  volunteerName?: string;
  /** Muestra la fecha del canje (historial del perfil). */
  showDate?: boolean;
  onDelivered: (record: RedemptionRecord, requestStatus: RedemptionStatus | null) => void;
}

export function redemptionStatusLabel(status: RedemptionStatus | null): string {
  if (status === 'delivered') return 'Canjeada';
  if (status === 'pending_delivery') return 'Pendiente de entrega';
  return 'Sin estado';
}

/**
 * Un canje con su propio estado. La casilla entrega SOLO este canje, previa
 * confirmacion; no se puede deshacer, asi que una vez entregada queda fija.
 */
export default function RedemptionDeliveryRow({
  record,
  volunteerName,
  showDate = false,
  onDelivered,
}: RedemptionDeliveryRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delivered = record.status === 'delivered';
  const deliverable = record.status === 'pending_delivery';

  const deliver = async () => {
    try {
      setDelivering(true);
      setError(null);
      const result = await markRedemptionItemDelivered(record.id);
      if (result.code !== 'ok') {
        setError(result.message ?? 'El canje ya no existe.');
        return;
      }
      setConfirming(false);
      onDelivered(result.redemption, result.requestStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar como entregada. Intenta de nuevo.');
    } finally {
      setDelivering(false);
    }
  };

  return (
    <View className={`mb-2 rounded-xl px-3 py-2.5 ${deliverable ? 'bg-orange-50' : 'bg-[#f4f4f2]'}`}>
      <View className="flex-row items-center">
        <View className="mr-3 flex-1">
          <Text className="text-sm font-bold text-zinc-900">{record.name ?? 'Recompensa no disponible'}</Text>
          <Text className="mt-0.5 text-xs text-[#666665]">
            {record.pointsSpent} pts
            {showDate ? ` · ${new Date(record.redeemedAt).toLocaleString('es-MX')}` : ''}
          </Text>
          <Text className={`mt-0.5 text-[10px] font-bold uppercase ${delivered ? 'text-[#218750]' : deliverable ? 'text-[#e88e29]' : 'text-[#a0a09e]'}`}>
            {redemptionStatusLabel(record.status)}
          </Text>
        </View>

        {deliverable || delivered ? (
          <TouchableOpacity
            disabled={!deliverable || delivering}
            onPress={() => setConfirming((current) => !current)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: delivered, disabled: !deliverable || delivering }}
            className="items-center"
          >
            <View className={`h-7 w-7 items-center justify-center rounded-lg border-2 ${delivered ? 'border-[#218750] bg-[#218750]' : 'border-[#e88e29] bg-white'}`}>
              {delivering ? <ActivityIndicator size="small" color="#e88e29" /> : delivered ? <Text className="text-sm font-extrabold text-white">✓</Text> : null}
            </View>
            <Text className={`mt-1 text-[10px] font-bold ${delivered ? 'text-[#218750]' : 'text-[#e88e29]'}`}>
              {delivered ? 'Entregada' : 'Entregar'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {confirming && deliverable ? (
        <View className="mt-3 border-t border-orange-200 pt-3">
          <Text className="mb-3 text-xs font-bold text-zinc-900">
            ¿Confirmar entrega de {record.name ?? 'esta recompensa'}{volunteerName ? ` a ${volunteerName}` : ''}? No se puede deshacer.
          </Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              disabled={delivering}
              onPress={() => setConfirming(false)}
              className="flex-1 items-center rounded-xl border border-zinc-300 bg-white py-2.5"
            >
              <Text className="text-xs font-bold text-zinc-700">Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={delivering}
              onPress={deliver}
              className={`flex-1 items-center rounded-xl bg-[#218750] py-2.5 ${delivering ? 'opacity-60' : ''}`}
            >
              <Text className="text-xs font-bold text-white">{delivering ? 'Guardando…' : 'Sí, entregada'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {error ? <Text className="mt-2 text-xs font-semibold text-red-600">{error}</Text> : null}
    </View>
  );
}
