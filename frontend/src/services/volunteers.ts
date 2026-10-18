import { callEdgeFunction } from '@/lib/edgeFunctions';
import { supabase } from '@/lib/supabase';
import type {
  DeactivateVolunteerResult,
  LinkVolunteerAccountResult,
  UpdateVolunteerInput,
  UpdateVolunteerResult,
  Volunteer,
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
