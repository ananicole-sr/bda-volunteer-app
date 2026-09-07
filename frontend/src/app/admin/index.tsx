import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import AdminTable from '../../components/AdminTable';

const VOLUNTEERS = [
  { id: '1', name: 'Carlos Mendoza', community: 'Zapopan', points: 240, lastVisit: 'Today, 8:00 AM', status: 'Active' },
  { id: '2', name: 'Elena Martínez', community: 'Guadalajara Centro', points: 190, lastVisit: 'Today, 8:30 AM', status: 'Active' },
  { id: '3', name: 'Ricardo Juárez', community: 'Zapopan', points: 120, lastVisit: 'Yesterday, 9:20 AM', status: 'Active' },
  { id: '4', name: 'Sofia Ramírez', community: 'Tlaquepaque', points: 310, lastVisit: 'Sept 4, 8:00 AM', status: 'Inactive' },
];

export default function AdminDashboardScreen() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredVolunteers = VOLUNTEERS.filter(v => 
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.community.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View className="flex-1 pt-14 px-6 pb-4">
      <View className="flex-row justify-between items-start mb-6">
        <View>
          <View className="flex-row items-center gap-2">
            <Text className="text-2xl font-black text-zinc-900 tracking-tight">RED BAMX</Text>
          </View>
          <Text className="text-[#666665] text-xs font-semibold mt-1 uppercase tracking-wider">Guadalajara • Admin Home</Text>
        </View>
        
        <TouchableOpacity className="bg-[#218750] px-4 py-2.5 rounded-xl shadow-sm flex-row items-center justify-center active:opacity-90" >
          <Text className="text-white font-bold text-sm">+ Register</Text>
        </TouchableOpacity>
      </View>

      <View className="mb-6">
        <TextInput 
          className="bg-white py-3.5 px-4 rounded-xl border border-zinc-200 text-zinc-800 text-sm shadow-sm" 
          placeholder="Search by name or community..." 
          placeholderTextColor="#666665"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <AdminTable data={filteredVolunteers} />
    </View>
  );
}