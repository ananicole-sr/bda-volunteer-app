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