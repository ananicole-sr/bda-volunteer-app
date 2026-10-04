import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
} from 'react-native';

import { useRouter } from 'expo-router';

interface VolunteerRowProps {
  id: string;
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  avatar?: string;
}

export default function VolunteerRow({
  id,
  name,
  community,
  points,
  lastVisit,
  avatar,
}: VolunteerRowProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() =>
        router.push(`/admin/volunteers/${id}` as any)
      }
      className="mb-3 flex-row items-center justify-between rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm active:bg-zinc-50"
    >
      <View className="flex-row items-center gap-3">
        {avatar && (
          <Image
            source={{ uri: avatar }}
            className="h-11 w-11 rounded-full"
          />
        )}

        <View>
          <Text className="text-sm font-extrabold text-zinc-900 underline">
            {name}
          </Text>

          <Text className="mt-0.5 text-xs text-[#666665]">
            {community} · Última vez: {lastVisit}
          </Text>
        </View>
      </View>

      <View className="items-end">
        <Text className="text-sm font-bold text-[#e88e29]">
          {points} pts
        </Text>

        <Text className="mt-0.5 text-[10px] font-bold text-[#218750]">
          Ver perfil →
        </Text>
      </View>
    </TouchableOpacity>
  );
}