/// <reference types="jest" />
import {
  getMyCheckIns,
  getMyRedemptions,
  getMyVolunteerProfile,
  VolunteerAccountError,
} from '../myVolunteer';

// Builder de consultas simulado: registra cada llamada encadenada y resuelve
// con el siguiente resultado de la cola (al hacer await o maybeSingle()).
type Call = [string, ...unknown[]];
const mockQueries: { table: string; calls: Call[] }[] = [];
const mockResults: unknown[] = [];
const mockGetSession = jest.fn();

function mockBuilder(table: string) {
  const q = { table, calls: [] as Call[] };
  mockQueries.push(q);
  const next = () => Promise.resolve(mockResults.shift());
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'range']) {
    b[m] = (...args: unknown[]) => {
      q.calls.push([m, ...args]);
      return b;
    };
  }
  b.maybeSingle = () => {
    q.calls.push(['maybeSingle']);
    return next();
  };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej);
  return b;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...a: unknown[]) => mockGetSession(...a) },
    from: (table: string) => mockBuilder(table),
  },
}));

const USER = 'f1000000-0000-0000-0000-00000000000a';
const VOL = 'f2000000-0000-0000-0000-00000000000a';
const session = { data: { session: { user: { id: USER } } }, error: null };

async function errorOf(p: Promise<unknown>): Promise<VolunteerAccountError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(VolunteerAccountError);
    return e as VolunteerAccountError;
  }
  throw new Error('se esperaba un VolunteerAccountError');
}

beforeEach(() => {
  mockQueries.length = 0;
  mockResults.length = 0;
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(session);
});

describe('getMyVolunteerProfile', () => {
  it('busca por user_id de la sesion y mapea perfil y puntos', async () => {
    mockResults.push({
      data: {
        id: VOL, full_name: 'Vol A', community: 'Centro', avatar_url: null, points: 30,
        total_visits: 3, last_check_in_at: null, is_active: true,
      },
      error: null,
    });

    const p = await getMyVolunteerProfile();

    expect(mockQueries).toHaveLength(1);
    expect(mockQueries[0].table).toBe('volunteers');
    expect(mockQueries[0].calls).toContainEqual(['eq', 'user_id', USER]);
    expect(p).toEqual({
      id: VOL, name: 'Vol A', community: 'Centro', points: 30, lastVisit: 'Sin visitas',
      avatar: undefined, isActive: true, totalVisits: 3, lastCheckInAt: null,
    });
  });

  it('sin vinculo -> not_linked', async () => {
    mockResults.push({ data: null, error: null });
    const e = await errorOf(getMyVolunteerProfile());
    expect(e.code).toBe('not_linked');
  });

  it('sin sesion -> not_authenticated, sin consultar la base', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const e = await errorOf(getMyVolunteerProfile());
    expect(e.code).toBe('not_authenticated');
    expect(mockQueries).toHaveLength(0);
  });

  it('error de la base -> Error con mensaje (no VolunteerAccountError)', async () => {
    mockResults.push({ data: null, error: { message: 'boom' } });
    let err: unknown;
    try {
      await getMyVolunteerProfile();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(VolunteerAccountError);
    expect((err as Error).message).toContain('boom');
  });
});

describe('getMyCheckIns', () => {
  it('filtra por el volunteer_id derivado de la sesion y pagina con range', async () => {
    mockResults.push({ data: { id: VOL }, error: null });
    mockResults.push({
      data: [{ id: 'c1', checked_in_at: '2026-10-17T16:00:00Z', points_awarded: 10, visit_number: 3, status: 'valid' }],
      error: null,
      count: 21,
    });

    const page = await getMyCheckIns({ page: 2, pageSize: 10 });

    expect(mockQueries.map((q) => q.table)).toEqual(['volunteers', 'check_ins']);
    expect(mockQueries[0].calls).toContainEqual(['eq', 'user_id', USER]);
    expect(mockQueries[1].calls).toContainEqual(['eq', 'volunteer_id', VOL]);
    expect(mockQueries[1].calls).toContainEqual(['range', 10, 19]);
    expect(mockQueries[1].calls).toContainEqual(['order', 'checked_in_at', { ascending: false }]);
    expect(page).toEqual({
      items: [{ id: 'c1', checkedInAt: '2026-10-17T16:00:00Z', pointsAwarded: 10, visitNumber: 3, status: 'valid' }],
      page: 2, pageSize: 10, total: 21, hasMore: true,
    });
  });

  it('acota pageSize a 50 y page a 1 como minimo', async () => {
    mockResults.push({ data: { id: VOL }, error: null }, { data: [], error: null, count: 0 });
    const page = await getMyCheckIns({ page: -3, pageSize: 1000 });
    expect(mockQueries[1].calls).toContainEqual(['range', 0, 49]);
    expect([page.page, page.pageSize, page.hasMore]).toEqual([1, 50, false]);
  });

  it('sin vinculo -> not_linked y no consulta check_ins', async () => {
    mockResults.push({ data: null, error: null });
    const e = await errorOf(getMyCheckIns());
    expect(e.code).toBe('not_linked');
    expect(mockQueries.map((q) => q.table)).toEqual(['volunteers']);
  });
});

describe('getMyRedemptions', () => {
  it('trae el nombre de la recompensa y pagina', async () => {
    mockResults.push({ data: { id: VOL }, error: null });
    mockResults.push({
      data: [
        { id: 'r1', redeemed_at: '2026-10-10T00:00:00Z', points_spent: 500, reward: { id: 'w1', name: 'Playera' } },
        { id: 'r2', redeemed_at: '2026-10-01T00:00:00Z', points_spent: 100, reward: null },
      ],
      error: null,
      count: 2,
    });

    const page = await getMyRedemptions();

    expect(mockQueries[1].table).toBe('reward_redemptions');
    expect(mockQueries[1].calls).toContainEqual(['eq', 'volunteer_id', VOL]);
    expect(mockQueries[1].calls).toContainEqual(['range', 0, 19]);
    expect(page.items).toEqual([
      { id: 'r1', redeemedAt: '2026-10-10T00:00:00Z', pointsSpent: 500, reward: { id: 'w1', name: 'Playera' } },
      { id: 'r2', redeemedAt: '2026-10-01T00:00:00Z', pointsSpent: 100, reward: null },
    ]);
    expect([page.total, page.hasMore]).toEqual([2, false]);
  });

  it('sin sesion -> not_authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await errorOf(getMyRedemptions())).code).toBe('not_authenticated');
  });
});
