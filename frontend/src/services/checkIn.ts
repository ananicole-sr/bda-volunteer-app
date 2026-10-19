import { callEdgeFunction } from '@/lib/edgeFunctions';
import { createRequestId } from '@/lib/requestId';

export type CheckInResult = { code: string; message?: string; points_awarded?: number; volunteer?: { id: string; full_name: string; points: number; total_visits: number } };

export function submitCheckIn(uid: string) {
  return callEdgeFunction<CheckInResult>('check-in', {
    event_id: createRequestId(), uid, terminal_id: 'recepcion-1', client_ts: new Date().toISOString(),
  });
}
