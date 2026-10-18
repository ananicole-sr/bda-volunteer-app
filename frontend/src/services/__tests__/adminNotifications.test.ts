/// <reference types="jest" />
import {
  getUnreadAdminNotificationCount,
  listAdminNotifications,
  markAdminNotificationsRead,
  markAllAdminNotificationsRead,
} from '../adminNotifications';

const mockInvoke = jest.fn();
type Call = [string, ...unknown[]];
const mockQueries: { table: string; calls: Call[] }[] = [];
const mockResults: unknown[] = [];

function mockBuilder(table: string) {
  const q = { table, calls: [] as Call[] };
  mockQueries.push(q);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'range']) {
    b[m] = (...args: unknown[]) => {
      q.calls.push([m, ...args]);
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(mockResults.shift()).then(res, rej);
  return b;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    from: (table: string) => mockBuilder(table),
  },
}));

const row = {
  id: 'n1', type: 'redemption_requested', title: 'Canje pendiente de entrega',
  message: 'Red A canjeó: Cien (100 pts). Total: 100 pts.', request_id: 'q1',
  payload: { volunteer_name: 'Red A', total_points: 100 }, created_at: '2026-10-18T20:00:00Z', read_at: null,
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockQueries.length = 0;
  mockResults.length = 0;
});

describe('listAdminNotifications', () => {
  it('lee el feed por admin, mas recientes primero, y mapea', async () => {
    mockResults.push({ data: [row], error: null, count: 1 });
    const page = await listAdminNotifications();
    expect(mockQueries[0].table).toBe('admin_notifications_feed');
    expect(mockQueries[0].calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(mockQueries[0].calls.some((c) => c[0] === 'is')).toBe(false);
    expect(page.items).toEqual([{
      id: 'n1', type: 'redemption_requested', title: 'Canje pendiente de entrega',
      message: row.message, requestId: 'q1', payload: row.payload, createdAt: row.created_at, readAt: null,
    }]);
  });

  it('unreadOnly filtra read_at is null', async () => {
    mockResults.push({ data: [], error: null, count: 0 });
    await listAdminNotifications({ unreadOnly: true, pageSize: 5 });
    expect(mockQueries[0].calls).toContainEqual(['is', 'read_at', null]);
    expect(mockQueries[0].calls).toContainEqual(['range', 0, 4]);
  });

  it('error de la base -> Error con mensaje', async () => {
    mockResults.push({ data: null, error: { message: 'permission denied' }, count: null });
    await expect(listAdminNotifications()).rejects.toThrow('permission denied');
  });
});

describe('contador y marcar leidas', () => {
  it('getUnreadAdminNotificationCount usa head + count sobre no leidas', async () => {
    mockResults.push({ data: null, error: null, count: 3 });
    expect(await getUnreadAdminNotificationCount()).toBe(3);
    expect(mockQueries[0].calls).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
    expect(mockQueries[0].calls).toContainEqual(['is', 'read_at', null]);
  });

  it('markAdminNotificationsRead / markAll mandan el cuerpo del contrato', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'ok', marked: 1, unread: 2 }, error: null });
    expect(await markAdminNotificationsRead(['n1'])).toEqual({ code: 'ok', marked: 1, unread: 2 });
    await markAllAdminNotificationsRead();
    expect(mockInvoke.mock.calls).toEqual([
      ['mark-notifications-read', { body: { notification_ids: ['n1'] } }],
      ['mark-notifications-read', { body: { all: true } }],
    ]);
  });
});
