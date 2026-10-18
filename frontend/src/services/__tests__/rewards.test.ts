/// <reference types="jest" />
import { FunctionsHttpError } from '@supabase/supabase-js';

import { EdgeFunctionError } from '@/lib/edgeFunctions';
import { createReward, deactivateReward, updateReward } from '../rewards';

const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

const ID = '5d3e2a10-aaaa-4bbb-8ccc-0123456789ab';
const row = {
  id: ID,
  name: 'Playera BAMX',
  description: null,
  points_cost: 500,
  stock: 40,
  is_active: true,
  created_at: '2026-10-18T18:00:00+00:00',
};
const mapped = {
  id: ID,
  name: 'Playera BAMX',
  description: '',
  points: 500,
  stock: 40,
  isActive: true,
  createdAt: '2026-10-18T18:00:00+00:00',
};

beforeEach(() => mockInvoke.mockReset());

describe('createReward', () => {
  it('manda los nombres de columna del contrato y mapea la respuesta', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'ok', reward: row }, error: null });

    const res = await createReward({ name: 'Playera BAMX', points: 500, stock: 40 });

    expect(mockInvoke.mock.calls).toEqual([
      ['create-reward', { body: { name: 'Playera BAMX', points_cost: 500, stock: 40 } }],
    ]);
    expect(res).toEqual({ code: 'ok', reward: mapped });
  });

  it('incluye description cuando se da (tambien null)', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'ok', reward: row }, error: null });
    await createReward({ name: 'A', description: 'Talla M', points: 0, stock: 0 });
    await createReward({ name: 'A', description: null, points: 0, stock: 0 });
    expect(mockInvoke.mock.calls[0][1].body.description).toBe('Talla M');
    expect(mockInvoke.mock.calls[1][1].body.description).toBeNull();
  });
});

describe('updateReward', () => {
  it('manda solo los campos dados y traduce changed_fields', async () => {
    mockInvoke.mockResolvedValue({
      data: { code: 'ok', changed_fields: ['points_cost', 'description'], reward: { ...row, points_cost: 600 } },
      error: null,
    });

    const res = await updateReward(ID, { points: 600, description: null });

    expect(mockInvoke.mock.calls).toEqual([
      ['update-reward', { body: { reward_id: ID, description: null, points_cost: 600 } }],
    ]);
    expect(res).toEqual({ code: 'ok', changedFields: ['points', 'description'], reward: { ...mapped, points: 600 } });
  });

  it('devuelve reward_not_found sin lanzar', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'reward_not_found', message: 'La recompensa no existe' }, error: null });
    expect(await updateReward(ID, { stock: 1 })).toEqual({ code: 'reward_not_found', message: 'La recompensa no existe' });
  });
});

describe('deactivateReward', () => {
  it('llama deactivate-reward solo con reward_id y mapea already_inactive', async () => {
    mockInvoke.mockResolvedValue({
      data: { code: 'ok', already_inactive: true, reward: { ...row, is_active: false } },
      error: null,
    });

    const res = await deactivateReward(ID);

    expect(mockInvoke.mock.calls).toEqual([['deactivate-reward', { body: { reward_id: ID } }]]);
    expect(res).toEqual({ code: 'ok', alreadyInactive: true, reward: { ...mapped, isActive: false } });
  });

  it('devuelve reward_not_found sin lanzar', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'reward_not_found' }, error: null });
    expect((await deactivateReward(ID)).code).toBe('reward_not_found');
  });
});

describe('errores de transporte', () => {
  it('403 de un no-admin y 400 de validacion llegan como EdgeFunctionError', async () => {
    const cases: [() => Promise<unknown>, number, unknown, string][] = [
      [() => createReward({ name: 'A', points: 1, stock: 1 }), 403, { code: 'forbidden' }, 'forbidden'],
      [() => updateReward(ID, { stock: -1 }), 400, { code: 'invalid_request', message: 'stock debe ser un entero entre 0 y 2147483647' }, 'invalid_request'],
      [() => deactivateReward(ID), 401, { code: 'unauthorized' }, 'unauthorized'],
    ];
    for (const [call, status, body, code] of cases) {
      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })),
      });
      let err: unknown;
      try {
        await call();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(EdgeFunctionError);
      expect([(err as EdgeFunctionError).code, (err as EdgeFunctionError).status]).toEqual([code, status]);
    }
  });
});
