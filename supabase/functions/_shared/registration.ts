// Alta de voluntario + cuenta de acceso (Edge Function register-volunteer-account).
//
// Supabase Auth y Postgres no comparten transaccion. El flujo (ver
// supabase/007_volunteer_registration.sql) es:
//   begin (SQL)  ->  crear cuenta en Auth  ->  complete (SQL, una transaccion)
// y cada paso tolera reintentos con el mismo client_request_id:
//   - Si la Edge Function se cae despues de crear la cuenta, el reintento la
//     reconoce por app_metadata.bamx_registration_id y continua.
//   - Si complete detecta un conflicto (tarjeta tomada en carrera), se borra
//     la cuenta recien creada (compensacion). Si el borrado falla, se responde
//     account_cleanup: "pending" y el siguiente reintento lo vuelve a intentar.
//   - Una cuenta ajena (email ya registrado) nunca se toca.
// La contrasena solo viaja a Supabase Auth: no se guarda, no va a la RPC y
// no aparece en ningun log.

import { authorize, type Deps, readJson } from "./handler.ts";
import { uidHmac } from "./hmac.ts";
import { invalidRequest, ok, serverError } from "./http.ts";
import { parseRegisterVolunteerAccount, type RegisterVolunteerAccountBody } from "./validate.ts";

export type AuthAdminErrorCode = "email_exists" | "weak_password" | "invalid_email" | "unavailable";

/** Subconjunto de auth.admin que usa el alta (las pruebas lo simulan). */
export interface AuthAdmin {
  /** Crea la cuenta con el email ya confirmado. */
  createUser(
    email: string,
    password: string,
    appMetadata: Record<string, string>,
  ): Promise<{ id: string } | { error: AuthAdminErrorCode }>;
  /** Solo se usa con cuentas creadas por ESTA misma solicitud y aun sin completar. */
  updatePassword(userId: string, password: string): Promise<{ error: AuthAdminErrorCode } | null>;
  /** true si la cuenta ya no existe al terminar. */
  deleteUser(userId: string): Promise<boolean>;
}

export interface RegistrationDeps extends Deps {
  authAdmin: AuthAdmin;
}

export const REGISTRATION_ROLES = ["admin"] as const;
const NAME = "register-volunteer-account";

type Json = Record<string, unknown> & { code?: unknown };

/** Quita los campos internos de la respuesta SQL antes de mandarla al cliente. */
function publicBody(data: Json, cleanup?: "done" | "pending"): Json {
  const { cleanup_auth_user_id: _c, own_auth_user_id: _o, ...rest } = data;
  return cleanup ? { ...rest, account_cleanup: cleanup } : rest;
}

function isJson(data: unknown): data is Json {
  return data !== null && typeof data === "object" && typeof (data as Json).code === "string";
}

export function createRegistrationHandler(deps: RegistrationDeps) {
  async function rpc(fn: string, args: Record<string, unknown>): Promise<Json | null> {
    const { data, error } = await deps.rpc(fn, args);
    if (error || !isJson(data)) {
      console.error(`[${NAME}] rpc ${fn} fallo (code=${error?.code ?? "forma inesperada"})`);
      return null;
    }
    return data;
  }

  /** Compensacion: borra una cuenta que creo esta solicitud y quedo sin usar. */
  async function cleanup(data: Json): Promise<Response> {
    const id = data.cleanup_auth_user_id;
    if (typeof id !== "string") return ok(publicBody(data));
    const deleted = await deps.authAdmin.deleteUser(id).catch(() => false);
    if (!deleted) console.error(`[${NAME}] no se pudo borrar la cuenta de compensacion`);
    return ok(publicBody(data, deleted ? "done" : "pending"));
  }

  return async (req: Request): Promise<Response> => {
    try {
      const auth = await authorize(req, deps, REGISTRATION_ROLES);
      if ("response" in auth) return auth.response;
      const operatorId = auth.user.id;

      const raw = await readJson(req);
      if (!raw) return invalidRequest("el cuerpo debe ser JSON valido");
      const parsed = parseRegisterVolunteerAccount(raw.value);
      if (!parsed.ok) return invalidRequest(parsed.message);
      const body: RegisterVolunteerAccountBody = parsed.value;

      if (!deps.hmacSecret) {
        console.error(`[${NAME}] CARD_UID_HMAC_SECRET no configurado`);
        return serverError();
      }
      const beginArgs = {
        p_client_request_id: body.client_request_id,
        p_email: body.email,
        p_uid_hmac: await uidHmac(body.uid, deps.hmacSecret),
        p_full_name: body.full_name,
        p_community: body.community,
        p_operator_id: operatorId,
      };

      // 1) begin
      let begun = await rpc("begin_volunteer_registration", beginArgs);
      if (!begun) return serverError();
      if (begun.code !== "pending") return await cleanup(begun); // ok (replay) o conflicto

      const registrationId = begun.registration_id as string;
      let authUserId = typeof begun.own_auth_user_id === "string" ? begun.own_auth_user_id : null;

      // 2) Cuenta de Auth
      if (!authUserId) {
        const created = await deps.authAdmin.createUser(body.email, body.password, {
          bamx_registration_id: registrationId,
        });
        if ("id" in created) {
          authUserId = created.id;
        } else if (created.error === "email_exists") {
          // Puede ser nuestra (reintento concurrente) o ajena: begin lo decide.
          begun = await rpc("begin_volunteer_registration", beginArgs);
          if (!begun) return serverError();
          if (begun.code !== "pending" || typeof begun.own_auth_user_id !== "string") {
            return await cleanup(begun.code === "pending"
              ? { code: "email_in_use", message: "Ese email ya pertenece a una cuenta", registration_id: registrationId }
              : begun);
          }
          authUserId = begun.own_auth_user_id;
        } else if (created.error === "weak_password" || created.error === "invalid_email") {
          const failed = await rpc("fail_volunteer_registration", {
            p_registration_id: registrationId,
            p_reason: created.error,
            p_operator_id: operatorId,
          });
          return failed ? ok(publicBody(failed)) : serverError();
        } else {
          console.error(`[${NAME}] Auth no disponible al crear la cuenta`);
          return serverError(); // sigue 'pending': reintentar con el mismo client_request_id
        }
      }

      // Cuenta propia ya existente (reintento): queda con la contrasena de ESTE
      // intento, que es la que el admin va a entregar.
      if (begun.own_auth_user_id === authUserId) {
        const updated = await deps.authAdmin.updatePassword(authUserId, body.password);
        if (updated?.error === "weak_password") {
          const failed = await rpc("fail_volunteer_registration", {
            p_registration_id: registrationId,
            p_reason: "weak_password",
            p_operator_id: operatorId,
          });
          return failed ? ok(publicBody(failed)) : serverError();
        }
        if (updated) {
          console.error(`[${NAME}] Auth no disponible al actualizar la contrasena`);
          return serverError();
        }
      }

      // 3) complete
      const done = await rpc("complete_volunteer_registration", {
        p_registration_id: registrationId,
        p_auth_user_id: authUserId,
        p_operator_id: operatorId,
      });
      if (!done) return serverError(); // la cuenta se queda: el reintento la reconoce
      return await cleanup(done);
    } catch (e) {
      console.error(`[${NAME}] error inesperado (${e instanceof Error ? e.name : typeof e})`);
      return serverError();
    }
  };
}
