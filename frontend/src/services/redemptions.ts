import { callEdgeFunction } from '@/lib/edgeFunctions';
import { pageRange, toPage } from '@/lib/pagination';
import { createRequestId } from '@/lib/requestId';
import { supabase } from '@/lib/supabase';
import type {
  AdminRedemptionRequest,
  MarkRedemptionDeliveredResult,
  RedeemRewardsResult,
  RedemptionRequest,
  RedemptionStatus,
  RewardUnavailableReason,
} from '@/types/redemption';
import type { Page, PageOptions } from '@/types/volunteer';

/**
 * Canjes (supabase/006_redemptions.sql). Escrituras por Edge Function; lanzan
 * EdgeFunctionError en 400/401/403/500 y devuelven los codigos de negocio.
 * El historial propio del voluntario esta en services/myVolunteer.ts
 * (getMyRedemptionRequests).
 */

export { createRequestId as createRedemptionRequestId };

interface RequestJson {
  id: string;
  client_request_id: string;
  status: RedemptionStatus;
  total_points: number;
  created_at: string;
  delivered_at: string | null;
  items: { reward_id: string; name: string | null; points_spent: number }[];
}

export function mapRequestJson(r: RequestJson): RedemptionRequest {
  return {
    id: r.id,
    clientRequestId: r.client_request_id,
    status: r.status,
    totalPoints: r.total_points,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
    items: (r.items ?? []).map((i) => ({ rewardId: i.reward_id, name: i.name, pointsSpent: i.points_spent })),
  };
}

/** Fila de redemption_requests con sus renglones embebidos (select de abajo). */
export const REQUEST_SELECT =
  'id, client_request_id, status, total_points, created_at, delivered_at, ' +
  'items:reward_redemptions(reward_id, points_spent, reward:rewards(name))';

type EmbeddedReward = { name: string } | { name: string }[] | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRequestRow(row: any): RedemptionRequest {
  return mapRequestJson({
    ...row,
    items: (row.items ?? []).map((i: { reward_id: string; points_spent: number; reward: EmbeddedReward }) => {
      const reward = Array.isArray(i.reward) ? i.reward[0] : i.reward;
      return { reward_id: i.reward_id, points_spent: i.points_spent, name: reward?.name ?? null };
    }),
  });
}

/**
 * El voluntario de la sesion canjea 1 unidad de cada recompensa. El servidor
 * toma la identidad, los costos y el saldo de la base: aqui solo van los ids.
 *
 * clientRequestId: genera uno con createRedemptionRequestId() cuando el
 * usuario confirma, y REUSA el mismo si reintentas por un error de red. Un
 * reintento responde ok con replayed = true y no cobra de nuevo.
 */
export async function redeemRewards(
  rewardIds: string[],
  clientRequestId: string
): Promise<RedeemRewardsResult> {
  const res = await callEdgeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { code: string; [k: string]: any }
  >('redeem-rewards', { client_request_id: clientRequestId, reward_ids: rewardIds });

  switch (res.code) {
    case 'ok':
      return { code: 'ok', replayed: res.replayed, balance: res.balance, request: mapRequestJson(res.request) };
    case 'insufficient_points':
      return { code: res.code, message: res.message, required: res.required, available: res.available };
    case 'reward_unavailable':
      return {
        code: res.code,
        message: res.message,
        rewards: (res.rewards ?? []).map((r: { reward_id: string; reason: RewardUnavailableReason }) => ({
          rewardId: r.reward_id,
          reason: r.reason,
        })),
      };
    default:
      return { code: res.code as 'idempotency_conflict' | 'volunteer_not_linked' | 'volunteer_inactive', message: res.message };
  }
}

// ---------------------------------------------------------------- admin

/** Solicitudes de todos los voluntarios (RLS: solo admin). Mas recientes primero. */
export async function listRedemptionRequests(
  options: PageOptions & { status?: RedemptionStatus } = {}
): Promise<Page<AdminRedemptionRequest>> {
  const r = pageRange(options);
  let query = supabase
    .from('redemption_requests')
    .select(`${REQUEST_SELECT}, volunteer:volunteers(id, full_name)`, { count: 'exact' });
  if (options.status) query = query.eq('status', options.status);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(r.from, r.to);

  if (error) {
    throw new Error(`No se pudieron cargar las solicitudes de canje: ${error.message}`);
  }

  const items: AdminRedemptionRequest[] = (data ?? []).map((row) => {
    const v = Array.isArray(row.volunteer) ? row.volunteer[0] : row.volunteer;
    return { ...mapRequestRow(row), volunteer: v ? { id: v.id, name: v.full_name } : null };
  });
  return toPage(items, count, r);
}

/** Marca la solicitud como entregada (solo admin). No cobra de nuevo; repetir es seguro. */
export async function markRedemptionDelivered(requestId: string): Promise<MarkRedemptionDeliveredResult> {
  const res = await callEdgeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { code: string; [k: string]: any }
  >('mark-redemption-delivered', { request_id: requestId });

  if (res.code === 'ok') {
    return { code: 'ok', alreadyDelivered: res.already_delivered, request: mapRequestJson(res.request) };
  }
  return { code: 'request_not_found', message: res.message };
}
