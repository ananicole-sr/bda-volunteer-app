import React from 'react';
import { View, Text, FlatList } from 'react-native';
import VolunteerRow from './VolunteerRow';

interface Volunteer {
  id: string;
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  status: string;
}

interface AdminTableProps {
  data: Volunteer[];
}

export default function AdminTable({ data }: AdminTableProps) {
  return (
    <View className="bg-white rounded-2xl flex-1 shadow-sm border border-zinc-200 overflow-hidden">
      <View className="flex-row bg-[#e88e29] py-3 px-5 items-center">
        <Text className="flex-2 text-white font-bold text-xs uppercase tracking-wider">Volunteer</Text>
        <Text className="flex-1 text-white font-bold text-xs uppercase tracking-wider">Points</Text>
        <Text className="flex-1.5 text-white font-bold text-xs uppercase tracking-wider text-right">Last Visit</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <VolunteerRow 
            name={item.name}
            community={item.community}
            points={item.points}
            lastVisit={item.lastVisit}
            status={item.status}
          />
        )}
        contentContainerStyle={{ flexGrow: 1 }}
      />
    </View>
  );
}