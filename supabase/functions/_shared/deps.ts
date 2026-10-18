// Dependencias reales (Supabase). Solo lo importan los index.ts; las pruebas
// usan dobles de `Deps` y no cargan supabase-js.

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseAllowedOrigins } from "./cors.ts";
import type { Deps } from "./handler.ts";
import type { AuthAdmin, AuthAdminErrorCode, RegistrationDeps } from "./registration.ts";

function adminClient() {
  // SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase en las Edge Functions.
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function realDeps(admin = adminClient()): Deps {
  return {
    hmacSecret: Deno.env.get("CARD_UID_HMAC_SECRET"),
    allowedOrigins: parseAllowedOrigins(Deno.env.get("CORS_ALLOWED_ORIGINS")),

    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },

    async getRole(userId) {
      const { data, error } = await admin.from("profiles").select("role").eq("id", userId)
        .maybeSingle();
      if (error) throw new Error("profiles_lookup_failed");
      return (data?.role as string | undefined) ?? null;
    },

    async rpc(fn, args) {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { code: error.code } : null };
    },
  };
}

/**
 * Traduce un error de auth.admin a los codigos del alta. Los codigos de
 * GoTrue (email_exists, user_already_exists, weak_password,
 * email_address_invalid) hay que verificarlos contra el Auth real.
 */
export function mapAuthAdminError(error: { code?: string; status?: number } | null): AuthAdminErrorCode {
  const code = error?.code ?? "";
  if (code === "email_exists" || code === "user_already_exists") return "email_exists";
  if (code === "weak_password") return "weak_password";
  if (code === "email_address_invalid") return "invalid_email";
  return "unavailable";
}

export function realRegistrationDeps(): RegistrationDeps {
  const admin = adminClient();
  const authAdmin: AuthAdmin = {
    async createUser(email, password, appMetadata) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // el admin entrega las credenciales; no hay correo de confirmacion
        app_metadata: appMetadata,
      });
      if (error || !data.user) return { error: mapAuthAdminError(error) };
      return { id: data.user.id };
    },
    async updatePassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      return error ? { error: mapAuthAdminError(error) } : null;
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      return !error || (error as { status?: number }).status === 404;
    },
  };
  return { ...realDeps(admin), authAdmin };
}
