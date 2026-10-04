import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import NotificationCard from './NotificationCard';
import type { AdminNotification } from '@/types/notification';

interface NotificationListProps {
  data: AdminNotification[];
}

export default function NotificationList({
  data,
}: NotificationListProps) {
  if (data.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm font-semibold text-[#666665]">
          No hay notificaciones.
        </Text>

        <Text className="mt-1 text-xs text-zinc-400">
          Las nuevas alertas aparecerán aquí.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 20 }}
    >
      {data.map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={notification}
        />
      ))}
    </ScrollView>
  );
}