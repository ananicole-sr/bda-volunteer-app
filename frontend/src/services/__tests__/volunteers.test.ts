/// <reference types="jest" />
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { EdgeFunctionError } from '@/lib/edgeFunctions';
import {
  createRegistrationRequestId,
  deactivateVolunteer,
  linkVolunteerAccount,
  registerVolunteerAccount,
  updateVolunteer,
} from '../volunteers';

const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

const ID = '0a1b2c3d-1111-2222-3333-444455556666';

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

async function errorOf(p: Promise<unknown>): Promise<EdgeFunctionError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(EdgeFunctionError);
    return e as EdgeFunctionError;
  }
  throw new Error('se esperaba un EdgeFunctionError');
}

beforeEach(() => mockInvoke.mockReset());

describe('updateVolunteer', () => {
  it('manda solo los campos dados, con los nombres del contrato', async () => {
    mockInvoke.mockResolvedValue({ data: { code: 'ok' }, error: null });

    await updateVolunteer(ID, { community: 'Centro' });
    await updateVolunteer(ID, { fullName: 'Ana', community: 'Zapopan' });

    expect(mockInvoke.mock.calls).toEqual([
      ['update-volunteer', { body: { volunteer_id: ID, community: 'Centro' } }],
      ['update-volunteer', { body: { volunteer_id: ID, full_name: 'Ana', community: 'Zapopan' } }],
    ]);
  });

  it('devuelve tal cual los codigos de negocio (no lanza)', async () => {
    const ok = {
      code: 'ok',
      changed_fields: ['full_name'],
      volunteer: { id: ID, full_name: 'Ana', community: 'Centro', is_active: true },
    };
    mockInvoke.mockResolvedValueOnce({ data: ok, error: null });
    expect(await updateVolunteer(ID, { fullName: 'Ana' })).toEqual(ok);

    mockInvoke.mockResolvedValueOnce({ data: { code: 'volunteer_not_found' }, error: null });
    expect((await updateVolunteer(ID, { fullName: 'Ana' })).code).toBe('volunteer_not_found');
  });
});

describe('deactivateVolunteer', () => {
  it('llama deactivate-volunteer solo con volunteer_id', async () => {
    const ok = { code: 'ok', already_inactive: false, volunteer: { id: ID, full_name: 'Ana', is_active: false } };
    mockInvoke.mockResolvedValue({ data: ok, error: null });

    expect(await deactivateVolunteer(ID)).toEqual(ok);
    expect(mockInvoke.mock.calls).toEqual([['deactivate-volunteer', { body: { volunteer_id: ID } }]]);
  });
});

describe('errores de transporte', () => {
  it('traduce 400/401/403/500 a EdgeFunctionError con code y status', async () => {
    const cases: [number, unknown, string][] = [
      [400, { code: 'invalid_request', message: 'se requiere full_name o community' }, 'invalid_request'],
      [401, { code: 'unauthorized' }, 'unauthorized'],
      [403, { code: 'forbidden' }, 'forbidden'],
      [500, { code: 'server_error' }, 'server_error'],
    ];
    for (const [status, body, code] of cases) {
      mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(status, body) });
      const e = await errorOf(deactivateVolunteer(ID));
      expect([e.code, e.status]).toEqual([code, status]);
    }
  });

  it('conserva el message de invalid_request', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(400, { code: 'invalid_request', message: 'full_name excede 120 caracteres' }),
    });
    expect((await errorOf(updateVolunteer(ID, { fullName: 'x' }))).message).toBe('full_name excede 120 caracteres');
  });

  it('cuerpo no JSON o code desconocido -> server_error', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response('Bad Gateway', { status: 502 })),
    });
    expect((await errorOf(deactivateVolunteer(ID))).code).toBe('server_error');

    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(418, { code: 'teapot' }) });
    expect((await errorOf(deactivateVolunteer(ID))).code).toBe('server_error');
  });

  it('fallo de red -> network_error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsFetchError(new Error('offline')) });
    expect((await errorOf(deactivateVolunteer(ID))).code).toBe('network_error');
  });

  it('respuesta 200 sin code -> server_error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { sin: 'code' }, error: null });
    expect((await errorOf(deactivateVolunteer(ID))).code).toBe('server_error');
  });
});

describe('linkVolunteerAccount', () => {
  const USER = 'f1000000-0000-0000-0000-00000000000a';

  it('manda volunteer_id y user_id y devuelve el resultado de negocio', async () => {
    const ok = { code: 'ok', already_linked: false, volunteer: { id: ID, full_name: 'Ana', user_id: USER } };
    mockInvoke.mockResolvedValueOnce({ data: ok, error: null });
    expect(await linkVolunteerAccount(ID, USER)).toEqual(ok);
    expect(mockInvoke.mock.calls).toEqual([
      ['link-volunteer-account', { body: { volunteer_id: ID, user_id: USER } }],
    ]);
  });

  it('los conflictos llegan como codigo, no como excepcion', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { code: 'account_in_use', message: 'x' }, error: null });
    expect((await linkVolunteerAccount(ID, USER)).code).toBe('account_in_use');
  });

  it('un no-admin recibe EdgeFunctionError forbidden', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(403, { code: 'forbidden' }) });
    expect((await errorOf(linkVolunteerAccount(ID, USER))).code).toBe('forbidden');
  });
});

describe('registerVolunteerAccount', () => {
  const input = {
    clientRequestId: 'e7000000-0000-4000-8000-000000000001',
    fullName: 'Ana Pérez',
    community: 'Centro',
    uid: '04A1B2C3',
    email: 'ana@test.local',
    password: 'Inicial#2026',
  };

  it('manda los campos del contrato (sin rol) y devuelve el resultado de negocio', async () => {
    const ok = {
      code: 'ok', replayed: false, registration_id: 'r1',
      volunteer: { id: ID, full_name: 'Ana Pérez', community: 'Centro', user_id: 'u1' },
      account: { user_id: 'u1', email: 'ana@test.local' }, card_id: 'c1',
    };
    mockInvoke.mockResolvedValueOnce({ data: ok, error: null });
    expect(await registerVolunteerAccount(input)).toEqual(ok);
    expect(mockInvoke.mock.calls).toEqual([[
      'register-volunteer-account',
      { body: {
        client_request_id: input.clientRequestId, full_name: 'Ana Pérez', community: 'Centro',
        uid: '04A1B2C3', email: 'ana@test.local', password: 'Inicial#2026',
      } },
    ]]);
    expect(JSON.stringify(mockInvoke.mock.calls)).not.toContain('role');
  });

  it('conflictos como codigo (email_in_use, card_in_use con account_cleanup)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { code: 'email_in_use', message: 'm' }, error: null });
    expect((await registerVolunteerAccount(input)).code).toBe('email_in_use');
    mockInvoke.mockResolvedValueOnce({ data: { code: 'card_in_use', account_cleanup: 'done' }, error: null });
    expect(await registerVolunteerAccount(input)).toEqual({ code: 'card_in_use', account_cleanup: 'done' });
  });

  it('un no-admin recibe EdgeFunctionError forbidden; un 500 es reintentable', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(403, { code: 'forbidden' }) });
    expect((await errorOf(registerVolunteerAccount(input))).code).toBe('forbidden');
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(500, { code: 'server_error' }) });
    expect((await errorOf(registerVolunteerAccount(input))).code).toBe('server_error');
  });

  it('createRegistrationRequestId genera UUID v4', () => {
    expect(createRegistrationRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
