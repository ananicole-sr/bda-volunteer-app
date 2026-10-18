// CORS para Expo web (navegador). La app nativa y curl no mandan Origin, asi
// que para ellos todo sigue igual que antes.
//
// Orígenes permitidos: variable CORS_ALLOWED_ORIGINS (secreto de las Edge
// Functions), lista separada por comas de orígenes exactos, p. ej.
//   http://localhost:8081,https://bamx-voluntarios.example.org
// Sin la variable (o vacia) no se permite ningun origen de navegador.
//
//   OPTIONS (preflight)          -> se responde aqui, ANTES de autenticar y sin
//                                   ninguna llamada a Auth, RPC ni createUser.
//   POST con Origin permitido    -> flujo normal (JWT, rol, validacion) y la
//                                   respuesta (exito o error) lleva los headers.
//   POST con Origin no permitido -> 403 origin_not_allowed, sin ejecutar nada.
//   Sin Origin (nativo, curl)    -> flujo normal, sin headers CORS.

import { json, serverError } from "./http.ts";

export const CORS_ALLOWED_METHODS = "POST, OPTIONS";
export const CORS_ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";
export const CORS_MAX_AGE_SECONDS = "86400";

/** Origen normalizado (scheme://host[:port] en minusculas) o null si no es un origen valido. */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value || value === "null") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Debe ser SOLO el origen: sin ruta, query ni credenciales.
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Lee CORS_ALLOWED_ORIGINS. Las entradas invalidas se ignoran (y se reportan sin valores sensibles). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  let invalid = 0;
  for (const part of raw.split(",")) {
    if (!part.trim()) continue;
    const origin = normalizeOrigin(part.replace(/\/+$/, ""));
    if (origin) out.add(origin);
    else invalid++;
  }
  if (invalid > 0) console.warn(`[cors] ${invalid} entrada(s) invalida(s) en CORS_ALLOWED_ORIGINS ignoradas`);
  return [...out];
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function withCors(
  handler: (req: Request) => Promise<Response>,
  allowedOrigins: readonly string[],
): (req: Request) => Promise<Response> {
  const allowed = new Set(allowedOrigins);

  return async (req: Request): Promise<Response> => {
    const rawOrigin = req.headers.get("Origin");
    const origin = rawOrigin === null ? null : normalizeOrigin(rawOrigin);
    const isAllowed = origin !== null && allowed.has(origin);
    // La respuesta depende del Origin: que ningun cache la comparta entre orígenes.
    const vary = { Vary: "Origin" };
    const cors = isAllowed ? { ...vary, "Access-Control-Allow-Origin": rawOrigin as string } : vary;

    if (req.method === "OPTIONS") {
      if (rawOrigin === null) {
        return new Response(null, { status: 204, headers: { ...vary, Allow: CORS_ALLOWED_METHODS } });
      }
      if (!isAllowed) return withHeaders(json(403, { code: "origin_not_allowed" }), vary);
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
          "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
          "Access-Control-Max-Age": CORS_MAX_AGE_SECONDS,
        },
      });
    }

    if (rawOrigin !== null && !isAllowed) {
      return withHeaders(json(403, { code: "origin_not_allowed" }), vary);
    }

    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      console.error(`[cors] error inesperado (${e instanceof Error ? e.name : typeof e})`);
      res = serverError();
    }
    return withHeaders(res, cors);
  };
}
