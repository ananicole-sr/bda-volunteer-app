import React, { useState } from 'react';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { createRegistrationRequestId, registerVolunteerAccount } from '@/services/volunteers';
import type { RegisterVolunteerAccountInput } from '@/types/volunteer';

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

  const submit = async () => {
    if (!form.fullName.trim() || !form.community.trim() || !form.uid.trim() || !form.email.trim() || !form.password) {
      setError('Completa todos los campos requeridos.'); return;
    }
    const requestId = clientRequestId ?? createRegistrationRequestId();
    setClientRequestId(requestId); setError(''); setSubmitting(true);
    try {
      const input: RegisterVolunteerAccountInput = { clientRequestId: requestId, fullName: form.fullName.trim(), community: form.community.trim(), uid: form.uid.trim(), email: form.email.trim(), password: form.password };
      const result = await registerVolunteerAccount(input);
      if (result.code === 'ok') onRegistered(result.volunteer.id);
      else setError(result.message ?? 'No se pudo registrar el voluntario.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar el voluntario. Intenta de nuevo.'); }
    finally { setSubmitting(false); }
  };
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
          {submitting ? 'Registrando…' : submitLabel}
        </Text>
      </TouchableOpacity>


    </View>
  );
}
