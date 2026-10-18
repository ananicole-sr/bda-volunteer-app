// Flujo comun de las Edge Functions: JWT -> rol -> cuerpo -> HMAC (solo si el
// cuerpo trae uid) -> RPC.
// Todo lo externo (Auth, tabla profiles, RPC, secreto) entra por `Deps`, de
// modo que las pruebas lo reemplazan por un cliente simulado.

import { uidHmac } from "./hmac.ts";
import { forbidden, invalidRequest, ok, serverError, unauthorized } from "./http.ts";
import type { Parsed } from "./validate.ts";

export interface RpcResult {
  data: unknown;
  error: { code?: string } | null;
}

export interface Deps {
  /** Valida el access_token con Supabase Auth (auth.getUser). null si no es valido. */
  verifyToken(token: string): Promise<{ id: string } | null>;
  /** profiles.role del usuario, leido con service_role. null si no tiene fila. */
  getRole(userId: string): Promise<string | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** CARD_UID_HMAC_SECRET */
  hmacSecret: string | undefined;
}

/** HMAC del UID para cuerpos con tarjeta; null para los que no traen uid. */
export type UidHmacFor<T> = T extends { uid: string } ? string : null;

export interface FunctionSpec<T extends object> {
  name: string;
  roles: readonly string[];
  parse(body: unknown): Parsed<T>;
  /** Funcion SQL y argumentos (operator_id sale del JWT, nunca del body). */
  toRpc(body: T, uidHmac: UidHmacFor<T>, operatorId: string): { fn: string; args: Record<string, unknown> };
}

function hasUid(body: object): body is { uid: string } {
  return typeof (body as { uid?: unknown }).uid === "string";
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

export function createHandler<T extends object>(spec: FunctionSpec<T>, deps: Deps) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== "POST") return invalidRequest("se espera POST");

      // 1) Sesion valida
      const token = bearer(req);
      if (!token) return unauthorized();
      const user = await deps.verifyToken(token);
      if (!user) return unauthorized();

      // 2) Rol (sin fila en profiles => 403)
      const role = await deps.getRole(user.id);
      if (!role || !spec.roles.includes(role)) return forbidden();

      // 3) Cuerpo
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return invalidRequest("el cuerpo debe ser JSON valido");
      }
      const parsed = spec.parse(raw);
      if (!parsed.ok) return invalidRequest(parsed.message);

      // 4) HMAC (solo si hay tarjeta de por medio) + RPC
      let hmac: string | null = null;
      if (hasUid(parsed.value)) {
        if (!deps.hmacSecret) {
          console.error(`[${spec.name}] CARD_UID_HMAC_SECRET no configurado`);
          return serverError();
        }
        hmac = await uidHmac(parsed.value.uid, deps.hmacSecret);
      }
      const { fn, args } = spec.toRpc(parsed.value, hmac as UidHmacFor<T>, user.id);
      const { data, error } = await deps.rpc(fn, args);
      if (error) {
        console.error(`[${spec.name}] rpc ${fn} fallo (code=${error.code ?? "?"})`);
        return serverError();
      }
      if (
        data === null || typeof data !== "object" ||
        typeof (data as { code?: unknown }).code !== "string"
      ) {
        console.error(`[${spec.name}] rpc ${fn} devolvio una forma inesperada`);
        return serverError();
      }
      return ok(data);
    } catch (e) {
      // Sin detalles al cliente; en el log solo el tipo de error.
      console.error(`[${spec.name}] error inesperado (${e instanceof Error ? e.name : typeof e})`);
      return serverError();
    }
  };
}
