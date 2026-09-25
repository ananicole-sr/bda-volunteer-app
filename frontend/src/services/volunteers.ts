import { supabase } from '@/lib/supabase';
import type { Volunteer, VolunteerRow } from '@/types/volunteer';

/**
 * Formatea un timestamp de Postgres ("2026-09-07 10:15:00-06") al formato
 * corto que ya usa el dashboard ("07 Sep 2026").
 */
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

/**
 * READ desde Supabase (DS1 - Voluntarios) para el Dashboard de Admin.
 * Reemplaza el array hardcoded que vivía en admin/index.tsx.
 *
 * Corresponde al flujo F10/F11 del DFD: el administrador pide el panel de
 * asistencia y puntos, y se consulta el historial/saldo de cada voluntario.
 */
export async function getVolunteers(): Promise<Volunteer[]> {
  const { data, error } = await supabase
    .from('volunteers')
    .select('id, nfc_uid, full_name, community, avatar_url, points, last_check_in_at, is_active')
    .eq('is_active', true)
    .order('last_check_in_at', { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`No se pudieron cargar los voluntarios: ${error.message}`);
  }

  return (data as VolunteerRow[]).map(mapRowToVolunteer);
}
