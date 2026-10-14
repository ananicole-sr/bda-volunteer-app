import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getNfcReader, NfcError } from '@/lib/nfc';

/**
 * Pantalla de prueba del lector NFC, solo para desarrollo. No esta enlazada
 * desde ninguna navegacion: se abre a mano en /dev/nfc-test.
 */
export default function NfcTestScreen() {
  const [reading, setReading] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Libera la sesion NFC si se sale de la pantalla a media lectura.
  useEffect(() => () => getNfcReader().cancel(), []);

  if (!__DEV__) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Pantalla solo disponible en desarrollo.</Text>
      </View>
    );
  }

  async function read() {
    setReading(true);
    setUid(null);
    setError(null);
    try {
      setUid(await getNfcReader().readUid());
    } catch (e) {
      setError(
        e instanceof NfcError
          ? { code: e.code, message: e.message }
          : { code: 'desconocido', message: String(e) }
      );
    } finally {
      setReading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Prueba de lectura NFC</Text>
      <Text style={styles.text}>
        {process.env.EXPO_PUBLIC_NFC_MOCK === '1' ? 'Lector simulado (EXPO_PUBLIC_NFC_MOCK=1)' : 'Lector real'}
      </Text>

      <Pressable style={[styles.button, reading && styles.buttonBusy]} onPress={read} disabled={reading}>
        <Text style={styles.buttonText}>{reading ? 'Acerca la tarjeta...' : 'Leer'}</Text>
      </Pressable>
      {reading ? (
        <Pressable onPress={() => getNfcReader().cancel()}>
          <Text style={styles.link}>Cancelar</Text>
        </Pressable>
      ) : null}

      {uid ? (
        <View style={styles.box}>
          <Text style={styles.label}>UID</Text>
          <Text selectable style={styles.uid}>{uid}</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.box}>
          <Text style={styles.label}>NfcError</Text>
          <Text selectable style={styles.errorCode}>{error.code}</Text>
          <Text style={styles.text}>{error.message}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  text: { fontSize: 14 },
  button: { backgroundColor: '#208AEF', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#208AEF', textAlign: 'center', fontSize: 14 },
  box: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, gap: 4 },
  label: { fontSize: 12, textTransform: 'uppercase', opacity: 0.6 },
  uid: { fontSize: 24, fontFamily: 'monospace', fontWeight: '700' },
  errorCode: { fontSize: 18, fontFamily: 'monospace', color: '#c0392b', fontWeight: '700' },
});
