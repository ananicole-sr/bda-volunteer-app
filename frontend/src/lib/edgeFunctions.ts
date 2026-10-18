import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Errores de transporte del contrato (docs/nfc-contract.md, seccion "HTTP"),
 * mas 'network_error' cuando la peticion ni siquiera llega a la funcion.
 * Los codigos de negocio (ok, volunteer_not_found, ...) llegan con HTTP 200 y
 * NO lanzan: se devuelven tal cual para que la pantalla decida que mostrar.
 */
export type EdgeFunctionErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'server_error'
  | 'network_error';

export class EdgeFunctionError extends Error {
  readonly code: EdgeFunctionErrorCode;
  readonly status?: number;

  constructor(code: EdgeFunctionErrorCode, message?: string, status?: number) {
    super(message ?? code);
    this.name = 'EdgeFunctionError';
    this.code = code;
    this.status = status;
    // Igual que NfcError: sin esto, instanceof falla en el bundle de Hermes.
    Object.setPrototypeOf(this, EdgeFunctionError.prototype);
  }
}

const TRANSPORT_CODES: readonly string[] = ['invalid_request', 'unauthorized', 'forbidden', 'server_error'];

/**
 * POST a una Edge Function con el JWT de la sesion actual (lo agrega
 * supabase-js). Devuelve el cuerpo de negocio o lanza EdgeFunctionError.
 */
export async function callEdgeFunction<T extends { code: string }>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      let payload: { code?: unknown; message?: unknown } = {};
      try {
        payload = await response.json();
      } catch {
        // cuerpo no JSON (p.ej. un 502 del gateway): se queda como server_error
      }
      const code =
        typeof payload.code === 'string' && TRANSPORT_CODES.includes(payload.code)
          ? (payload.code as EdgeFunctionErrorCode)
          : 'server_error';
      const message = typeof payload.message === 'string' ? payload.message : undefined;
      throw new EdgeFunctionError(code, message, response.status);
    }
    throw new EdgeFunctionError('network_error', error.message);
  }

  if (!data || typeof data !== 'object' || typeof (data as { code?: unknown }).code !== 'string') {
    throw new EdgeFunctionError('server_error', 'Respuesta inesperada de la Edge Function');
  }

  return data as T;
}
