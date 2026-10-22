/// <reference types="jest" />
import { FunctionsHttpError } from '@supabase/supabase-js';

import { EdgeFunctionError } from '@/lib/edgeFunctions';
import {
  adminRedeemRewards,
  createRedemptionRequestId,
  getRedemptionsByRequest,
  getVolunteerRedemptions,
  listRedemptionRequests,
  lookupCard,
  markRedemptionDelivered,
  markRedemptionItemDelivered,
  redeemRewards,
  redeemRewardsWithCard,
} from '../redemptions';

const mockInvoke = jest.fn();
type Call = [string, ...unknown[]];
const mockQueries: { table: string; calls: Call[] }[] = [];
const mockResults: unknown[] = [];

function mockBuilder(table: string) {
  const q = { table, calls: [] as Call[] };
  mockQueries.push(q);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'range', 'limit']) {
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

const CRID = 'd6000000-0000-4000-8000-000000000001';
const R1 = 'c6000000-0000-0000-0000-000000000100';
const R2 = 'c6000000-0000-0000-0000-000000000200';
const requestJson = {
  id: 'q1', client_request_id: CRID, status: 'pending_delivery', total_points: 300,
  created_at: '2026-10-18T20:00:00Z', delivered_at: null,
  items: [
    { reward_id: R1, name: 'Cien', points_spent: 100 },
    { reward_id: R2, name: 'Doscientos', points_spent: 200 },
  ],
};
const mappedRequest = {
  id: 'q1', clientRequestId: CRID, status: 'pending_delivery', totalPoints: 300,
  createdAt: '2026-10-18T20:00:00Z', deliveredAt: null,
  items: [
    { rewardId: R1, name: 'Cien', pointsSpent: 100 },
    { rewardId: R2, name: 'Doscientos', pointsSpent: 200 },
  ],
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockQueries.length = 0;
  mockResults.length = 0;
});

describe('createRedemptionRequestId', () => {
  it('genera UUID v4 distintos', () => {
    const a = createRedemptionRequestId();
    const b = createRedemptionRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('redeemRewards', () => {
  it('solo manda client_request_id y reward_ids; mapea ok con saldo', async () => {
    mockInvoke.mockResolvedValue({
      data: { code: 'ok', replayed: false, balance: 200, request: requestJson },
      error: null,
    });

    const res = await redeemRewards([R1, R2], CRID);

    expect(mockInvoke.mock.calls).toEqual([
      ['redeem-rewards', { body: { client_request_id: CRID, reward_ids: [R1, R2] } }],
    ]);
    expect(res).toEqual({ code: 'ok', replayed: false, balance: 200, request: mappedRequest });
  });

  it('reintento: replayed true', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'ok', replayed: true, balance: 200, request: requestJson }, error: null });
    const res = await redeemRewards([R1, R2], CRID);
    expect(res.code === 'ok' && res.replayed).toBe(true);
  });

  it('mapea insufficient_points, reward_unavailable y los demas codigos sin lanzar', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { code: 'insufficient_points', message: 'm', required: 600, available: 500 }, error: null,
    });
    expect(await redeemRewards([R1], CRID)).toEqual({ code: 'insufficient_points', message: 'm', required: 600, available: 500 });

    mockInvoke.mockResolvedValueOnce({
      data: { code: 'reward_unavailable', message: 'm', rewards: [{ reward_id: R2, reason: 'out_of_stock' }] }, error: null,
    });
    expect(await redeemRewards([R1, R2], CRID)).toEqual({
      code: 'reward_unavailable', message: 'm', rewards: [{ rewardId: R2, reason: 'out_of_stock' }],
    });

    for (const code of ['idempotency_conflict', 'volunteer_not_linked', 'volunteer_inactive']) {
      mockInvoke.mockResolvedValueOnce({ data: { code, message: 'x' }, error: null });
      expect(await redeemRewards([R1], CRID)).toEqual({ code, message: 'x' });
    }
  });

  it('un admin o guard recibe EdgeFunctionError forbidden', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ code: 'forbidden' }), { status: 403 })),
    });
    let err: unknown;
    try {
      await redeemRewards([R1], CRID);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EdgeFunctionError);
    expect((err as EdgeFunctionError).code).toBe('forbidden');
  });
});

describe('admin: solicitudes y entrega', () => {
  it('listRedemptionRequests filtra por estado, pagina y mapea voluntario y renglones', async () => {
    mockResults.push({
      data: [{
        ...requestJson,
        items: [
          { reward_id: R1, points_spent: 100, reward: { name: 'Cien' } },
          { reward_id: R2, points_spent: 200, reward: null },
        ],
        volunteer: { id: 'v1', full_name: 'Red A' },
      }],
      error: null,
      count: 1,
    });

    const page = await listRedemptionRequests({ status: 'pending_delivery', page: 1, pageSize: 10 });

    expect(mockQueries[0].table).toBe('redemption_requests');
    expect(mockQueries[0].calls).toContainEqual(['eq', 'status', 'pending_delivery']);
    expect(mockQueries[0].calls).toContainEqual(['range', 0, 9]);
    expect(page.items[0]).toEqual({
      ...mappedRequest,
      items: [mappedRequest.items[0], { rewardId: R2, name: null, pointsSpent: 200 }],
      volunteer: { id: 'v1', name: 'Red A' },
    });
    expect([page.total, page.hasMore]).toEqual([1, false]);
  });

  it('sin status no filtra', async () => {
    mockResults.push({ data: [], error: null, count: 0 });
    await listRedemptionRequests();
    expect(mockQueries[0].calls.some((c) => c[0] === 'eq')).toBe(false);
  });

  it('markRedemptionDelivered manda solo request_id y mapea already_delivered', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { code: 'ok', already_delivered: true, request: { ...requestJson, status: 'delivered', delivered_at: 'x' } },
      error: null,
    });
    const res = await markRedemptionDelivered('q1');
    expect(mockInvoke.mock.calls).toEqual([['mark-redemption-delivered', { body: { request_id: 'q1' } }]]);
    expect(res.code === 'ok' && [res.alreadyDelivered, res.request.status]).toEqual([true, 'delivered']);

    mockInvoke.mockResolvedValueOnce({ data: { code: 'request_not_found', message: 'no' }, error: null });
    expect(await markRedemptionDelivered('q2')).toEqual({ code: 'request_not_found', message: 'no' });
  });
});

const itemRow = {
  id: 'rr1', request_id: 'q1', reward_id: R1, points_spent: 100, redeemed_at: '2026-10-18T20:00:00Z',
  status: 'pending_delivery', delivered_at: null, reward: { name: 'Cien' },
};
const mappedItem = {
  id: 'rr1', requestId: 'q1', rewardId: R1, name: 'Cien', pointsSpent: 100, redeemedAt: '2026-10-18T20:00:00Z',
  status: 'pending_delivery', deliveredAt: null,
};

describe('admin: canje para un voluntario y con tarjeta (010)', () => {
  it('adminRedeemRewards manda volunteer_id, client_request_id y reward_ids; mapea igual que redeemRewards', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { code: 'ok', replayed: false, balance: 200, request: requestJson }, error: null });
    expect(await adminRedeemRewards('v1', [R1, R2], CRID)).toEqual({
      code: 'ok', replayed: false, balance: 200, request: mappedRequest,
    });
    expect(mockInvoke.mock.calls).toEqual([
      ['admin-redeem-rewards', { body: { volunteer_id: 'v1', client_request_id: CRID, reward_ids: [R1, R2] } }],
    ]);

    mockInvoke.mockResolvedValueOnce({ data: { code: 'volunteer_not_found', message: 'x' }, error: null });
    expect(await adminRedeemRewards('v2', [R1], CRID)).toEqual({ code: 'volunteer_not_found', message: 'x' });
  });

  it('redeemRewardsWithCard manda el uid y nunca un volunteer_id', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { code: 'card_inactive', message: 'Tarjeta revoked' }, error: null });
    expect(await redeemRewardsWithCard('04A1B2C3', [R1], CRID)).toEqual({ code: 'card_inactive', message: 'Tarjeta revoked' });
    expect(mockInvoke.mock.calls).toEqual([
      ['redeem-rewards-card', { body: { uid: '04A1B2C3', client_request_id: CRID, reward_ids: [R1] } }],
    ]);
  });

  it('lookupCard mapea el dueno de la tarjeta y los rechazos', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { code: 'ok', volunteer: { id: 'v1', full_name: 'Ana', community: 'Centro', points: 120, avatar_url: null } },
      error: null,
    });
    expect(await lookupCard('04A1B2C3')).toEqual({
      code: 'ok', volunteer: { id: 'v1', name: 'Ana', community: 'Centro', points: 120, avatar: undefined },
    });
    expect(mockInvoke.mock.calls[0]).toEqual(['lookup-card', { body: { uid: '04A1B2C3' } }]);

    mockInvoke.mockResolvedValueOnce({
      data: { code: 'volunteer_inactive', message: 'm', volunteer: { id: 'v2', full_name: 'Beto' } }, error: null,
    });
    expect(await lookupCard('04A1B2C3')).toEqual({ code: 'volunteer_inactive', message: 'm', volunteer: { id: 'v2', name: 'Beto' } });

    mockInvoke.mockResolvedValueOnce({ data: { code: 'card_unknown', message: 'n' }, error: null });
    expect(await lookupCard('04A1B2C3')).toEqual({ code: 'card_unknown', message: 'n' });
  });
});

describe('admin: canjes por renglon (010)', () => {
  it('getVolunteerRedemptions filtra por voluntario y mapea cada canje con su estado', async () => {
    mockResults.push({ data: [itemRow], error: null });
    expect(await getVolunteerRedemptions('v1')).toEqual([mappedItem]);
    expect(mockQueries[0].table).toBe('reward_redemptions');
    expect(mockQueries[0].calls).toContainEqual(['eq', 'volunteer_id', 'v1']);
  });

  it('getRedemptionsByRequest agrupa por request_id y no consulta con lista vacia', async () => {
    expect(await getRedemptionsByRequest([])).toEqual({});
    expect(mockQueries).toHaveLength(0);

    mockResults.push({ data: [itemRow, { ...itemRow, id: 'rr2', reward_id: R2 }], error: null });
    const grouped = await getRedemptionsByRequest(['q1']);
    expect(Object.keys(grouped)).toEqual(['q1']);
    expect(grouped.q1.map((r) => r.id)).toEqual(['rr1', 'rr2']);
    expect(mockQueries[0].calls).toContainEqual(['in', 'request_id', ['q1']]);
  });

  it('markRedemptionItemDelivered manda solo redemption_id y mapea el canje y el estado de la solicitud', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        code: 'ok', already_delivered: false, request_status: 'pending_delivery',
        redemption: { ...itemRow, reward: undefined, name: 'Cien', status: 'delivered', delivered_at: 'x' },
      },
      error: null,
    });
    expect(await markRedemptionItemDelivered('rr1')).toEqual({
      code: 'ok', alreadyDelivered: false, requestStatus: 'pending_delivery',
      redemption: { ...mappedItem, status: 'delivered', deliveredAt: 'x' },
    });
    expect(mockInvoke.mock.calls).toEqual([['mark-redemption-item-delivered', { body: { redemption_id: 'rr1' } }]]);

    mockInvoke.mockResolvedValueOnce({ data: { code: 'redemption_not_found', message: 'no' }, error: null });
    expect(await markRedemptionItemDelivered('rr9')).toEqual({ code: 'redemption_not_found', message: 'no' });
  });
});
