import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
} from 'react-native';

import type { Volunteer } from '@/types/volunteer';

interface VolunteerProfileProps {
  volunteer: Volunteer;
  onEdit: () => void;
}

export default function VolunteerProfile({
  volunteer,
  onEdit,
}: VolunteerProfileProps) {
  return (
    <View>
      {/* Perfil principal */}
      <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <View className="flex-row items-center">
          {volunteer.avatar ? (
            <Image
              source={{ uri: volunteer.avatar }}
              className="h-20 w-20 rounded-full"
            />
          ) : (
            <View className="h-20 w-20 items-center justify-center rounded-full bg-zinc-200">
              <Text className="text-2xl font-extrabold text-zinc-500">
                {volunteer.name.charAt(0)}
              </Text>
            </View>
          )}

          <View className="ml-4 flex-1">
            <Text className="text-xl font-extrabold text-zinc-900">
              {volunteer.name}
            </Text>

            <Text className="mt-1 text-sm text-[#666665]">
              {volunteer.community}
            </Text>

            <View className="mt-2 self-start rounded-full bg-green-50 px-3 py-1">
              <Text className="text-[10px] font-bold uppercase text-[#218750]">
                Voluntario activo
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={onEdit}
          className="mt-5 items-center rounded-xl bg-[#e88e29] py-3"
        >
          <Text className="text-sm font-bold text-white">
            Editar perfil
          </Text>
        </TouchableOpacity>
      </View>

      {/* Estadísticas */}
      <View className="mt-4 flex-row gap-3">
        <View className="flex-1 rounded-2xl border border-zinc-200 bg-white p-4">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-[#666665]">
            Puntos
          </Text>

          <Text className="mt-2 text-2xl font-extrabold text-[#e88e29]">
            {volunteer.points}
          </Text>

          <Text className="mt-1 text-xs text-[#666665]">
            puntos acumulados
          </Text>
        </View>

        <View className="flex-1 rounded-2xl border border-zinc-200 bg-white p-4">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-[#666665]">
            Última visita
          </Text>

          <Text className="mt-2 text-sm font-extrabold text-zinc-900">
            {volunteer.lastVisit}
          </Text>
        </View>
      </View>

      {/* Información */}
      <View className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
        <Text className="mb-2 text-sm font-extrabold text-zinc-900">
          Información del voluntario
        </Text>

        <View className="border-b border-zinc-100 py-3">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-[#666665]">
            Nombre
          </Text>

          <Text className="mt-1 text-sm font-semibold text-zinc-900">
            {volunteer.name}
          </Text>
        </View>

        <View className="py-3">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-[#666665]">
            Comunidad
          </Text>

          <Text className="mt-1 text-sm font-semibold text-zinc-900">
            {volunteer.community}
          </Text>
        </View>
      </View>
    </View>
  );
}