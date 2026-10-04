import NotificationList from '@/components/admin/notifications/NotificationList';
import React from 'react';
import { View, Text } from 'react-native';


import type { AdminNotification } from '@/types/notification';
const mockNotifications: AdminNotification[] = [
  {
    id: '1',
    type: 'check_in',
    title: 'Check-in registrado',
    message: 'Sofía Ramírez ingresó a las 10:42 AM',
    time: 'Hace 3 min',
  },
  {
    id: '2',
    type: 'reward',
    title: 'Puntos canjeados',
    message: 'Valeria Ríos canjeó "Despensa básica"',
    time: 'Hace 18 min',
  },
  {
    id: '3',
    type: 'low_stock',
    title: 'Stock crítico',
    message: '"Despensa básica" tiene stock bajo',
    time: 'Hace 1 hora',
  },
];

export default function AdminNotificationsScreen() {
  return (
    <View className="flex-1 bg-[#f4f4f2] px-6 pb-4">
      
      <View className="mb-4">
        <Text className="text-xs font-bold uppercase tracking-wider text-[#666665]">
          Alertas en tiempo real
        </Text>
      </View>

      <NotificationList data={mockNotifications} />

    </View>
  );
}