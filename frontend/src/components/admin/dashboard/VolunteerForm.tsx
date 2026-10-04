import React from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';

interface VolunteerFormProps {
  submitLabel?: string;
}

export default function VolunteerForm({
  submitLabel = 'Registrar voluntario',
}: VolunteerFormProps) {
  return (
    <View>
      <View className="rounded-2xl border border-zinc-200 bg-white p-5">
        <Text className="mb-5 text-sm font-extrabold text-zinc-900">
          Información del voluntario
        </Text>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Nombre completo
          </Text>

          <TextInput
            placeholder="Ej. Sofía Ramírez"
            placeholderTextColor="#a0a09e"
            editable={false}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Comunidad
          </Text>

          <TextInput
            placeholder="Ej. Zapopan"
            placeholderTextColor="#a0a09e"
            editable={false}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Tarjeta NFC
          </Text>

          <TextInput
            placeholder="UID de tarjeta NFC"
            placeholderTextColor="#a0a09e"
            editable={false}
            autoCapitalize="characters"
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />

          <Text className="mt-1.5 text-[10px] leading-4 text-[#666665]">
            Identificador único de la tarjeta asignada al voluntario.
          </Text>
        </View>

        <View>
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Foto de perfil
          </Text>

          <View className="items-center rounded-xl border border-dashed border-zinc-300 bg-[#f4f4f2] px-4 py-6">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-zinc-200">
              <Text className="text-xl font-extrabold text-zinc-400">
                +
              </Text>
            </View>

            <TouchableOpacity
              disabled
              className="mt-3 rounded-xl border border-[#e88e29] px-4 py-2 opacity-60"
            >
              <Text className="text-xs font-bold text-[#e88e29]">
                Seleccionar foto
              </Text>
            </TouchableOpacity>

            <Text className="mt-2 text-center text-[10px] text-[#666665]">
              La carga de imágenes se habilitará posteriormente.
            </Text>
          </View>
        </View>
      </View>

      <View className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <Text className="text-sm font-extrabold text-zinc-900">
          Estado inicial
        </Text>

        <View className="mt-4 flex-row items-center justify-between">
          <View>
            <Text className="text-xs font-bold text-zinc-900">
              Voluntario activo
            </Text>

            <Text className="mt-1 text-[10px] text-[#666665]">
              El voluntario se registrará como activo.
            </Text>
          </View>

          <View className="rounded-full bg-green-50 px-3 py-1.5">
            <Text className="text-[10px] font-bold uppercase text-[#218750]">
              Activo
            </Text>
          </View>
        </View>

        <View className="mt-4 flex-row border-t border-zinc-100 pt-4">
          <View className="flex-1">
            <Text className="text-[10px] font-bold uppercase text-[#666665]">
              Puntos
            </Text>

            <Text className="mt-1 text-lg font-extrabold text-zinc-900">
              0
            </Text>
          </View>

          <View className="flex-1">
            <Text className="text-[10px] font-bold uppercase text-[#666665]">
              Visitas
            </Text>

            <Text className="mt-1 text-lg font-extrabold text-zinc-900">
              0
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        disabled
        className="mt-5 items-center rounded-xl bg-[#e88e29] py-4 opacity-50"
      >
        <Text className="text-sm font-bold text-white">
          {submitLabel}
        </Text>
      </TouchableOpacity>


    </View>
  );
}