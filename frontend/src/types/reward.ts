export interface Reward {
  id: string;
  name: string;
  description: string;
  points: number;
  stock: number;
}

export interface RewardRow {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  stock: number;
  is_active: boolean;
  created_at: string;
}

/** Datos para crear una recompensa (create-reward, solo admin). */
export interface RewardInput {
  name: string;
  /** null, vacio u omitido = sin descripcion. */
  description?: string | null;
  /** Costo en puntos: entero entre 0 y 2147483647. */
  points: number;
  /** Entero entre 0 y 2147483647. */
  stock: number;
}

/**
 * Cambios para update-reward. Omitir un campo = no cambiarlo; al menos uno es
 * obligatorio. description: null o '' borra la descripcion.
 */
export type UpdateRewardInput = Partial<RewardInput>;

/** Recompensa devuelta por las funciones de escritura (incluye el estado). */
export interface ManagedReward extends Reward {
  isActive: boolean;
  createdAt: string;
}

export type RewardField = 'name' | 'description' | 'points' | 'stock';

export interface RewardNotFound {
  code: 'reward_not_found';
  message?: string;
}

export interface CreateRewardResult {
  code: 'ok';
  reward: ManagedReward;
}

export type UpdateRewardResult =
  | { code: 'ok'; changedFields: RewardField[]; reward: ManagedReward }
  | RewardNotFound;

export type DeactivateRewardResult =
  | { code: 'ok'; alreadyInactive: boolean; reward: ManagedReward }
  | RewardNotFound;
