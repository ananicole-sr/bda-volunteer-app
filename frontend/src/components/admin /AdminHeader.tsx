import React from 'react';
import { View, Image } from 'react-native';

export default function AdminHeader() {
  return (
    <View className="-ml-12 flex-row items-center">
      <Image 
        source={require('frontend/assets/logo.png')} 
        className="h-20 w-60"
        resizeMode="contain" 
      />
    </View>
  );
}

