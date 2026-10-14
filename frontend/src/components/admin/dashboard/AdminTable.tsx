import React, { useState } from 'react';
import { View, TextInput, ScrollView, RefreshControl } from 'react-native';
import VolunteerRow from './VolunteerRow';
import type { Volunteer } from '@/types/volunteer';

interface AdminTableProps {
  data: Volunteer[];
  refreshing?: boolean;
  onRefresh?: () => void;
}

export default function AdminTable({ data, refreshing = false, onRefresh }: AdminTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredVolunteers = data.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.community.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View className="flex-1">
      <View className="mb-6">
        <TextInput 
          className="bg-white py-3.5 px-4 rounded-xl border border-zinc-200 text-zinc-800 text-sm shadow-sm" 
          placeholder="Search by name or community..." 
          placeholderTextColor="#666665"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        
        {filteredVolunteers.map((v) => (
          <VolunteerRow
            key={v.id}
            id={v.id}
            name={v.name}
            community={v.community}
            points={v.points}
            lastVisit={v.lastVisit}
            avatar={v.avatar}
          />
        ))}
      </ScrollView>
    </View>
  );
}
