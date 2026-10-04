import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';

import {
  useLocalSearchParams,
  useRouter,
} from 'expo-router';

import VolunteerProfile from '@/components/admin/dashboard/VolunteerProfile';
import { getVolunteerById } from '@/services/volunteers';
import type { Volunteer } from '@/types/volunteer';

export default function VolunteerProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [volunteer, setVolunteer] =
    useState<Volunteer | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          Cargando perfil...
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
      <TouchableOpacity
        onPress={() => router.back()}
        className="mb-4 self-start py-2"
      >
        <Text className="text-sm font-bold text-[#666665]">
          ← Volver al dashboard
        </Text>
      </TouchableOpacity>

      <VolunteerProfile
        volunteer={volunteer}
        onEdit={() =>
          router.push(
            `/admin/volunteers/${volunteer.id}/edit` as any
          )
        }
      />
    </ScrollView>
  );
}