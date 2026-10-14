// Dependencias reales (Supabase). Solo lo importan los index.ts; las pruebas
// usan dobles de `Deps` y no cargan supabase-js.

import { createClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./handler.ts";

export function realDeps(): Deps {
  // SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase en las Edge Functions.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  return {
    hmacSecret: Deno.env.get("CARD_UID_HMAC_SECRET"),

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
