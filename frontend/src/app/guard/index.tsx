import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { DEFAULT_MOCK_UID, getNfcReader, NfcError } from '@/lib/nfc';
import { submitCheckIn, type CheckInResult } from '@/services/checkIn';
import { getVolunteers } from '@/services/volunteers';
import type { Volunteer } from '@/types/volunteer';
import AppHeader from '@/components/common/AppHeader';

export default function GuardScreen() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]); const [loading, setLoading] = useState(true); const [scanning, setScanning] = useState(false); const [result, setResult] = useState<CheckInResult | null>(null);
  const load = useCallback(async () => { try { setVolunteers(await getVolunteers()); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const processVisit = async (uid: string) => {
    setScanning(true);
    setResult(null);
    try {
      setResult(await submitCheckIn(uid));
      await load();
    } catch (error) {
      setResult({ code: error instanceof NfcError ? error.code : 'error', message: error instanceof Error ? error.message : 'No se pudo registrar la visita.' });
    } finally {
      setScanning(false);
    }
  };
  const scan = async () => {
    try { await processVisit(await getNfcReader().readUid()); }
    catch (error) { setResult({ code: error instanceof NfcError ? error.code : 'error', message: error instanceof Error ? error.message : 'No se pudo leer la tarjeta.' }); }
  };
  return <View className="flex-1 bg-[#f4f4f2]"><AppHeader showSignOut /><View className="flex-1 px-6 pt-6"><View><Text className="text-2xl font-extrabold text-zinc-900">Estación de entrada</Text><Text className="mt-1 text-sm text-[#666665]">Solo lectura · Guardia</Text></View>
    <TouchableOpacity onPress={scan} disabled={scanning} className="mt-5 items-center rounded-2xl bg-[#218750] py-4"><Text className="font-bold text-white">{scanning ? 'Registrando visita…' : 'Escanear tarjeta NFC'}</Text></TouchableOpacity>
    <TouchableOpacity onPress={() => processVisit(DEFAULT_MOCK_UID)} disabled={scanning} className="mb-5 items-center rounded-2xl border border-[#e88e29] bg-white py-3 active:opacity-70"><Text className="text-sm font-bold text-[#e88e29]">Simular visita de prueba</Text><Text className="mt-1 text-[10px] text-[#666665]">Usa la tarjeta de desarrollo configurada</Text></TouchableOpacity>
    {result ? <View className={`mb-4 rounded-2xl p-5 ${result.code === 'ok' || result.code === 'duplicate_event' ? 'bg-[#218750]' : 'bg-[#d03030]'}`}><Text className="text-xs font-bold text-white">{result.code === 'ok' || result.code === 'duplicate_event' ? 'CHECK-IN AUTORIZADO ✓' : 'NO AUTORIZADO'}</Text><Text className="mt-2 text-xl font-extrabold text-white">{result.volunteer?.full_name ?? result.message ?? result.code}</Text>{result.volunteer ? <Text className="mt-1 text-white">{result.points_awarded ?? 0} puntos · {result.volunteer.total_visits} visitas</Text> : null}</View> : null}
    <Text className="mb-3 text-xs font-bold uppercase tracking-wider text-[#666665]">Registro de voluntarios</Text>{loading ? <ActivityIndicator color="#e88e29" /> : <ScrollView>{volunteers.map((v) => <View key={v.id} className="mb-3 flex-row justify-between rounded-2xl border border-zinc-200 bg-white p-4"><View><Text className="font-extrabold text-zinc-900">{v.name}</Text><Text className="text-xs text-[#666665]">{v.community} · {v.lastVisit}</Text></View><Text className="font-bold text-[#e88e29]">{v.points} pts</Text></View>)}</ScrollView>}</View></View>;
}
