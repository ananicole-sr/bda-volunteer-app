import React from 'react';
import { View } from 'react-native';
import { Slot } from 'expo-router';
import AdminTabs from '../../components/admin/AdminTabs';
import AdminHeader from '../../components/admin/AdminHeader';

export default function AdminLayout() {
  return (
    <View className="flex-1 bg-[#f4f4f2]">
      <View className="pt-12 px-6 pb-2">
        <AdminHeader />
      </View>
      <View className="flex-1">
        <Slot />
      </View>
      <AdminTabs />
    </View>
  );
}