import { callEdgeFunction } from '@/lib/edgeFunctions';
import { createRequestId } from '@/lib/requestId';
import { supabase } from '@/lib/supabase';
import type {
  DeactivateVolunteerResult,
  LinkVolunteerAccountResult,
  RegisterVolunteerAccountInput,
  RegisterVolunteerAccountResult,
  UpdateVolunteerInput,
  UpdateVolunteerResult,
  Volunteer,
  VolunteerCheckIn,
  VolunteerRow,
} from '@/types/volunteer';

export function formatLastVisit(timestamp: string | null): string {
  if (!timestamp) return 'Sin visitas';

  const date = new Date(timestamp);
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function mapRowToVolunteer(row: VolunteerRow): Volunteer {
  return {
    id: row.id,
    name: row.full_name,
    community: row.community,
    points: row.points,
    lastVisit: formatLastVisit(row.last_check_in_at),
    avatar: row.avatar_url ?? undefined,
    isActive: row.is_active,
  };
}

export async function getVolunteers(): Promise<Volunteer[]> {
  const { data, error } = await supabase
    .from('volunteers')
    .select('id, full_name, community, avatar_url, points, last_check_in_at, is_active')
    .eq('is_active', true)
    .order('last_check_in_at', { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`No se pudieron cargar los voluntarios: ${error.message}`);
  }

  return (data as VolunteerRow[]).map(mapRowToVolunteer);
}

export async function getVolunteerById(
  id: string
): Promise<Volunteer | null> {
  const { data, error } = await supabase
    .from('volunteers')
    .select(
      'id, full_name, community, avatar_url, points, last_check_in_at, is_active'
    )
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(
      `No se pudo cargar el voluntario: ${error.message}`
    );
  }

  return mapRowToVolunteer(data as VolunteerRow);
}

/** Últimas asistencias de un voluntario. La RLS permite esta lectura a admin y guard. */
export async function getVolunteerCheckIns(id: string, limit = 20): Promise<VolunteerCheckIn[]> {
  const { data, error } = await supabase
    .from('check_ins')
    .select('id, checked_in_at, points_awarded, visit_number, status')
    .eq('volunteer_id', id)
    .order('checked_in_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`No se pudo cargar el historial de visitas: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    checkedInAt: row.checked_in_at,
    pointsAwarded: row.points_awarded,
    visitNumber: row.visit_number,
    status: row.status,
  })) as VolunteerCheckIn[];
}

/**
 * Cambia nombre y/o comunidad (Edge Function update-volunteer, solo admin).
 * Los campos omitidos no se tocan. Lanza EdgeFunctionError en 400/401/403/500.
 */
export async function updateVolunteer(
  id: string,
  input: UpdateVolunteerInput
): Promise<UpdateVolunteerResult> {
  return callEdgeFunction<UpdateVolunteerResult>('update-volunteer', {
    volunteer_id: id,
    ...(input.fullName !== undefined && { full_name: input.fullName }),
    ...(input.community !== undefined && { community: input.community }),
  });
}

/**
 * Marca al voluntario como inactivo (Edge Function deactivate-volunteer, solo
 * admin). Idempotente: si ya estaba inactivo responde ok con already_inactive.
 */
export async function deactivateVolunteer(id: string): Promise<DeactivateVolunteerResult> {
  return callEdgeFunction<DeactivateVolunteerResult>('deactivate-volunteer', { volunteer_id: id });
}

/**
 * Vincula un voluntario existente a una cuenta de Auth que ya existe y ya
 * tiene role volunteer (Edge Function link-volunteer-account, solo admin).
 * userId es el auth.users.id de la cuenta; no se busca por email ni nombre.
 * Repetir el mismo vinculo responde ok con already_linked = true.
 */
export async function linkVolunteerAccount(
  volunteerId: string,
  userId: string
): Promise<LinkVolunteerAccountResult> {
  return callEdgeFunction<LinkVolunteerAccountResult>('link-volunteer-account', {
    volunteer_id: volunteerId,
    user_id: userId,
  });
}

export { createRequestId as createRegistrationRequestId };

/**
 * Alta de voluntario + tarjeta + cuenta de acceso con rol volunteer, ya
 * vinculada (Edge Function register-volunteer-account, solo admin). El rol lo
 * asigna el servidor. El admin entrega email y contrasena al voluntario;
 * cambiarla despues es opcional (services/account.ts).
 *
 * Reintentos: usa el MISMO clientRequestId. Si la primera vez se creo la
 * cuenta pero algo fallo despues, el reintento la reusa (y le deja la
 * contrasena de este intento) en lugar de crear otra.
 * No guardes la contrasena en estado persistente ni la registres en logs.
 */
export async function registerVolunteerAccount(
  input: RegisterVolunteerAccountInput
): Promise<RegisterVolunteerAccountResult> {
  return callEdgeFunction<RegisterVolunteerAccountResult>('register-volunteer-account', {
    client_request_id: input.clientRequestId,
    full_name: input.fullName,
    community: input.community,
    uid: input.uid,
    email: input.email,
    password: input.password,
  });
}
