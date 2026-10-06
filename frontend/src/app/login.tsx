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

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    router.replace('/admin');
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
            Acceso administrador
          </Text>
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
