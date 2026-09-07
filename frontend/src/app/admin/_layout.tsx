import React from 'react';
import { View } from 'react-native';
import { Slot } from 'expo-router';
import AdminTabs from '../../components/AdminTabs';

export default function AdminLayout() {
  return (
    <View className="flex-1 bg-zinc-50">
      <View className="flex-1">
        <Slot />
      </View>
      <AdminTabs />
    </View>
  );
}