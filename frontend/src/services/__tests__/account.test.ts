/// <reference types="jest" />
import { changeMyPassword } from '../account';

const mockGetSession = jest.fn();
const mockSignIn = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
    },
  },
}));

const USER = { id: 'u1', email: 'vol@test.local' };
const OLD = 'Inicial#2026';
const NEW = 'Nueva-Clave#2026';

beforeEach(() => {
  mockGetSession.mockReset();
  mockSignIn.mockReset();
  mockUpdateUser.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
  mockSignIn.mockResolvedValue({ data: { user: USER, session: {} }, error: null });
  mockUpdateUser.mockResolvedValue({ data: { user: USER }, error: null });
});

describe('changeMyPassword', () => {
  it('verifica la contrasena actual con el email de la sesion y cambia la de la sesion', async () => {
    expect(await changeMyPassword({ currentPassword: OLD, newPassword: NEW })).toEqual({ code: 'ok' });
    expect(mockSignIn.mock.calls).toEqual([[{ email: 'vol@test.local', password: OLD }]]);
    // updateUser solo recibe la contrasena: no hay forma de elegir otro usuario
    expect(mockUpdateUser.mock.calls).toEqual([[{ password: NEW }]]);
  });

  it('sin sesion -> not_authenticated sin llamar a Auth', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await changeMyPassword({ currentPassword: OLD, newPassword: NEW })).code).toBe('not_authenticated');
    expect(mockSignIn.mock.calls.length + mockUpdateUser.mock.calls.length).toBe(0);
  });

  it('valida localmente: corta, solo espacios, >72 bytes, igual a la actual', async () => {
    for (const newPassword of ['corta', '         ', 'ñ'.repeat(37)]) {
      expect((await changeMyPassword({ currentPassword: OLD, newPassword })).code).toBe('invalid_password');
    }
    expect((await changeMyPassword({ currentPassword: OLD, newPassword: OLD })).code).toBe('same_password');
    expect(mockSignIn.mock.calls.length + mockUpdateUser.mock.calls.length).toBe(0);
  });

  it('contrasena actual incorrecta -> wrong_password y no cambia nada', async () => {
    mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'invalid_credentials' } });
    expect((await changeMyPassword({ currentPassword: 'mala', newPassword: NEW })).code).toBe('wrong_password');
    expect(mockUpdateUser.mock.calls.length).toBe(0);
  });

  it('traduce los errores de Supabase Auth sin incluir la contrasena en el mensaje', async () => {
    const cases: [string, string][] = [
      ['weak_password', 'weak_password'],
      ['same_password', 'same_password'],
      ['reauthentication_needed', 'reauthentication_needed'],
      ['unexpected_failure', 'unavailable'],
    ];
    for (const [authCode, expected] of cases) {
      mockUpdateUser.mockResolvedValueOnce({ data: { user: null }, error: { code: authCode } });
      const r = await changeMyPassword({ currentPassword: OLD, newPassword: NEW });
      expect(r.code).toBe(expected);
      expect(JSON.stringify(r)).not.toContain(NEW);
    }
  });

  it('fallo de red al verificar -> unavailable', async () => {
    mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'request_timeout' } });
    expect((await changeMyPassword({ currentPassword: OLD, newPassword: NEW })).code).toBe('unavailable');
  });
});
