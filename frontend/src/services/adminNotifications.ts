import { callEdgeFunction } from '@/lib/edgeFunctions';
import { pageRange, toPage } from '@/lib/pagination';
import { supabase } from '@/lib/supabase';
import type { AdminInAppNotification, MarkNotificationsReadResult } from '@/types/redemption';
import type { Page, PageOptions } from '@/types/volunteer';

/**
 * Notificaciones in-app persistentes para admins (supabase/006_redemptions.sql).
 * La lectura usa la vista admin_notifications_feed, que trae el read_at DEL
 * ADMIN DE LA SESION (cada admin tiene su propio estado de leido). La RLS
 * solo deja leerlas a admins. Sin email ni push.
 */

const FEED_COLUMNS = 'id, type, title, message, payload, request_id, created_at, read_at';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): AdminInAppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    requestId: row.request_id,
    payload: row.payload ?? {},
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/** Mas recientes primero. unreadOnly = solo las que el admin actual no ha leido. */
export async function listAdminNotifications(
  options: PageOptions & { unreadOnly?: boolean } = {}
): Promise<Page<AdminInAppNotification>> {
  const r = pageRange(options);
  let query = supabase.from('admin_notifications_feed').select(FEED_COLUMNS, { count: 'exact' });
  if (options.unreadOnly) query = query.is('read_at', null);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(r.from, r.to);

  if (error) {
    throw new Error(`No se pudieron cargar las notificaciones: ${error.message}`);
  }
  return toPage((data ?? []).map(mapRow), count, r);
}

/** Cuantas no ha leido el admin actual (para el badge). */
export async function getUnreadAdminNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('admin_notifications_feed')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) {
    throw new Error(`No se pudo contar las notificaciones: ${error.message}`);
  }
  return count ?? 0;
}

/** Marca como leidas para el admin actual. Ids inexistentes se ignoran. */
export async function markAdminNotificationsRead(ids: string[]): Promise<MarkNotificationsReadResult> {
  return callEdgeFunction<MarkNotificationsReadResult>('mark-notifications-read', { notification_ids: ids });
}

export async function markAllAdminNotificationsRead(): Promise<MarkNotificationsReadResult> {
  return callEdgeFunction<MarkNotificationsReadResult>('mark-notifications-read', { all: true });
}
