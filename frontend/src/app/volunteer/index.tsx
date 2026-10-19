import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import AppHeader from '@/components/common/AppHeader';
import { getMyCheckIns, getMyVolunteerProfile } from '@/services/myVolunteer';
import { getRewards } from '@/services/rewards';
import { createRedemptionRequestId, redeemRewards } from '@/services/redemptions';
import type { MyCheckIn, MyVolunteerProfile } from '@/types/volunteer';
import type { Reward } from '@/types/reward';

export default function VolunteerScreen() {
  const [profile, setProfile] = useState<MyVolunteerProfile | null>(null);
  const [visits, setVisits] = useState<MyCheckIn[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'profile' | 'rewards'>('profile');

  const load = useCallback(async () => {
    try {
      setError(null);
      const [nextProfile, nextVisits, nextRewards] = await Promise.all([getMyVolunteerProfile(), getMyCheckIns(), getRewards()]);
      setProfile(nextProfile); setVisits(nextVisits.items); setRewards(nextRewards);
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudieron cargar tus datos.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const redeem = async (reward: Reward) => {
    try {
      const result = await redeemRewards([reward.id], createRedemptionRequestId());
      if (result.code === 'ok') await load(); else setError(result.message ?? 'No fue posible canjear la recompensa.');
    } catch (error) { setError(error instanceof Error ? error.message : 'No fue posible canjear.'); }
  };

  if (loading) return <View className="flex-1 items-center justify-center bg-[#f4f4f2]"><ActivityIndicator color="#e88e29" /></View>;
  if (!profile) return <View className="flex-1 items-center justify-center bg-[#f4f4f2] px-6"><Text className="text-center text-sm text-[#d03030]">{error}</Text></View>;

  return <View className="flex-1 bg-[#f4f4f2]"><AppHeader showSignOut /><ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingVertical: 20, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
    <View className="items-center rounded-3xl bg-[#218750] p-6 shadow-sm"><View className="h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-[#e88e29]"><Text className="text-2xl font-extrabold text-white">{profile.name.charAt(0)}</Text></View><Text className="mt-3 text-xl font-extrabold text-white">{profile.name}</Text><Text className="mt-1 text-sm text-green-50">Comunidad: {profile.community}</Text><View className="mt-4 rounded-full bg-white px-5 py-2"><Text className="text-lg font-extrabold text-[#e88e29]">{profile.points} puntos</Text></View></View>
    {error ? <View className="mt-4 rounded-xl bg-red-50 p-3"><Text className="text-xs font-semibold text-[#d03030]">{error}</Text></View> : null}
    <View className="mt-5 flex-row rounded-2xl bg-white p-1.5">{(['profile', 'rewards'] as const).map((item) => <TouchableOpacity key={item} onPress={() => setTab(item)} className={`flex-1 rounded-xl py-3 ${tab === item ? 'bg-[#e88e29]' : ''}`}><Text className={`text-center text-sm font-bold ${tab === item ? 'text-white' : 'text-[#666665]'}`}>{item === 'profile' ? 'Mi actividad' : 'Recompensas'}</Text></TouchableOpacity>)}</View>
    {tab === 'profile' ? <><View className="mt-5 flex-row gap-3"><View className="flex-1 rounded-2xl bg-white p-4"><Text className="text-xs font-bold uppercase text-[#666665]">Visitas</Text><Text className="mt-2 text-3xl font-extrabold text-[#218750]">{profile.totalVisits}</Text><Text className="mt-1 text-xs text-[#666665]">en total</Text></View><View className="flex-1 rounded-2xl bg-white p-4"><Text className="text-xs font-bold uppercase text-[#666665]">Última visita</Text><Text className="mt-2 text-sm font-extrabold text-zinc-900">{profile.lastVisit}</Text></View></View><Text className="mb-3 mt-6 text-sm font-extrabold text-zinc-900">Mis últimas visitas</Text>{visits.length === 0 ? <View className="rounded-2xl bg-white p-5"><Text className="text-center text-sm text-[#666665]">Todavía no tienes visitas registradas.</Text></View> : visits.map((visit) => <View key={visit.id} className="mb-3 flex-row items-center justify-between rounded-2xl bg-white p-4"><View><Text className="font-extrabold text-zinc-900">Visita {visit.visitNumber ?? '—'}</Text><Text className="mt-1 text-xs text-[#666665]">{new Date(visit.checkedInAt).toLocaleString('es-MX')}</Text></View><View className="rounded-full bg-green-50 px-3 py-1.5"><Text className="text-xs font-bold text-[#218750]">+{visit.pointsAwarded} pts</Text></View></View>)}</> : <><Text className="mb-3 mt-6 text-sm font-extrabold text-zinc-900">Canjea tus puntos</Text>{rewards.map((reward) => { const available = reward.stock > 0 && profile.points >= reward.points; return <View key={reward.id} className="mb-3 rounded-2xl bg-white p-4"><View className="flex-row items-start justify-between"><View className="mr-3 flex-1"><Text className="text-base font-extrabold text-zinc-900">{reward.name}</Text><Text className="mt-1 text-xs leading-5 text-[#666665]">{reward.description}</Text></View><Text className="font-extrabold text-[#e88e29]">{reward.points} pts</Text></View><View className="mt-4 flex-row items-center justify-between"><Text className="text-xs font-semibold text-[#666665]">{reward.stock} disponibles</Text><TouchableOpacity disabled={!available} onPress={() => redeem(reward)} className={`rounded-xl px-4 py-2.5 ${available ? 'bg-[#e88e29]' : 'bg-zinc-200'}`}><Text className={`text-xs font-bold ${available ? 'text-white' : 'text-[#666665]'}`}>{reward.stock === 0 ? 'Agotado' : profile.points < reward.points ? 'Puntos insuficientes' : 'Canjear'}</Text></TouchableOpacity></View></View>; })}</>}
  </ScrollView></View>;
}
