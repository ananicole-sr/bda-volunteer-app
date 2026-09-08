import React from 'react';
import { Text, TouchableOpacity } from 'react-native';

interface RegisterButtonProps {
  onPress?: () => void;
}

export default function RegisterButton({ onPress }: RegisterButtonProps) {
  return (
    <TouchableOpacity 
      className="bg-[#e88e29] px-4 py-2.5 rounded-xl shadow-sm flex-row items-center justify-center active:opacity-90 mt-2"
      onPress={onPress}
    >
      <Text className="text-white font-bold text-sm">+ Registrar Nuevo</Text>
    </TouchableOpacity>
  );
}