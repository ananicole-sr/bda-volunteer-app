import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { getMyRole, routeForRole, type AppRole } from '@/services/profile';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AppRole>('admin');

  const handleLogin = async () => {
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Escribe tu correo y contrasena.');
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage('Correo o contrasena incorrectos.');
      return;
    }

    try {
      const role = await getMyRole();
      if (!role) {
        setErrorMessage('Tu cuenta no tiene un rol asignado. Contacta a un administrador.');
        await supabase.auth.signOut();
        return;
      }
      router.replace(routeForRole(role) as never);
    } catch (roleError) {
      setErrorMessage(roleError instanceof Error ? roleError.message : 'No se pudo verificar tu rol.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-zinc-50"
    >
      <View className="flex-1 justify-center px-6">
        <View className="mb-8">
          <Text className="text-3xl font-black tracking-tight text-zinc-900">RED BAMX</Text>
          <Text className="mt-2 text-sm font-semibold uppercase tracking-wider text-[#666665]">
            Selecciona una vista y entra con tu cuenta
          </Text>
        </View>

        <View className="mb-6 flex-row gap-2">
          {(['admin', 'guard', 'volunteer'] as AppRole[]).map((role) => (
            <TouchableOpacity key={role} onPress={() => setSelectedRole(role)} className={`flex-1 rounded-xl px-2 py-3 ${selectedRole === role ? 'bg-[#e88e29]' : 'bg-white border border-zinc-200'}`}>
              <Text className={`text-center text-xs font-bold ${selectedRole === role ? 'text-white' : 'text-[#666665]'}`}>
                {role === 'admin' ? 'Admin' : role === 'guard' ? 'Guardia' : 'Voluntario'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-2 text-sm font-semibold text-zinc-700">Correo</Text>
            <TextInput
              className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="admin@ejemplo.com"
              placeholderTextColor="#a1a1aa"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View>
            <Text className="mb-2 text-sm font-semibold text-zinc-700">Contrasena</Text>
            <TextInput
              className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900"
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Tu contrasena"
              placeholderTextColor="#a1a1aa"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
            />
          </View>

          {errorMessage ? (
            <Text className="text-sm font-semibold text-red-600">{errorMessage}</Text>
          ) : null}

          <Text className="-mt-2 text-center text-xs text-[#666665]">La vista final se determina por el rol real de tu cuenta.</Text>

          <TouchableOpacity
            className="mt-2 items-center rounded-2xl bg-[#e88e29] py-4 active:opacity-90"
            disabled={isSubmitting}
            onPress={handleLogin}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-base font-bold text-white">Entrar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
