import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface VolunteerRowProps {
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  status: string;
}

export default function VolunteerRow({ name, community, points, lastVisit, status }: VolunteerRowProps) {
  return (
    <TouchableOpacity 
      className="flex-row items-center py-4 px-5 bg-white border-b border-zinc-100 active:bg-zinc-50"
    >
      <View className={`w-2.5 h-2.5 rounded-full mr-3 ${status === 'Active' ? 'bg-[#218750]' : 'bg-[#666665]'}`} />
      
      <View className="flex-2">
        <Text className="text-[#d03030] font-bold text-base tracking-tight">{name}</Text>
        <Text className="text-[#666665] text-xs font-medium mt-0.5">Community: {community}</Text>
      </View>

      <View className="flex-1 items-start">
        <View className="bg-orange-50 px-2.5 py-1 rounded-full border border-orange-100">
          <Text className="text-[#e88e29] font-bold text-xs">{points} pts</Text>
        </View>
      </View>

      <Text className="flex-1.5 text-[#666665] text-xs text-right font-medium">{lastVisit}</Text>
    </TouchableOpacity>
  );
}