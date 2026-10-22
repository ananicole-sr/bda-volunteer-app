import React, { useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';

import RedeemRewardPicker from '@/components/admin/redemptions/RedeemRewardPicker';
import { DEFAULT_MOCK_UID, getNfcReader, NfcError } from '@/lib/nfc';
import { lookupCard, redeemRewardsWithCard } from '@/services/redemptions';
import type { CardVolunteer } from '@/types/redemption';

// La tarjeta de desarrollo solo existe en desarrollo o con el lector simulado:
// en produccion escanear la tarjeta es obligatorio.
const DEV_CARD_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_NFC_MOCK === '1';

const CARD_MESSAGES: Record<string, string> = {
  card_unknown: 'La tarjeta no está registrada.',
  card_inactive: 'La tarjeta no está activa.',
};

export default function RedeemWithCardScreen() {
  const router = useRouter();
  // El UID solo vive en memoria: se vuelve a mandar al canjear y el servidor
  // vuelve a resolver al voluntario desde la tarjeta.
  const [card, setCard] = useState<{ uid: string; volunteer: CardVolunteer } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = async (uid: string) => {
    const result = await lookupCard(uid);
    if (result.code === 'ok') {
      setCard({ uid, volunteer: result.volunteer });
      return;
    }
    setError(
      result.code === 'volunteer_inactive'
        ? `${result.volunteer.name} está inactivo y no puede canjear.`
        : CARD_MESSAGES[result.code] ?? result.message ?? 'No se pudo validar la tarjeta.'
    );
  };

  const scan = async (devUid?: string) => {
    try {
      setScanning(true);
      setError(null);
      setCard(null);
      await validate(devUid ?? (await getNfcReader().readUid()));
    } catch (err) {
      if (err instanceof NfcError && err.code === 'cancelled') return;
      setError(err instanceof Error ? err.message : 'No se pudo leer la tarjeta.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-[#f4f4f2]"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 30 }}
    >
      <TouchableOpacity onPress={() => router.back()} className="mb-4 self-start py-2">
        <Text className="text-sm font-bold text-[#666665]">← Volver a recompensas</Text>
      </TouchableOpacity>

      <View className="mb-5">
        <Text className="text-2xl font-extrabold text-zinc-900">Canjear con tarjeta</Text>
        <Text className="mt-1 text-sm text-[#666665]">Escanea la tarjeta NFC del voluntario para continuar</Text>
      </View>

      <TouchableOpacity
        onPress={() => scan()}
        disabled={scanning}
        className={`items-center rounded-2xl bg-[#218750] py-4 ${scanning ? 'opacity-60' : ''}`}
      >
        <Text className="font-bold text-white">
          {scanning ? 'Leyendo tarjeta…' : card ? 'Escanear otra tarjeta' : 'Escanear tarjeta NFC'}
        </Text>
      </TouchableOpacity>

      {DEV_CARD_ENABLED ? (
        <TouchableOpacity
          onPress={() => scan(DEFAULT_MOCK_UID)}
          disabled={scanning}
          className="mt-3 items-center rounded-2xl border border-[#e88e29] bg-white py-3"
        >
          <Text className="text-sm font-bold text-[#e88e29]">Usar tarjeta de desarrollo</Text>
        </TouchableOpacity>
      ) : null}

      {error ? <Text className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</Text> : null}

      {card ? (
        <>
          <View className="mb-5 mt-5 flex-row items-center rounded-2xl border border-zinc-200 bg-white p-4">
            {card.volunteer.avatar ? (
              <Image source={{ uri: card.volunteer.avatar }} className="h-14 w-14 rounded-full" />
            ) : (
              <View className="h-14 w-14 items-center justify-center rounded-full bg-zinc-200">
                <Text className="text-xl font-extrabold text-zinc-500">{card.volunteer.name.charAt(0)}</Text>
              </View>
            )}
            <View className="ml-4 flex-1">
              <Text className="text-[10px] font-bold uppercase text-[#218750]">Tarjeta validada ✓</Text>
              <Text className="mt-1 text-base font-extrabold text-zinc-900">{card.volunteer.name}</Text>
              <Text className="text-xs text-[#666665]">{card.volunteer.community}</Text>
            </View>
            <View className="items-end">
              <Text className="text-xl font-extrabold text-[#e88e29]">{card.volunteer.points}</Text>
              <Text className="text-[10px] text-[#666665]">pts</Text>
            </View>
          </View>

          <RedeemRewardPicker
            key={card.uid}
            points={card.volunteer.points}
            redeem={(rewardIds, clientRequestId) => redeemRewardsWithCard(card.uid, rewardIds, clientRequestId)}
            onRedeemed={(balance) =>
              setCard((current) => (current ? { ...current, volunteer: { ...current.volunteer, points: balance } } : current))
            }
          />
        </>
      ) : null}
    </ScrollView>
  );
}
