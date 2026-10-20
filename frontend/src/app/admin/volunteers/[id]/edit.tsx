import React, { useCallback, useEffect, useState } from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';

import {
  useLocalSearchParams,
  useRouter,
} from 'expo-router';

import { deactivateVolunteer, getVolunteerById } from '@/services/volunteers';
import type { Volunteer } from '@/types/volunteer';

export default function EditVolunteerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [volunteer, setVolunteer] = useState<Volunteer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Desactivar en dos pasos: el primer toque pide confirmacion, el segundo llama a la Edge Function.
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const handleDeactivate = async () => {
    if (!volunteer) return;

    try {
      setDeactivating(true);
      setDeactivateError(null);

      const result = await deactivateVolunteer(volunteer.id);

      if (result.code !== 'ok') {
        setDeactivateError(result.message ?? 'El voluntario ya no existe.');
        return;
      }

      // La lista del dashboard solo muestra activos, asi que regresamos ahi.
      router.replace('/admin');
    } catch (err) {
      setDeactivateError(
        err instanceof Error
          ? err.message
          : 'No se pudo desactivar al voluntario. Intenta de nuevo.'
      );
    } finally {
      setDeactivating(false);
    }
  };

  const loadVolunteer = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const data = await getVolunteerById(id);

      setVolunteer(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error desconocido al cargar el voluntario'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadVolunteer();
  }, [loadVolunteer]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2]">
        <ActivityIndicator
          size="large"
          color="#e88e29"
        />

        <Text className="mt-2 text-xs text-[#666665]">
          Cargando información...
        </Text>
      </View>
    );
  }

  if (error || !volunteer) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2] px-6">
        <Text className="text-center text-sm font-bold text-red-600">
          {error ?? 'Voluntario no encontrado'}
        </Text>

        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-4"
        >
          <Text className="font-bold text-[#e88e29]">
            ← Regresar
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-[#f4f4f2]"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingBottom: 30,
      }}
    >
      {/* Back */}
      <TouchableOpacity
        onPress={() => router.back()}
        className="mb-4 self-start py-2"
      >
        <Text className="text-sm font-bold text-[#666665]">
          ← Volver al perfil
        </Text>
      </TouchableOpacity>

      {/* Título */}
      <View className="mb-5">
        <Text className="text-2xl font-extrabold text-zinc-900">
          Editar voluntario
        </Text>

        <Text className="mt-1 text-sm text-[#666665]">
          Actualiza la información del perfil
        </Text>
      </View>

      {/* Avatar */}
      <View className="mb-4 items-center rounded-2xl border border-zinc-200 bg-white p-5">
        {volunteer.avatar ? (
          <Image
            source={{ uri: volunteer.avatar }}
            className="h-24 w-24 rounded-full"
          />
        ) : (
          <View className="h-24 w-24 items-center justify-center rounded-full bg-zinc-200">
            <Text className="text-3xl font-extrabold text-zinc-500">
              {volunteer.name.charAt(0)}
            </Text>
          </View>
        )}

        <TouchableOpacity
          disabled
          className="mt-3 rounded-xl border border-[#e88e29] px-4 py-2 opacity-60"
        >
          <Text className="text-xs font-bold text-[#e88e29]">
            Cambiar foto
          </Text>
        </TouchableOpacity>
      </View>

      {/* Información editable */}
      <View className="rounded-2xl border border-zinc-200 bg-white p-5">
        <Text className="mb-5 text-sm font-extrabold text-zinc-900">
          Información personal
        </Text>

        {/* Nombre */}
        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Nombre completo
          </Text>

          <TextInput
            value={volunteer.name}
            editable={false}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        {/* Comunidad */}
        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Comunidad
          </Text>

          <TextInput
            value={volunteer.community}
            editable={false}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>

        {/* Puntos */}
        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Puntos acumulados
          </Text>

          <TextInput
            value={String(volunteer.points)}
            editable={false}
            keyboardType="numeric"
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />

          <Text className="mt-1.5 text-[10px] text-[#666665]">
            Los puntos se muestran únicamente como referencia.
          </Text>
        </View>

        {/* Última visita */}
        <View>
          <Text className="mb-2 text-xs font-bold text-[#666665]">
            Última visita
          </Text>

          <TextInput
            value={volunteer.lastVisit}
            editable={false}
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />
        </View>
      </View>

      {/* Guardar */}
      <TouchableOpacity
        disabled
        className="mt-5 items-center rounded-xl bg-[#e88e29] py-4 opacity-50"
      >
        <Text className="text-sm font-bold text-white">
          Guardar cambios
        </Text>
      </TouchableOpacity>

      {/* Desactivar */}
      <View className="mt-4 rounded-2xl border border-red-200 bg-white p-5">
        <Text className="text-sm font-extrabold text-zinc-900">
          Desactivar voluntario
        </Text>

        {volunteer.isActive ? (
          <>
            <Text className="mt-1 text-xs text-[#666665]">
              Ya no podrá registrar visitas con su tarjeta. Su historial y sus puntos se conservan.
            </Text>

            {confirmingDeactivate ? (
              <View className="mt-4">
                <Text className="mb-3 text-xs font-bold text-red-600">
                  ¿Seguro que quieres desactivar a {volunteer.name}?
                </Text>

                <View className="flex-row gap-3">
                  <TouchableOpacity
                    disabled={deactivating}
                    onPress={() => setConfirmingDeactivate(false)}
                    className="flex-1 items-center rounded-xl border border-zinc-300 py-3"
                  >
                    <Text className="text-sm font-bold text-zinc-700">
                      Cancelar
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={deactivating}
                    onPress={handleDeactivate}
                    className={`flex-1 items-center rounded-xl bg-red-600 py-3 ${deactivating ? 'opacity-60' : ''}`}
                  >
                    <Text className="text-sm font-bold text-white">
                      {deactivating ? 'Desactivando…' : 'Sí, desactivar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setConfirmingDeactivate(true)}
                className="mt-4 items-center rounded-xl border border-red-600 py-3"
              >
                <Text className="text-sm font-bold text-red-600">
                  Desactivar voluntario
                </Text>
              </TouchableOpacity>
            )}

            {deactivateError ? (
              <Text className="mt-3 text-xs font-semibold text-red-600">
                {deactivateError}
              </Text>
            ) : null}
          </>
        ) : (
          <View className="mt-3 self-start rounded-full bg-zinc-100 px-3 py-1.5">
            <Text className="text-[10px] font-bold uppercase text-[#666665]">
              Inactivo
            </Text>
          </View>
        )}
      </View>

    </ScrollView>
  );
}