// deno test supabase/functions — CORS (cors.ts) en createHandler y en el
// handler de alta con cuenta. Dependencias simuladas que cuentan cada llamada
// a Auth, profiles, RPC y auth.admin.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  normalizeOrigin,
  parseAllowedOrigins,
  withCors,
} from "./cors.ts";
import { createHandler, type Deps, type RpcResult } from "./handler.ts";
import { type AuthAdmin, createRegistrationHandler } from "./registration.ts";
import { checkInSpec, createRewardSpec, issueCardSpec, redeemRewardsSpec } from "./specs.ts";

const DEV = "http://localhost:8081";
const PROD = "https://voluntarios.bamx.example";
const EVIL = "https://evil.example";
const ORIGINS = [DEV, PROD];

interface Counters {
  verify: number;
  role: number;
  rpc: number;
  auth: number;
}

function deps(opts: { role?: string | null; rpc?: RpcResult; throws?: boolean; origins?: string[] } = {}) {
  const n: Counters = { verify: 0, role: 0, rpc: 0, auth: 0 };
  const authAdmin: AuthAdmin = {
    createUser: () => (n.auth++, Promise.resolve({ id: "new-user" })),
    updatePassword: () => (n.auth++, Promise.resolve(null)),
    deleteUser: () => (n.auth++, Promise.resolve(true)),
  };
  const d: Deps & { authAdmin: AuthAdmin } = {
    hmacSecret: "vector-secret-123",
    allowedOrigins: opts.origins ?? ORIGINS,
    verifyToken: (t) => (n.verify++, Promise.resolve(t === "good-token" ? { id: "u1" } : null)),
    getRole: () => {
      n.role++;
      if (opts.throws) return Promise.reject(new Error("db down"));
      return Promise.resolve("role" in opts ? opts.role ?? null : "admin");
    },
    rpc: () => (n.rpc++, Promise.resolve(opts.rpc ?? { data: { code: "ok" }, error: null })),
    authAdmin,
  };
  return { d, n };
}

const okCheckIn = {
  event_id: "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b",
  uid: "04A1B2C3",
  terminal_id: "term-1",
  client_ts: new Date().toISOString(),
};
const okRegister = {
  client_request_id: "e7000000-0000-4000-8000-000000000001",
  full_name: "Ana", community: "Centro", uid: "04A1B2C3",
  email: "ana@test.local", password: "Inicial#2026",
};

function req(
  opts: { method?: string; origin?: string | null; token?: string | null; body?: unknown; preflight?: boolean } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? DEV);
  if (opts.token !== null) headers.set("Authorization", `Bearer ${opts.token ?? "good-token"}`);
  if (opts.preflight) {
    headers.set("Access-Control-Request-Method", "POST");
    headers.set("Access-Control-Request-Headers", "authorization, apikey, content-type, x-client-info");
  }
  const method = opts.method ?? "POST";
  return new Request("http://localhost/fn", {
    method,
    headers,
    body: method === "POST" ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? okCheckIn)) : undefined,
  });
}

const preflight = (origin: string | null = DEV) => req({ method: "OPTIONS", origin, token: null, preflight: true });
const total = (n: Counters) => n.verify + n.role + n.rpc + n.auth;

// ---------------------------------------------------------------- configuracion
Deno.test("parseAllowedOrigins: recorta, quita '/', normaliza mayusculas, ignora invalidos", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assertEquals(
      parseAllowedOrigins(" http://localhost:8081 , HTTPS://Voluntarios.BAMX.example/ ,, http://localhost:8081,"),
      ["http://localhost:8081", "https://voluntarios.bamx.example"],
    );
    assertEquals(parseAllowedOrigins(undefined), []);
    assertEquals(parseAllowedOrigins(""), []);
    assertEquals(parseAllowedOrigins("*, null, ftp://x.example, https://x.example/ruta, localhost:8081"), []);
  } finally {
    console.warn = warn;
  }
  assertEquals(normalizeOrigin("https://a.example:443"), "https://a.example");
  assertEquals(normalizeOrigin("https://user:pw@a.example"), null);
});

// ---------------------------------------------------------------- preflight
Deno.test("OPTIONS con origen permitido: 204 con los headers del frontend; sin Auth, RPC ni createUser", async () => {
  for (const make of [(d: Deps) => createHandler(checkInSpec, d), (d: Deps & { authAdmin: AuthAdmin }) => createRegistrationHandler(d)]) {
    for (const origin of [DEV, PROD]) {
      const { d, n } = deps();
      const res = await make(d)(preflight(origin));
      assertEquals(res.status, 204);
      assertEquals(res.headers.get("Access-Control-Allow-Origin"), origin);
      assertEquals(res.headers.get("Access-Control-Allow-Methods"), CORS_ALLOWED_METHODS);
      assertEquals(res.headers.get("Access-Control-Allow-Headers"), CORS_ALLOWED_HEADERS);
      assert(res.headers.get("Vary")?.includes("Origin"));
      assertEquals(total(n), 0, JSON.stringify(n));
    }
  }
  for (const h of ["authorization", "apikey", "content-type", "x-client-info"]) {
    assert(CORS_ALLOWED_HEADERS.split(", ").includes(h), h);
  }
});

Deno.test("OPTIONS con origen no permitido o sin configuracion: 403 sin Allow-Origin y sin llamadas", async () => {
  for (const [origin, origins] of [[EVIL, ORIGINS], [DEV, []], ["null", ORIGINS]] as const) {
    const { d, n } = deps({ origins: [...origins] });
    const res = await createRegistrationHandler(d)(preflight(origin));
    assertEquals(res.status, 403, `${origin}`);
    assertEquals(await res.json(), { code: "origin_not_allowed" });
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(total(n), 0);
  }
});

Deno.test("OPTIONS sin Origin (no es preflight de navegador): 204 minimo, sin llamadas", async () => {
  const { d, n } = deps();
  const res = await createHandler(checkInSpec, d)(preflight(null));
  assertEquals([res.status, res.headers.get("Access-Control-Allow-Origin")], [204, null]);
  assertEquals(total(n), 0);
});

// ---------------------------------------------------------------- peticiones reales
Deno.test("POST con origen permitido: 200 con Allow-Origin y Vary", async () => {
  const { d, n } = deps({ role: "guard" });
  const res = await createHandler(checkInSpec, d)(req({ origin: PROD }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), PROD);
  assert(res.headers.get("Vary")?.includes("Origin"));
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(n.rpc, 1);
});

Deno.test("errores 400, 401, 403 y 500 tambien llevan los headers CORS", async () => {
  const cases: [string, Request, ReturnType<typeof deps>, number][] = [
    ["400 cuerpo invalido", req({ body: { ...okCheckIn, uid: "ZZ" } }), deps(), 400],
    ["400 no JSON", req({ body: "{no json" }), deps(), 400],
    ["401 sin token", req({ token: null }), deps(), 401],
    ["401 token invalido", req({ token: "bad-token" }), deps(), 401],
    ["403 rol", req(), deps({ role: "volunteer" }), 403],
    ["500 rpc", req(), deps({ rpc: { data: null, error: { code: "XX000" } } }), 500],
    ["500 excepcion", req(), deps({ throws: true }), 500],
  ];
  const orig = console.error;
  console.error = () => {};
  try {
    for (const [name, r, { d }, status] of cases) {
      const res = await createHandler(checkInSpec, d)(r);
      assertEquals(res.status, status, name);
      assertEquals(res.headers.get("Access-Control-Allow-Origin"), DEV, name);
      assert(res.headers.get("Vary")?.includes("Origin"), name);
    }
  } finally {
    console.error = orig;
  }
});

Deno.test("CORS no reemplaza la autorizacion: con origen permitido el rol se sigue exigiendo", async () => {
  const checks: [typeof createRewardSpec | typeof redeemRewardsSpec | typeof issueCardSpec, string, unknown][] = [
    [createRewardSpec, "guard", { name: "x", points_cost: 1, stock: 1 }],
    [redeemRewardsSpec, "admin", { client_request_id: okRegister.client_request_id, reward_ids: [okRegister.client_request_id] }],
    [issueCardSpec, "volunteer", { volunteer_id: "0a1b2c3d-1111-2222-3333-444455556666", uid: "04A1B2C3" }],
  ];
  for (const [spec, role, body] of checks) {
    const { d, n } = deps({ role });
    const res = await createHandler(spec as typeof createRewardSpec, d)(req({ body }));
    assertEquals([res.status, await res.json()], [403, { code: "forbidden" }], `${spec.name} role=${role}`);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), DEV);
    assertEquals(n.rpc, 0);
  }
  for (const role of ["guard", "volunteer", null]) {
    const { d, n } = deps({ role });
    const res = await createRegistrationHandler(d)(req({ body: okRegister }));
    assertEquals(res.status, 403);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), DEV);
    assertEquals([n.rpc, n.auth], [0, 0]);
  }
});

Deno.test("POST con origen no permitido: 403 origin_not_allowed sin Auth, RPC ni createUser", async () => {
  for (const make of [(d: Deps) => createHandler(checkInSpec, d), (d: Deps & { authAdmin: AuthAdmin }) => createRegistrationHandler(d)]) {
    const { d, n } = deps();
    const res = await make(d)(req({ origin: EVIL, body: okRegister }));
    assertEquals([res.status, await res.json()], [403, { code: "origin_not_allowed" }]);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(total(n), 0);
  }
});

Deno.test("sin Origin (app nativa, curl): mismo comportamiento que antes y sin Allow-Origin", async () => {
  const { d, n } = deps({ role: "guard", origins: [] }); // aunque no haya orígenes configurados
  const res = await createHandler(checkInSpec, d)(req({ origin: null }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals([n.verify, n.role, n.rpc], [1, 1, 1]);

  const unauth = await createHandler(checkInSpec, deps({ origins: [] }).d)(req({ origin: null, token: null }));
  assertEquals(unauth.status, 401);
});

Deno.test("alta con cuenta con origen permitido: flujo completo y headers en la respuesta", async () => {
  const { d, n } = deps();
  const scripted: RpcResult[] = [
    { data: { code: "pending", registration_id: "r1", own_auth_user_id: null }, error: null },
    { data: { code: "ok", replayed: false, account: { user_id: "new-user" } }, error: null },
  ];
  d.rpc = () => (n.rpc++, Promise.resolve(scripted.shift()!));
  const res = await createRegistrationHandler(d)(req({ origin: PROD, body: okRegister }));
  assertEquals([res.status, (await res.json()).code], [200, "ok"]);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), PROD);
  assertEquals([n.rpc, n.auth], [2, 1]);
});

Deno.test("withCors: si el handler lanza, responde 500 generico con headers", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const h = withCors(() => Promise.reject(new Error("boom")), ORIGINS);
    const res = await h(req());
    assertEquals([res.status, await res.json()], [500, { code: "server_error" }]);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), DEV);
  } finally {
    console.error = orig;
  }
});
