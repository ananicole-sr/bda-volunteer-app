import React, { useState } from 'react';
import { View, TextInput, ScrollView } from 'react-native';
import VolunteerRow from './VolunteerRow';

interface Volunteer {
  id: string;
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  avatar?: string;
}

interface AdminTableProps {
  data: Volunteer[];
}

export default function AdminTable({ data }: AdminTableProps) {
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

      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {filteredVolunteers.map((v) => (
          <VolunteerRow 
            key={v.id}
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