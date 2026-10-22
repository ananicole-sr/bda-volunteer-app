import React, { useState } from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createRegistrationRequestId, registerVolunteerAccount, setVolunteerAvatar } from '@/services/volunteers';
import type { AvatarFile, RegisterVolunteerAccountInput } from '@/types/volunteer';

// Igual que el limite del bucket volunteer-avatars (migracion 009).
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface VolunteerFormProps {
  submitLabel?: string;
  onRegistered: (volunteerId: string) => void;
}

export default function VolunteerForm({
  submitLabel = 'Registrar voluntario',
  onRegistered,
}: VolunteerFormProps) {
  const [form, setForm] = useState({ fullName: '', community: '', uid: '', email: '', password: '' });
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<AvatarFile | null>(null);
  // Alta hecha pero la foto fallo: se puede reintentar (el alta se repite como replayed) o seguir sin foto.
  const [photoFailedFor, setPhotoFailedFor] = useState<string | null>(null);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > AVATAR_MAX_BYTES) {
      setError('La foto pesa más de 2 MB. Elige otra.'); return;
    }
    setError('');
    setPhoto({ uri: asset.uri, mimeType: asset.mimeType });
  };

  const submit = async () => {
    if (!form.fullName.trim() || !form.community.trim() || !form.uid.trim() || !form.email.trim() || !form.password) {
      setError('Completa todos los campos requeridos.'); return;
    }
    const requestId = clientRequestId ?? createRegistrationRequestId();
    setClientRequestId(requestId); setError(''); setSubmitting(true);
    try {
      const input: RegisterVolunteerAccountInput = { clientRequestId: requestId, fullName: form.fullName.trim(), community: form.community.trim(), uid: form.uid.trim(), email: form.email.trim(), password: form.password };
      const result = await registerVolunteerAccount(input);
      if (result.code !== 'ok') { setError(result.message ?? 'No se pudo registrar el voluntario.'); return; }

      const volunteerId = result.volunteer.id;
      if (photo) {
        try {
          const photoResult = await setVolunteerAvatar(volunteerId, photo);
          if (photoResult.code !== 'ok') throw new Error(photoResult.message ?? 'No se pudo guardar la foto.');
        } catch (photoErr) {
          setPhotoFailedFor(volunteerId);
          setError(`El voluntario se registró, pero la foto no se guardó: ${photoErr instanceof Error ? photoErr.message : 'error desconocido'}`);
          return;
        }
      }
      onRegistered(volunteerId);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar el voluntario. Intenta de nuevo.'); }
    finally { setSubmitting(false); }
  };
  return (
    <View>
      <View className="mb-4 items-center rounded-2xl border border-zinc-200 bg-white p-5">
        {photo ? (
          <Image source={{ uri: photo.uri }} className="h-24 w-24 rounded-full" />
        ) : (
          <View className="h-24 w-24 items-center justify-center rounded-full bg-zinc-200">
            <Text className="text-3xl font-extrabold text-zinc-500">
              {form.fullName.trim().charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        )}

        <View className="mt-3 flex-row gap-2">
          <TouchableOpacity
            disabled={submitting}
            onPress={pickPhoto}
            className="rounded-xl border border-[#e88e29] px-4 py-2"
          >
            <Text className="text-xs font-bold text-[#e88e29]">
              {photo ? 'Cambiar foto' : 'Agregar foto'}
            </Text>
          </TouchableOpacity>

          {photo ? (
            <TouchableOpacity
              disabled={submitting}
              onPress={() => setPhoto(null)}
              className="rounded-xl border border-zinc-300 px-4 py-2"
            >
              <Text className="text-xs font-bold text-zinc-600">Quitar</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text className="mt-2 text-[10px] text-[#666665]">Opcional · JPG, PNG o WEBP, máximo 2 MB.</Text>
      </View>

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
            value={form.fullName}
            onChangeText={(fullName) => setForm((current) => ({ ...current, fullName }))}
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
            value={form.community}
            onChangeText={(community) => setForm((current) => ({ ...current, community }))}
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
            value={form.uid}
            onChangeText={(uid) => setForm((current) => ({ ...current, uid }))}
            autoCapitalize="characters"
            className="rounded-xl border border-zinc-200 bg-[#f4f4f2] px-4 py-3.5 text-sm text-zinc-900"
          />

          <Text className="mt-1.5 text-[10px] leading-4 text-[#666665]">
            Identificador único de la tarjeta asignada al voluntario.
          </Text>
        </View>

        <View className="mb-5">
          <Text className="mb-2 text-xs font-bold text-[#666665]">Correo de acceso</Text>
          <TextInput value={form.email} onChangeText={(email) => setForm((current) => ({ ...current, email }))} autoCapitalize="none" keyboardType="email-address" placeholder="voluntario@ejemplo.com" placeholderTextColor="#a0a09e" className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-sm text-zinc-900" />
        </View>
        <View>
          <Text className="mb-2 text-xs font-bold text-[#666665]">Contraseña inicial</Text>
          <TextInput value={form.password} onChangeText={(password) => setForm((current) => ({ ...current, password }))} secureTextEntry placeholder="Mínimo 8 caracteres" placeholderTextColor="#a0a09e" className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-sm text-zinc-900" />
          <Text className="mt-1.5 text-[10px] text-[#666665]">La contraseña se envía solo a Supabase Auth y no se guarda en la app.</Text>
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

      {error ? <Text className="mt-4 text-xs font-semibold text-red-600">{error}</Text> : null}
      <TouchableOpacity disabled={submitting} onPress={submit} className={`mt-5 items-center rounded-xl bg-[#e88e29] py-4 ${submitting ? 'opacity-60' : ''}`}>
        <Text className="text-sm font-bold text-white">
          {submitting ? 'Registrando…' : photoFailedFor ? 'Reintentar foto' : submitLabel}
        </Text>
      </TouchableOpacity>

      {photoFailedFor ? (
        <TouchableOpacity
          disabled={submitting}
          onPress={() => onRegistered(photoFailedFor)}
          className="mt-3 items-center py-2"
        >
          <Text className="text-xs font-bold text-[#666665]">Continuar sin foto</Text>
        </TouchableOpacity>
      ) : null}


    </View>
  );
}
