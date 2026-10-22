import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { createRedemptionRequestId } from '@/services/redemptions';
import { getRewards } from '@/services/rewards';
import type { Reward } from '@/types/reward';

/** Lo minimo que devuelven adminRedeemRewards y redeemRewardsWithCard. */
type RedeemResponse = { code: string; message?: string; balance?: number };

interface RedeemRewardPickerProps {
  /** Saldo actual del voluntario; las recompensas que no alcanza quedan deshabilitadas. */
  points: number;
  redeem: (rewardIds: string[], clientRequestId: string) => Promise<RedeemResponse>;
  onRedeemed: (balance: number) => void;
}

const REJECTION_MESSAGES: Record<string, string> = {
  insufficient_points: 'El voluntario no tiene puntos suficientes.',
  reward_unavailable: 'La recompensa ya no está disponible (sin stock o desactivada).',
  volunteer_inactive: 'El voluntario está inactivo.',
  volunteer_not_found: 'El voluntario ya no existe.',
  card_unknown: 'La tarjeta no está registrada.',
  card_inactive: 'La tarjeta no está activa.',
  idempotency_conflict: 'Conflicto con un canje anterior. Intenta de nuevo.',
};

/**
 * Catalogo de recompensas activas con canje de una en una, previa
 * confirmacion. Cada canje es un registro propio, pendiente de entrega.
 */
export default function RedeemRewardPicker({ points, redeem, onRedeemed }: RedeemRewardPickerProps) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Reintento tras error de red: misma recompensa => mismo clientRequestId (no cobra dos veces).
  const pendingAttempt = useRef<{ rewardId: string; requestId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setRewards(await getRewards());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar las recompensas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = async (reward: Reward) => {
    const requestId =
      pendingAttempt.current?.rewardId === reward.id ? pendingAttempt.current.requestId : createRedemptionRequestId();
    pendingAttempt.current = { rewardId: reward.id, requestId };

    try {
      setRedeeming(true);
      setError(null);
      setSuccess(null);
      const result = await redeem([reward.id], requestId);
      pendingAttempt.current = null;

      if (result.code !== 'ok') {
        setError(REJECTION_MESSAGES[result.code] ?? result.message ?? 'No se pudo realizar el canje.');
        return;
      }

      setConfirming(null);
      setSuccess(`Canje registrado: ${reward.name}. Queda pendiente de entrega.`);
      onRedeemed(result.balance ?? points - reward.points);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo realizar el canje. Intenta de nuevo.');
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return <View className="mt-6"><ActivityIndicator color="#e88e29" /></View>;
  }

  if (loadError) {
    return <Text className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{loadError}</Text>;
  }

  return (
    <View>
      {success ? (
        <Text className="mb-3 rounded-xl bg-green-50 p-3 text-xs font-semibold text-[#218750]">{success}</Text>
      ) : null}
      {error ? <Text className="mb-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</Text> : null}

      {rewards.length === 0 ? (
        <Text className="mt-4 text-center text-sm text-[#666665]">No hay recompensas activas.</Text>
      ) : rewards.map((reward) => {
        const outOfStock = reward.stock < 1;
        const notEnough = points < reward.points;
        const available = !outOfStock && !notEnough;
        const askingConfirm = confirming === reward.id;

        return (
          <View key={reward.id} className="mb-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <View className="flex-row items-start justify-between">
              <View className="mr-3 flex-1">
                <Text className="text-base font-extrabold text-zinc-900">{reward.name}</Text>
                <Text className="mt-1 text-xs leading-5 text-[#666665]">{reward.description}</Text>
              </View>
              <Text className="font-extrabold text-[#e88e29]">{reward.points} pts</Text>
            </View>

            <View className="mt-4 flex-row items-center justify-between">
              <Text className="text-xs font-semibold text-[#666665]">{reward.stock} disponibles</Text>
              <TouchableOpacity
                disabled={!available || redeeming}
                onPress={() => { setError(null); setConfirming(askingConfirm ? null : reward.id); }}
                className={`rounded-xl px-4 py-2.5 ${available ? 'bg-[#e88e29]' : 'bg-zinc-200'}`}
              >
                <Text className={`text-xs font-bold ${available ? 'text-white' : 'text-[#666665]'}`}>
                  {outOfStock ? 'Agotado' : notEnough ? 'Puntos insuficientes' : 'Canjear'}
                </Text>
              </TouchableOpacity>
            </View>

            {askingConfirm ? (
              <View className="mt-3 border-t border-zinc-100 pt-3">
                <Text className="mb-3 text-xs font-bold text-zinc-900">
                  ¿Canjear {reward.name} por {reward.points} pts? Saldo después: {points - reward.points} pts.
                </Text>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    disabled={redeeming}
                    onPress={() => setConfirming(null)}
                    className="flex-1 items-center rounded-xl border border-zinc-300 py-2.5"
                  >
                    <Text className="text-xs font-bold text-zinc-700">Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={redeeming}
                    onPress={() => confirm(reward)}
                    className={`flex-1 items-center rounded-xl bg-[#e88e29] py-2.5 ${redeeming ? 'opacity-60' : ''}`}
                  >
                    <Text className="text-xs font-bold text-white">{redeeming ? 'Canjeando…' : 'Sí, canjear'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
