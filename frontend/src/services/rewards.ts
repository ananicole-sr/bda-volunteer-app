import { callEdgeFunction } from '@/lib/edgeFunctions';
import { supabase } from '@/lib/supabase';
import type {
  CreateRewardResult,
  DeactivateRewardResult,
  ManagedReward,
  Reward,
  RewardField,
  RewardInput,
  RewardNotFound,
  RewardRow,
  UpdateRewardInput,
  UpdateRewardResult,
} from '@/types/reward';

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

// ---------------------------------------------------------------- escritura (Edge Functions, solo admin)
// Lanzan EdgeFunctionError en 400/401/403/500; los codigos de negocio
// (ok, reward_not_found) se devuelven para que la pantalla decida que mostrar.

/** Igual que getRewardById (description null -> ''), mas el estado. */
function mapRowToManagedReward(row: RewardRow): ManagedReward {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    points: row.points_cost,
    stock: row.stock,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

const FIELD_FROM_COLUMN: Record<string, RewardField> = {
  name: 'name',
  description: 'description',
  points_cost: 'points',
  stock: 'stock',
};

/** Cuerpo con los nombres de columna; solo incluye los campos dados. */
function toRewardBody(input: UpdateRewardInput): Record<string, unknown> {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.points !== undefined && { points_cost: input.points }),
    ...(input.stock !== undefined && { stock: input.stock }),
  };
}

export async function createReward(input: RewardInput): Promise<CreateRewardResult> {
  const res = await callEdgeFunction<{ code: 'ok'; reward: RewardRow }>(
    'create-reward',
    toRewardBody(input)
  );
  return { code: res.code, reward: mapRowToManagedReward(res.reward) };
}

export async function updateReward(
  id: string,
  input: UpdateRewardInput
): Promise<UpdateRewardResult> {
  const res = await callEdgeFunction<
    { code: 'ok'; changed_fields: string[]; reward: RewardRow } | RewardNotFound
  >('update-reward', { reward_id: id, ...toRewardBody(input) });

  if (res.code !== 'ok') return res;
  return {
    code: 'ok',
    changedFields: res.changed_fields.map((c) => FIELD_FROM_COLUMN[c]).filter(Boolean),
    reward: mapRowToManagedReward(res.reward),
  };
}

/** is_active = false. No borra la fila, asi que el historial de canjes se conserva. */
export async function deactivateReward(id: string): Promise<DeactivateRewardResult> {
  const res = await callEdgeFunction<
    { code: 'ok'; already_inactive: boolean; reward: RewardRow } | RewardNotFound
  >('deactivate-reward', { reward_id: id });

  if (res.code !== 'ok') return res;
  return {
    code: 'ok',
    alreadyInactive: res.already_inactive,
    reward: mapRowToManagedReward(res.reward),
  };
}
