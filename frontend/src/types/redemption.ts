/** Contrato: docs/nfc-contract.md, funciones 10-12 y 15-18 (supabase/006 y 010). */

export type RedemptionStatus = 'pending_delivery' | 'delivered';

/** Quien origino el canje (010). */
export type RedemptionChannel = 'volunteer_app' | 'admin' | 'admin_card';

export interface RedemptionItem {
  /** reward_redemptions.id: cada renglon es un canje con su propio estado (010). */
  id?: string;
  rewardId: string;
  /** null solo si la recompensa dejo de ser visible para quien consulta. */
  name: string | null;
  /** Costo al momento del canje (historico). */
  pointsSpent: number;
  /** Estado de ESTE canje (010). null = historico previo a 006. */
  status?: RedemptionStatus | null;
  deliveredAt?: string | null;
}

export interface RedemptionRequest {
  id: string;
  clientRequestId: string;
  /** Resumen: 'delivered' cuando ya no le queda ningun renglon pendiente. */
  status: RedemptionStatus;
  channel?: RedemptionChannel;
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

/** Respuesta de admin-redeem-rewards (funcion 15): las de redeem-rewards salvo volunteer_not_linked. */
export type AdminRedeemRewardsResult =
  | Exclude<RedeemRewardsResult, { code: 'idempotency_conflict' | 'volunteer_not_linked' | 'volunteer_inactive' }>
  | { code: 'idempotency_conflict' | 'volunteer_not_found' | 'volunteer_inactive'; message?: string };

/** Respuesta de redeem-rewards-card (funcion 16). */
export type RedeemRewardsCardResult =
  | AdminRedeemRewardsResult
  | { code: 'card_unknown' | 'card_inactive'; message?: string };

/** Dueno de una tarjeta, para confirmar el canje (lookup-card, funcion 17). */
export interface CardVolunteer {
  id: string;
  name: string;
  community: string;
  points: number;
  avatar?: string;
}

export type LookupCardResult =
  | { code: 'ok'; volunteer: CardVolunteer }
  | { code: 'volunteer_inactive'; message?: string; volunteer: { id: string; name: string } }
  | { code: 'card_unknown' | 'card_inactive'; message?: string };

/** Un canje (renglon) con su estado, para el historial y las entregas. */
export interface RedemptionRecord {
  id: string;
  requestId: string | null;
  rewardId: string;
  /** null solo si la recompensa dejo de ser visible para quien consulta. */
  name: string | null;
  pointsSpent: number;
  redeemedAt: string;
  status: RedemptionStatus | null;
  deliveredAt: string | null;
}

export type MarkRedemptionItemDeliveredResult =
  | {
      code: 'ok';
      alreadyDelivered: boolean;
      redemption: RedemptionRecord;
      /** Estado resumen de la solicitud tras la entrega (null en canjes historicos). */
      requestStatus: RedemptionStatus | null;
    }
  | { code: 'redemption_not_found'; message?: string };

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
