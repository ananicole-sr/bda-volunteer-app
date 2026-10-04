import { supabase } from '@/lib/supabase';
import type { Reward, RewardRow } from '@/types/reward';

function mapRowToReward(row: RewardRow): Reward {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? 'Sin descripción',
    points: row.points_cost,
    stock: row.stock,
  };
}

export async function getRewards(): Promise<Reward[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, name, description, points_cost, stock, is_active, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`No se pudieron cargar las recompensas: ${error.message}`);
  }

  return (data as RewardRow[]).map(mapRowToReward);
}

export async function getRewardById(
  id: string
): Promise<Reward | null> {
  const { data, error } = await supabase
    .from('rewards')
    .select(
      'id, name, description, points_cost, stock, is_active, created_at'
    )
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(
      `No se pudo cargar la recompensa: ${error.message}`
    );
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description ?? '',
    points: data.points_cost,
    stock: data.stock,
  };
}