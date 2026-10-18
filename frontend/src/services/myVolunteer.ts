import { pageRange, toPage } from '@/lib/pagination';
import { supabase } from '@/lib/supabase';
import { mapRequestRow, REQUEST_SELECT } from '@/services/redemptions';
import { formatLastVisit } from '@/services/volunteers';
import type { RedemptionRequest } from '@/types/redemption';
import type {
  MyCheckIn,
  MyRedemption,
  MyVolunteerProfile,
  Page,
  PageOptions,
} from '@/types/volunteer';

/**
 * Datos propios del voluntario con sesion iniciada. La identidad sale SIEMPRE
 * de la sesion: el voluntario se busca por volunteers.user_id = id de la
 * sesion y el historial se filtra con ese id, nunca con uno que mande la
 * pantalla. Ademas la RLS (supabase/005_volunteer_accounts.sql) solo deja
 * leer las filas propias.
 *
 * El catalogo de recompensas activas es getRewards() de services/rewards.ts
 * (la RLS ya se lo permite al rol volunteer).
 */

export type VolunteerAccountErrorCode = 'not_authenticated' | 'not_linked';

export class VolunteerAccountError extends Error {
  readonly code: VolunteerAccountErrorCode;

  constructor(code: VolunteerAccountErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VolunteerAccountError';
    this.code = code;
    // Igual que NfcError: sin esto, instanceof falla en el bundle de Hermes.
    Object.setPrototypeOf(this, VolunteerAccountError.prototype);
  }
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/lib/pagination';

const PROFILE_COLUMNS =
  'id, full_name, community, avatar_url, points, total_visits, last_check_in_at, is_active';

async function sessionUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (error || !userId) {
    throw new VolunteerAccountError('not_authenticated', 'Inicia sesión para ver tus datos.');
  }
  return userId;
}

function notLinked(): VolunteerAccountError {
  return new VolunteerAccountError(
    'not_linked',
    'Tu cuenta todavía no está vinculada a un voluntario. Pide a un administrador que la vincule.'
  );
}

/** id del voluntario vinculado a la sesion, o VolunteerAccountError. */
async function myVolunteerId(): Promise<string> {
  const userId = await sessionUserId();
  const { data, error } = await supabase
    .from('volunteers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar tu perfil: ${error.message}`);
  }
  if (!data) throw notLinked();
  return data.id as string;
}

/** Perfil y saldo de puntos del voluntario con sesion iniciada. */
export async function getMyVolunteerProfile(): Promise<MyVolunteerProfile> {
  const userId = await sessionUserId();
  const { data, error } = await supabase
    .from('volunteers')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar tu perfil: ${error.message}`);
  }
  if (!data) throw notLinked();

  return {
    id: data.id,
    name: data.full_name,
    community: data.community,
    points: data.points,
    lastVisit: formatLastVisit(data.last_check_in_at),
    avatar: data.avatar_url ?? undefined,
    isActive: data.is_active,
    totalVisits: data.total_visits,
    lastCheckInAt: data.last_check_in_at,
  };
}

/** Asistencias (check-ins) propias, de la mas reciente a la mas antigua. */
export async function getMyCheckIns(options?: PageOptions): Promise<Page<MyCheckIn>> {
  const volunteerId = await myVolunteerId();
  const r = pageRange(options);
  const { data, error, count } = await supabase
    .from('check_ins')
    .select('id, checked_in_at, points_awarded, visit_number, status', { count: 'exact' })
    .eq('volunteer_id', volunteerId)
    .order('checked_in_at', { ascending: false })
    .range(r.from, r.to);

  if (error) {
    throw new Error(`No se pudieron cargar tus asistencias: ${error.message}`);
  }

  const items: MyCheckIn[] = (data ?? []).map((row) => ({
    id: row.id,
    checkedInAt: row.checked_in_at,
    pointsAwarded: row.points_awarded,
    visitNumber: row.visit_number,
    status: row.status,
  }));
  return toPage(items, count, r);
}

/** Canjes propios, del mas reciente al mas antiguo. */
export async function getMyRedemptions(options?: PageOptions): Promise<Page<MyRedemption>> {
  const volunteerId = await myVolunteerId();
  const r = pageRange(options);
  const { data, error, count } = await supabase
    .from('reward_redemptions')
    .select('id, redeemed_at, points_spent, reward:rewards(id, name)', { count: 'exact' })
    .eq('volunteer_id', volunteerId)
    .order('redeemed_at', { ascending: false })
    .range(r.from, r.to);

  if (error) {
    throw new Error(`No se pudo cargar tu historial de canjes: ${error.message}`);
  }

  const items: MyRedemption[] = (data ?? []).map((row) => {
    const reward = Array.isArray(row.reward) ? row.reward[0] : row.reward;
    return {
      id: row.id,
      redeemedAt: row.redeemed_at,
      pointsSpent: row.points_spent,
      reward: reward ? { id: reward.id, name: reward.name } : null,
    };
  });
  return toPage(items, count, r);
}

/**
 * Solicitudes de canje propias (con estado de entrega y sus renglones), de la
 * mas reciente a la mas antigua. Los canjes previos a 006 no tienen solicitud:
 * siguen apareciendo solo en getMyRedemptions().
 */
export async function getMyRedemptionRequests(options?: PageOptions): Promise<Page<RedemptionRequest>> {
  const volunteerId = await myVolunteerId();
  const r = pageRange(options);
  const { data, error, count } = await supabase
    .from('redemption_requests')
    .select(REQUEST_SELECT, { count: 'exact' })
    .eq('volunteer_id', volunteerId)
    .order('created_at', { ascending: false })
    .range(r.from, r.to);

  if (error) {
    throw new Error(`No se pudieron cargar tus solicitudes de canje: ${error.message}`);
  }
  return toPage((data ?? []).map(mapRequestRow), count, r);
}
