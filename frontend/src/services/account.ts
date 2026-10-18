import { supabase } from '@/lib/supabase';

/**
 * Cambio OPCIONAL de contrasena de la cuenta con sesion iniciada (cualquier
 * rol). Usa Supabase Auth directamente: no recibe ids, solo actua sobre la
 * sesion actual. Antes de cambiarla verifica la contrasena actual
 * (signInWithPassword con el email de la sesion), para que un telefono
 * desbloqueado no baste para quedarse con la cuenta.
 *
 * Nunca lanza: devuelve un codigo para que la pantalla muestre el mensaje.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export type ChangePasswordResult =
  | { code: 'ok' }
  | {
      code:
        | 'not_authenticated'
        | 'invalid_password' // no cumple el minimo local (8 a 72 bytes)
        | 'same_password'
        | 'wrong_password' // la contrasena actual no coincide
        | 'weak_password' // la rechazo la politica de Supabase Auth
        | 'reauthentication_needed' // el proyecto exige reautenticacion por correo
        | 'unavailable';
      message: string;
    };

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function authCode(error: unknown): string {
  return (error as { code?: string } | null)?.code ?? '';
}

export async function changeMyPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const { currentPassword, newPassword } = input;

  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user?.email;
  const userId = sessionData.session?.user?.id;
  if (!email || !userId) {
    return { code: 'not_authenticated', message: 'Inicia sesión para cambiar tu contraseña.' };
  }

  if (
    typeof newPassword !== 'string' ||
    newPassword.trim().length === 0 ||
    [...newPassword].length < PASSWORD_MIN_LENGTH ||
    utf8Length(newPassword) > PASSWORD_MAX_BYTES
  ) {
    return {
      code: 'invalid_password',
      message: `La nueva contraseña debe tener entre ${PASSWORD_MIN_LENGTH} caracteres y ${PASSWORD_MAX_BYTES} bytes.`,
    };
  }
  if (newPassword === currentPassword) {
    return { code: 'same_password', message: 'La nueva contraseña debe ser distinta de la actual.' };
  }

  // Verifica la contrasena actual de ESTA cuenta.
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError || signIn.user?.id !== userId) {
    return authCode(signInError) === 'invalid_credentials' || !signInError
      ? { code: 'wrong_password', message: 'La contraseña actual no es correcta.' }
      : { code: 'unavailable', message: 'No se pudo verificar tu contraseña. Intenta de nuevo.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (!error) return { code: 'ok' };

  switch (authCode(error)) {
    case 'weak_password':
      return { code: 'weak_password', message: 'La contraseña no cumple la política de seguridad.' };
    case 'same_password':
      return { code: 'same_password', message: 'La nueva contraseña debe ser distinta de la actual.' };
    case 'reauthentication_needed':
      return { code: 'reauthentication_needed', message: 'Se requiere confirmar el cambio por correo.' };
    default:
      return { code: 'unavailable', message: 'No se pudo cambiar la contraseña. Intenta de nuevo.' };
  }
}
