import React from 'react';
import { Image, View } from 'react-native';
import SignOutButton from '@/components/auth/SignOutButton';

export default function AdminHeader() {
  return (
    <View className="-ml-12 flex-row items-center justify-between">
      <Image 
        source={require('frontend/assets/logo.png')} 
        className="h-20 w-60"
        resizeMode="contain" 
      />
      <SignOutButton />
    </View>
  );
}
