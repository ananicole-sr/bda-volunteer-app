import { callEdgeFunction } from '@/lib/edgeFunctions';
import { pageRange, toPage } from '@/lib/pagination';
import { createRequestId } from '@/lib/requestId';
import { supabase } from '@/lib/supabase';
import { avatarUrl } from '@/services/volunteers';
import type {
  AdminRedeemRewardsResult,
  AdminRedemptionRequest,
  LookupCardResult,
  MarkRedemptionDeliveredResult,
  MarkRedemptionItemDeliveredResult,
  RedeemRewardsCardResult,
  RedeemRewardsResult,
  RedemptionChannel,
  RedemptionRecord,
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

interface ItemJson {
  id?: string;
  reward_id: string;
  name: string | null;
  points_spent: number;
  status?: RedemptionStatus | null;
  delivered_at?: string | null;
}

interface RequestJson {
  id: string;
  client_request_id: string;
  status: RedemptionStatus;
  channel?: RedemptionChannel;
  total_points: number;
  created_at: string;
  delivered_at: string | null;
  items: ItemJson[];
}

export function mapRequestJson(r: RequestJson): RedemptionRequest {
  return {
    id: r.id,
    clientRequestId: r.client_request_id,
    status: r.status,
    channel: r.channel,
    totalPoints: r.total_points,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
    items: (r.items ?? []).map((i) => ({
      id: i.id,
      rewardId: i.reward_id,
      name: i.name,
      pointsSpent: i.points_spent,
      status: i.status,
      deliveredAt: i.delivered_at,
    })),
  };
}

/** Fila de redemption_requests con sus renglones embebidos (select de abajo). */
export const REQUEST_SELECT =
  'id, client_request_id, status, channel, total_points, created_at, delivered_at, ' +
  'items:reward_redemptions(id, reward_id, points_spent, status, delivered_at, reward:rewards(name))';

type EmbeddedReward = { name: string } | { name: string }[] | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRequestRow(row: any): RedemptionRequest {
  return mapRequestJson({
    ...row,
    items: (row.items ?? []).map((i: ItemJson & { reward: EmbeddedReward }) => {
      const reward = Array.isArray(i.reward) ? i.reward[0] : i.reward;
      return {
        id: i.id, reward_id: i.reward_id, points_spent: i.points_spent, name: reward?.name ?? null,
        status: i.status, delivered_at: i.delivered_at,
      };
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

  return mapRedeemResponse(res) as RedeemRewardsResult;
}

/** Respuesta de redeem-rewards y sus variantes de admin, en camelCase. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRedeemResponse(res: { code: string; [k: string]: any }) {
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
      return { code: res.code, message: res.message };
  }
}

// ---------------------------------------------------------------- admin

/**
 * El admin canjea para un voluntario (perfil). Mismas reglas que
 * redeemRewards: genera clientRequestId al confirmar y REUSALO si reintentas.
 */
export async function adminRedeemRewards(
  volunteerId: string,
  rewardIds: string[],
  clientRequestId: string
): Promise<AdminRedeemRewardsResult> {
  const res = await callEdgeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { code: string; [k: string]: any }
  >('admin-redeem-rewards', { volunteer_id: volunteerId, client_request_id: clientRequestId, reward_ids: rewardIds });
  return mapRedeemResponse(res) as AdminRedeemRewardsResult;
}

/**
 * El admin canjea con la tarjeta NFC: el servidor saca al voluntario de la
 * tarjeta (uid tal cual lo devuelve getNfcReader().readUid()).
 */
export async function redeemRewardsWithCard(
  uid: string,
  rewardIds: string[],
  clientRequestId: string
): Promise<RedeemRewardsCardResult> {
  const res = await callEdgeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { code: string; [k: string]: any }
  >('redeem-rewards-card', { uid, client_request_id: clientRequestId, reward_ids: rewardIds });
  return mapRedeemResponse(res) as RedeemRewardsCardResult;
}

/** Dueno y saldo de una tarjeta, antes de confirmar un canje con ella. Solo lectura. */
export async function lookupCard(uid: string): Promise<LookupCardResult> {
  const res = await callEdgeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { code: string; [k: string]: any }
  >('lookup-card', { uid });

  if (res.code === 'ok') {
    const v = res.volunteer;
    return {
      code: 'ok',
      volunteer: { id: v.id, name: v.full_name, community: v.community, points: v.points, avatar: avatarUrl(v.avatar_url) },
    };
  }
  if (res.code === 'volunteer_inactive') {
    return { code: res.code, message: res.message, volunteer: { id: res.volunteer.id, name: res.volunteer.full_name } };
  }
  return { code: res.code as 'card_unknown' | 'card_inactive', message: res.message };
}

const RECORD_SELECT = 'id, request_id, reward_id, points_spent, redeemed_at, status, delivered_at, reward:rewards(name)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecordRow(row: any): RedemptionRecord {
  const reward = Array.isArray(row.reward) ? row.reward[0] : row.reward;
  return {
    id: row.id,
    requestId: row.request_id,
    rewardId: row.reward_id,
    name: reward?.name ?? row.name ?? null,
    pointsSpent: row.points_spent,
    redeemedAt: row.redeemed_at,
    status: row.status,
    deliveredAt: row.delivered_at,
  };
}

/** Canjes de un voluntario, uno por renglon, del mas reciente al mas antiguo (RLS: admin). */
export async function getVolunteerRedemptions(volunteerId: string, limit = 50): Promise<RedemptionRecord[]> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select(RECORD_SELECT)
    .eq('volunteer_id', volunteerId)
    .order('redeemed_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`No se pudo cargar el historial de canjes: ${error.message}`);
  return (data ?? []).map(mapRecordRow);
}

/** Canjes (renglones) de varias solicitudes, agrupados por request_id (RLS: admin). */
export async function getRedemptionsByRequest(
  requestIds: string[]
): Promise<Record<string, RedemptionRecord[]>> {
  if (requestIds.length === 0) return {};

  const { data, error } = await supabase
    .from('reward_redemptions')
    .select(RECORD_SELECT)
    .in('request_id', requestIds)
    .order('reward_id', { ascending: true });

  if (error) throw new Error(`No se pudo cargar el estado de los canjes: ${error.message}`);

  const grouped: Record<string, RedemptionRecord[]> = {};
  for (const record of (data ?? []).map(mapRecordRow)) {
    if (record.requestId) (grouped[record.requestId] ??= []).push(record);
  }
  return grouped;
}

/** Marca UN canje como entregado (solo admin). Los demas canjes no cambian; repetir es seguro. */
export async function markRedemptionItemDelivered(redemptionId: string): Promise<MarkRedemptionItemDeliveredResult> {
  const res = await callEdgeFunction<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { code: string; [k: string]: any }
  >('mark-redemption-item-delivered', { redemption_id: redemptionId });

  if (res.code === 'ok') {
    return {
      code: 'ok',
      alreadyDelivered: res.already_delivered,
      redemption: mapRecordRow(res.redemption),
      requestStatus: res.request_status ?? null,
    };
  }
  return { code: 'redemption_not_found', message: res.message };
}

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
