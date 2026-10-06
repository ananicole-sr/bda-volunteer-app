import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Href, Slot, useRouter } from 'expo-router';
import AdminTabs from '../../components/admin/AdminTabs';
import AdminHeader from '../../components/admin/AdminHeader';
import { supabase } from '@/lib/supabase';

const loginRoute = '/login' as Href;

export default function AdminLayout() {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace(loginRoute);
      }
      setIsCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace(loginRoute);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (isCheckingSession) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2]">
        <ActivityIndicator color="#e88e29" />
      </View>
    );
  }

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
