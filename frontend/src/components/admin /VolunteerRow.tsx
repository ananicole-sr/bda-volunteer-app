import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';

interface VolunteerRowProps {
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  avatar?: string;
}

export default function VolunteerRow({ name, community, points, lastVisit, avatar }: VolunteerRowProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      className="bg-white p-4 rounded-2xl border border-zinc-200 flex-row items-center justify-between shadow-sm active:bg-zinc-50 mb-3"
    >
      <View className="flex-row items-center gap-3">
        {avatar && <Image source={{ uri: avatar }} className="w-11 h-11 rounded-full" />}
        <View>
          <Text className="font-extrabold text-sm text-zinc-900 underline">{name}</Text>
          <Text className="text-[#666665] text-xs mt-0.5">{community} · Última vez: {lastVisit}</Text>
        </View>
      </View>
      <View className="items-end">
        <Text className="text-[#e88e29] font-bold text-sm">{points} pts</Text>
        <Text className="text-[#218750] text-[10px] font-bold mt-0.5">Editar →</Text>
      </View>
    </TouchableOpacity>
  );
}