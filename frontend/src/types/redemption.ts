/** Contrato: docs/nfc-contract.md, funciones 10-12 (supabase/006_redemptions.sql). */

export type RedemptionStatus = 'pending_delivery' | 'delivered';

export interface RedemptionItem {
  rewardId: string;
  /** null solo si la recompensa dejo de ser visible para quien consulta. */
  name: string | null;
  /** Costo al momento del canje (historico). */
  pointsSpent: number;
}

export interface RedemptionRequest {
  id: string;
  clientRequestId: string;
  status: RedemptionStatus;
  totalPoints: number;
  createdAt: string;
  deliveredAt: string | null;
  items: RedemptionItem[];
}

/** Solicitud vista por un admin: incluye quien la hizo. */
export interface AdminRedemptionRequest extends RedemptionRequest {
  volunteer: { id: string; name: string } | null;
}

export type RewardUnavailableReason = 'not_found' | 'inactive' | 'out_of_stock';

export type RedeemRewardsResult =
  | {
      code: 'ok';
      /** true = reintento de una solicitud ya registrada: no se cobro de nuevo. */
      replayed: boolean;
      /** Saldo actual del voluntario despues del canje. */
      balance: number;
      request: RedemptionRequest;
    }
  | { code: 'insufficient_points'; message?: string; required: number; available: number }
  | {
      code: 'reward_unavailable';
      message?: string;
      rewards: { rewardId: string; reason: RewardUnavailableReason }[];
    }
  | { code: 'idempotency_conflict' | 'volunteer_not_linked' | 'volunteer_inactive'; message?: string };

export type MarkRedemptionDeliveredResult =
  | { code: 'ok'; alreadyDelivered: boolean; request: RedemptionRequest }
  | { code: 'request_not_found'; message?: string };

/** Notificacion in-app persistente para admins (distinta del mock de types/notification.ts). */
export interface AdminInAppNotification {
  id: string;
  type: 'redemption_requested';
  title: string;
  message: string;
  requestId: string | null;
  payload: {
    request_id?: string;
    volunteer_id?: string;
    volunteer_name?: string;
    total_points?: number;
    items?: { reward_id: string; name: string; points_spent: number }[];
  };
  createdAt: string;
  /** null = el admin actual no la ha leido. */
  readAt: string | null;
}

export interface MarkNotificationsReadResult {
  code: 'ok';
  /** Cuantas pasaron de no leidas a leidas en esta llamada. */
  marked: number;
  /** No leidas que le quedan al admin actual. */
  unread: number;
}
