import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';

export default function AdminTabs() {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [
    { name: 'Dashboard' , path: '/admin' },
    { name: 'Recompensas', path: '/admin/rewards' },
    { name: 'Notificaciones', path: '/admin/notifications' },
  ];

  return (
    <View className="flex-row bg-white border-t border-zinc-200 py-3 px-6 justify-around items-center">
      {tabs.map((tab) => {
        const isActive = pathname === tab.path;
        return (
          <TouchableOpacity
            key={tab.path}
            onPress={() => router.push(tab.path as any)}
            className={`py-2 px-4 rounded-xl ${isActive ? 'bg-orange-50 border border-orange-200' : ''}`}
          >
            <Text className={`font-bold text-xs uppercase tracking-wider ${isActive ? 'text-[#e88e29]' : 'text-[#666665]'}`}>
              {tab.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}