import { supabase } from '@/lib/supabase';
import type { Volunteer, VolunteerRow } from '@/types/volunteer';

function formatLastVisit(timestamp: string | null): string {
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
