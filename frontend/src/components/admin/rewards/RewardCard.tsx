import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';

import { useRouter } from 'expo-router';

interface RewardCardProps {
  id: string;
  name: string;
  description: string;
  points: number;
  stock: number;
}

export default function RewardCard({
  id,
  name,
  description,
  points,
  stock,
}: RewardCardProps) {
  const router = useRouter();

  const isLowStock = stock <= 5;

  return (
    <View className="mb-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <View className="flex-row items-start justify-between">
        <View className="mr-4 flex-1">
          <Text className="text-base font-extrabold text-zinc-900">
            {name}
          </Text>

          <Text className="mt-1 text-xs leading-5 text-[#666665]">
            {description}
          </Text>
        </View>

        <View className="rounded-xl bg-orange-50 px-3 py-2">
          <Text className="text-sm font-extrabold text-[#e88e29]">
            {points} pts
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row items-center justify-between border-t border-zinc-100 pt-4">
        <View>
          <Text className="text-[10px] font-bold uppercase tracking-wider text-[#666665]">
            Stock
          </Text>

          <View
            className={`mt-1 self-start rounded-full px-3 py-1 ${
              isLowStock ? 'bg-red-50' : 'bg-green-50'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                isLowStock
                  ? 'text-[#d03030]'
                  : 'text-[#218750]'
              }`}
            >
              {stock} disponibles
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() =>
            router.push(`/admin/rewards/${id}/edit` as any)
          }
          className="rounded-xl border border-[#e88e29] px-4 py-2.5 active:opacity-70"
        >
          <Text className="text-xs font-bold text-[#e88e29]">
            Editar
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}