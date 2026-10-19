import React, { useState } from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import type { RewardInput } from '@/types/reward';

interface RewardFormProps {
  name?: string;
  description?: string;
  points?: number;
  stock?: number;
  buttonLabel: string;
  onSubmit: (input: RewardInput) => Promise<void>;
}

export default function RewardForm({
  name = '',
  description = '',
  points,
  stock,
  buttonLabel,
  onSubmit,
}: RewardFormProps) {
  const [form, setForm] = useState({ name, description, points: points?.toString() ?? '', stock: stock?.toString() ?? '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const parsedPoints = Number(form.points); const parsedStock = Number(form.stock);
    if (!form.name.trim() || !Number.isInteger(parsedPoints) || parsedPoints < 0 || !Number.isInteger(parsedStock) || parsedStock < 0) {
      setError('Completa nombre, puntos y stock con números enteros válidos.'); return;
    }
    setSaving(true); setError('');
    try { await onSubmit({ name: form.name.trim(), description: form.description.trim() || null, points: parsedPoints, stock: parsedStock }); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la recompensa.'); }
    finally { setSaving(false); }
  };
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
            value={form.name}
            placeholder="Ej. Playera BAMX"
            placeholderTextColor="#a0a09e"
            onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Descripción
          </Text>

          <TextInput
            value={form.description}
            placeholder="Describe la recompensa"
            placeholderTextColor="#a0a09e"
            onChangeText={(value) => setForm((current) => ({ ...current, description: value }))}
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
            value={form.points}
            placeholder="0"
            placeholderTextColor="#a0a09e"
            onChangeText={(value) => setForm((current) => ({ ...current, points: value }))}
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
            value={form.stock}
            placeholder="0"
            placeholderTextColor="#a0a09e"
            onChangeText={(value) => setForm((current) => ({ ...current, stock: value }))}
            keyboardType="numeric"
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />

          <Text className="mt-1.5 text-[10px] text-[#666665]">
            Número de recompensas disponibles.
          </Text>
        </View>
      </View>

      {error ? <Text className="mt-3 text-xs font-semibold text-red-600">{error}</Text> : null}
      <TouchableOpacity disabled={saving} onPress={save} className={`mt-5 items-center rounded-xl bg-[#e88e29] py-4 ${saving ? 'opacity-60' : ''}`}>
        <Text className="text-sm font-bold text-white">
          {saving ? 'Guardando...' : buttonLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
