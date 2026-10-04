import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

export default function RegisterButton() {
  return (
    <TouchableOpacity
      onPress={() => {
        router.push('/admin/volunteers/register');
      }}
      className="mt-2 flex-row items-center justify-center rounded-xl bg-[#e88e29] px-4 py-2.5 shadow-sm active:opacity-90"
    >
      <Text className="text-sm font-bold text-white">
        + Registrar Nuevo
      </Text>
    </TouchableOpacity>
  );
}