import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';

import {
  useLocalSearchParams,
  useRouter,
} from 'expo-router';

import RewardForm from '@/components/admin/rewards/RewardForm';
import { deactivateReward, getRewardById, updateReward } from '@/services/rewards';
import type { Reward } from '@/types/reward';

export default function EditRewardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [reward, setReward] = useState<Reward | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Eliminar en dos pasos: el primer toque pide confirmacion, el segundo llama a la Edge Function.
  // Es un borrado logico (is_active = false) para conservar el historial de canjes.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!reward) return;

    try {
      setDeleting(true);
      setDeleteError(null);

      const result = await deactivateReward(reward.id);

      if (result.code !== 'ok') {
        setDeleteError(result.message ?? 'La recompensa ya no existe.');
        return;
      }

      // La lista solo muestra recompensas activas, asi que regresamos ahi.
      router.replace('/admin/rewards');
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar la recompensa. Intenta de nuevo.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const loadReward = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const data = await getRewardById(id);

      setReward(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Error desconocido al cargar la recompensa'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReward();
  }, [loadReward]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2]">
        <ActivityIndicator
          size="large"
          color="#e88e29"
        />

        <Text className="mt-2 text-xs text-[#666665]">
          Cargando recompensa...
        </Text>
      </View>
    );
  }

  if (error || !reward) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f4f4f2] px-6">
        <Text className="text-center text-sm font-bold text-red-600">
          {error ?? 'Recompensa no encontrada'}
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
          ← Volver a recompensas
        </Text>
      </TouchableOpacity>

      <View className="mb-5">
        <Text className="text-2xl font-extrabold text-zinc-900">
          Editar recompensa
        </Text>

        <Text className="mt-1 text-sm text-[#666665]">
          Modifica la información de la recompensa
        </Text>
      </View>

      <RewardForm
        name={reward.name}
        description={reward.description}
        points={reward.points}
        stock={reward.stock}
        buttonLabel="Guardar cambios"
        onSubmit={async (input) => { const result = await updateReward(reward.id, input); if (result.code !== 'ok') throw new Error('La recompensa ya no existe.'); router.replace('/admin/rewards'); }}
      />

      {/* Eliminar */}
      <View className="mt-4 rounded-2xl border border-red-200 bg-white p-5">
        <Text className="text-sm font-extrabold text-zinc-900">
          Eliminar recompensa
        </Text>

        <Text className="mt-1 text-xs text-[#666665]">
          Dejará de aparecer en el catálogo y ya no se podrá canjear. Los canjes anteriores se conservan.
        </Text>

        {confirmingDelete ? (
          <View className="mt-4">
            <Text className="mb-3 text-xs font-bold text-red-600">
              ¿Seguro que quieres eliminar {reward.name}?
            </Text>

            <View className="flex-row gap-3">
              <TouchableOpacity
                disabled={deleting}
                onPress={() => setConfirmingDelete(false)}
                className="flex-1 items-center rounded-xl border border-zinc-300 py-3"
              >
                <Text className="text-sm font-bold text-zinc-700">
                  Cancelar
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={deleting}
                onPress={handleDelete}
                className={`flex-1 items-center rounded-xl bg-red-600 py-3 ${deleting ? 'opacity-60' : ''}`}
              >
                <Text className="text-sm font-bold text-white">
                  {deleting ? 'Eliminando…' : 'Sí, eliminar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setConfirmingDelete(true)}
            className="mt-4 items-center rounded-xl border border-red-600 py-3"
          >
            <Text className="text-sm font-bold text-red-600">
              Eliminar recompensa
            </Text>
          </TouchableOpacity>
        )}

        {deleteError ? (
          <Text className="mt-3 text-xs font-semibold text-red-600">
            {deleteError}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
