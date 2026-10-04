import React from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';

interface RewardFormProps {
  name?: string;
  description?: string;
  points?: number;
  stock?: number;
  buttonLabel: string;
}

export default function RewardForm({
  name = '',
  description = '',
  points,
  stock,
  buttonLabel,
}: RewardFormProps) {
  return (
    <View>
      <View className="rounded-2xl border border-zinc-200 bg-white p-5">
        <Text className="mb-5 text-sm font-extrabold text-zinc-900">
          Información de la recompensa
        </Text>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Nombre
          </Text>

          <TextInput
            value={name}
            placeholder="Ej. Playera BAMX"
            placeholderTextColor="#a0a09e"
            editable={false}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Descripción
          </Text>

          <TextInput
            value={description}
            placeholder="Describe la recompensa"
            placeholderTextColor="#a0a09e"
            editable={false}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="min-h-24 rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Costo en puntos
          </Text>

          <TextInput
            value={points !== undefined ? String(points) : ''}
            placeholder="0"
            placeholderTextColor="#a0a09e"
            editable={false}
            keyboardType="numeric"
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />

          <Text className="mt-1.5 text-[10px] text-[#666665]">
            Cantidad de puntos necesarios para canjearla.
          </Text>
        </View>

        <View>
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Stock disponible
          </Text>

          <TextInput
            value={stock !== undefined ? String(stock) : ''}
            placeholder="0"
            placeholderTextColor="#a0a09e"
            editable={false}
            keyboardType="numeric"
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />

          <Text className="mt-1.5 text-[10px] text-[#666665]">
            Número de recompensas disponibles.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        disabled
        className="mt-5 items-center rounded-xl bg-[#e88e29] py-4 opacity-50"
      >
        <Text className="text-sm font-bold text-white">
          {buttonLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}