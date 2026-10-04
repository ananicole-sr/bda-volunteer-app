import React from 'react';
import { View, Text } from 'react-native';

import type {
  AdminNotification,
  NotificationType,
} from '@/types/notification';

interface NotificationCardProps {
  notification: AdminNotification;
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'check_in':
      return '✓';

    case 'reward':
      return '★';

    case 'low_stock':
      return '!';

    default:
      return '•';
  }
}

export default function NotificationCard({
  notification,
}: NotificationCardProps) {
  return (
    <View className="mb-3 flex-row items-start rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-[#f4f4f2]">
        <Text className="text-lg font-extrabold text-[#e88e29]">
          {getNotificationIcon(notification.type)}
        </Text>
      </View>

      <View className="flex-1">
        <Text className="text-sm font-extrabold text-zinc-900">
          {notification.title}
        </Text>

        <Text className="mt-1 text-xs leading-5 text-[#666665]">
          {notification.message}
        </Text>
      </View>

      <Text className="ml-2 text-[10px] font-semibold text-zinc-400">
        {notification.time}
      </Text>
    </View>
  );
}