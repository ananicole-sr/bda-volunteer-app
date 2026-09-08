import React from 'react';
import { View, Text } from 'react-native';

import RegisterButton from '@/components/admin /RegisterButton';
import AdminTable from '@/components/admin /AdminTable';

const volunteers = [
  {
    id: 'V-1042',
    name: "Sofía Ramírez",
    points: 2240,
    lastVisit: "07 Sep 2026",
    community: "Zapopan",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&auto=format",
  },
  {
    id: 'V-1091',
    name: "Carlos Mendoza",
    points: 1480,
    lastVisit: "06 Sep 2026",
    community: "Zapopan",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format",
  },
  {
    id: 'V-1077',
    name: "Valeria Ríos",
    points: 3120,
    lastVisit: "07 Sep 2026",
    community: "Centro",
    avatar: "https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?w=80&h=80&fit=crop&auto=format",
  },
];

export default function AdminDashboardScreen() {
  return (
    <View className="flex-1 px-6 pb-4 bg-[#f4f4f2]">
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-xs text-[#666665] font-bold uppercase tracking-wider">
          Voluntarios activos
        </Text>
        <RegisterButton />
      </View>
      <AdminTable data={volunteers} />
    </View>
  );
}