// deno test supabase/functions — alta de voluntario + cuenta (register-volunteer-account).
// Auth (auth.admin) y las RPC se simulan con respuestas programadas; el flujo
// real contra Postgres se prueba en supabase/tests/60_volunteer_registration_cases.sql.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { RpcResult } from "./handler.ts";
import { mapAuthAdminError } from "./deps.ts";
import { type AuthAdmin, type AuthAdminErrorCode, createRegistrationHandler } from "./registration.ts";
import { parseRegisterVolunteerAccount, PASSWORD_MAX_BYTES } from "./validate.ts";

const CRID = "e7000000-0000-4000-8000-000000000001";
const REG = "a7300000-0000-0000-0000-000000000001";
const NEW_USER = "a7200000-0000-0000-0000-000000000001";
const PASSWORD = "Bamx-Prueba#2026";
const good = {
  client_request_id: CRID,
  full_name: " Ana Pérez ",
  community: "Centro",
  uid: "04:a1:b2:c3",
  email: "  Ana.Perez@Example.COM ",
  password: PASSWORD,
};

interface Script {
  role?: string | null;
  user?: string | null;
  secret?: string | undefined;
  rpc?: Record<string, (RpcResult | Error)[]>; // respuestas por funcion, en orden
  create?: ({ id: string } | { error: AuthAdminErrorCode } | Error)[];
  update?: ({ error: AuthAdminErrorCode } | null)[];
  remove?: boolean[];
}

function harness(s: Script = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const authCalls: { op: string; args: unknown[] }[] = [];
  const next = <T>(q: T[] | undefined, fallback: T): T => (q && q.length ? q.shift()! : fallback);
  const authAdmin: AuthAdmin = {
    createUser: (...args) => {
      authCalls.push({ op: "createUser", args });
      const r = next(s.create, { id: NEW_USER } as { id: string });
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    updatePassword: (...args) => {
      authCalls.push({ op: "updatePassword", args });
      return Promise.resolve(next(s.update, null));
    },
    deleteUser: (...args) => {
      authCalls.push({ op: "deleteUser", args });
      return Promise.resolve(next(s.remove, true));
    },
  };
  const has = (k: keyof Script) => k in s;
  const handler = createRegistrationHandler({
    hmacSecret: has("secret") ? s.secret : "vector-secret-123",
    verifyToken: (t) => Promise.resolve(t === "good-token" && s.user !== null ? { id: s.user ?? "admin-1" } : null),
    getRole: () => Promise.resolve(has("role") ? s.role ?? null : "admin"),
    rpc: (fn, args) => {
      rpcCalls.push({ fn, args });
      const r = next(s.rpc?.[fn], { data: null, error: { code: "sin_script" } } as RpcResult);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    authAdmin,
  });
  return { handler, rpcCalls, authCalls };
}

function req(body: unknown, token: string | null = "good-token", method = "POST"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("http://localhost/fn", {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const okRpc = (data: unknown): RpcResult => ({ data, error: null });
const pending = (own: string | null = null) => okRpc({ code: "pending", registration_id: REG, own_auth_user_id: own });
const completed = (replayed = false) =>
  okRpc({
    code: "ok", replayed, registration_id: REG,
    volunteer: { id: "v1", full_name: "Ana Pérez", community: "Centro", user_id: NEW_USER },
    account: { user_id: NEW_USER, email: "ana.perez@example.com" }, card_id: "c1",
  });

/** Captura console.error durante fn. */
async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => logged.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return logged;
}

// ---------------------------------------------------------------- validacion
Deno.test("parseRegisterVolunteerAccount: normaliza email/uid/nombres; la contrasena va tal cual", () => {
  const r = parseRegisterVolunteerAccount({ ...good, role: "admin", user_id: "x", volunteer_id: "y" });
  assert(r.ok);
  assertEquals(r.value, {
    client_request_id: CRID, full_name: "Ana Pérez", community: "Centro", uid: "04A1B2C3",
    email: "ana.perez@example.com", password: PASSWORD,
  });
  const spaced = parseRegisterVolunteerAccount({ ...good, password: "  con espacios  " });
  assert(spaced.ok);
  assertEquals(spaced.value.password, "  con espacios  ");
  assert(parseRegisterVolunteerAccount({ ...good, password: "a".repeat(PASSWORD_MAX_BYTES) }).ok);
});

Deno.test("parseRegisterVolunteerAccount: rechaza cada campo invalido sin repetir la contrasena en el mensaje", () => {
  const secret = "corta1";
  for (const bad of [
    null, [], {},
    { ...good, client_request_id: "x" }, { ...good, client_request_id: "e7000000-0000-1000-8000-000000000001" },
    { ...good, full_name: "" }, { ...good, community: "x".repeat(121) },
    { ...good, uid: "04A1B2" }, { ...good, uid: undefined },
    { ...good, email: "sin-arroba" }, { ...good, email: "a@b" }, { ...good, email: 5 },
    { ...good, email: "a".repeat(250) + "@b.co" },
    { ...good, password: undefined }, { ...good, password: 12345678 }, { ...good, password: "        " },
    { ...good, password: secret },
    { ...good, password: "a".repeat(PASSWORD_MAX_BYTES + 1) },
    { ...good, password: "ñ".repeat(37) }, // 74 bytes en UTF-8
  ]) {
    const r = parseRegisterVolunteerAccount(bad);
    assertEquals(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert(!r.message.includes(secret));
  }
});

// ---------------------------------------------------------------- autorizacion
Deno.test("401 sin sesion y 403 para guard, volunteer y sin profile: no toca Auth ni SQL", async () => {
  for (const [token, status] of [[null, 401], ["bad-token", 401]] as const) {
    const h = harness();
    assertEquals((await h.handler(req(good, token))).status, status);
    assertEquals([h.rpcCalls.length, h.authCalls.length], [0, 0]);
  }
  for (const role of ["guard", "volunteer", null]) {
    const h = harness({ role });
    const res = await h.handler(req(good));
    assertEquals([res.status, await res.json()], [403, { code: "forbidden" }], `role=${role}`);
    assertEquals([h.rpcCalls.length, h.authCalls.length], [0, 0]);
  }
});

Deno.test("400 con cuerpo invalido o no JSON: no toca Auth ni SQL", async () => {
  for (const r of [req({ ...good, email: "x" }), req({ ...good, password: "short" }), req("{no json"), req(good, "good-token", "GET")]) {
    const h = harness();
    const res = await h.handler(r);
    assertEquals([res.status, (await res.json()).code], [400, "invalid_request"]);
    assertEquals([h.rpcCalls.length, h.authCalls.length], [0, 0]);
  }
});

Deno.test("sin CARD_UID_HMAC_SECRET -> 500 antes de crear nada", async () => {
  const h = harness({ secret: undefined });
  const logs = await captureLogs(() => h.handler(req(good)).then((r) => assertEquals(r.status, 500)));
  assertEquals([h.rpcCalls.length, h.authCalls.length], [0, 0]);
  assert(logs.length > 0);
});

// ---------------------------------------------------------------- camino feliz
Deno.test("camino feliz: begin -> createUser -> complete; rol y contrasena nunca van a SQL", async () => {
  const h = harness({ user: "admin-1", rpc: { begin_volunteer_registration: [pending()], complete_volunteer_registration: [completed()] } });
  const res = await h.handler(req({ ...good, role: "admin", operator_id: "otro" }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals([body.code, body.replayed, body.account.email], ["ok", false, "ana.perez@example.com"]);

  assertEquals(h.authCalls, [{
    op: "createUser",
    args: ["ana.perez@example.com", PASSWORD, { bamx_registration_id: REG }],
  }]);
  assertEquals(h.rpcCalls.map((c) => c.fn), ["begin_volunteer_registration", "complete_volunteer_registration"]);
  assertEquals(h.rpcCalls[0].args, {
    p_client_request_id: CRID,
    p_email: "ana.perez@example.com",
    p_uid_hmac: "f16abcbfdaec29b865bb65db3e1ada740e772a94e835f378dfb1766584cf90d0", // vector compartido con SQL
    p_full_name: "Ana Pérez",
    p_community: "Centro",
    p_operator_id: "admin-1",
  });
  assertEquals(h.rpcCalls[1].args, { p_registration_id: REG, p_auth_user_id: NEW_USER, p_operator_id: "admin-1" });
  const sql = JSON.stringify(h.rpcCalls);
  assert(!sql.includes(PASSWORD) && !/"role"|admin"|password/i.test(sql.replace(/admin-1/g, "")));
  assert(!JSON.stringify(body).includes(PASSWORD));
});

Deno.test("reintento de un alta ya completada: responde el resultado, sin tocar Auth", async () => {
  const h = harness({ rpc: { begin_volunteer_registration: [completed(true)] } });
  const res = await h.handler(req(good));
  assertEquals([(await res.json()).replayed, h.authCalls.length], [true, 0]);
});

// ---------------------------------------------------------------- conflictos
Deno.test("email de otra cuenta detectado en begin -> email_in_use, sin crear ni modificar cuentas", async () => {
  const h = harness({ rpc: { begin_volunteer_registration: [okRpc({ code: "email_in_use", message: "m", registration_id: REG })] } });
  const res = await h.handler(req(good));
  assertEquals([res.status, await res.json()], [200, { code: "email_in_use", message: "m", registration_id: REG }]);
  assertEquals(h.authCalls.length, 0);
});

Deno.test("Auth dice email_exists y no es nuestra -> email_in_use, sin updatePassword ni complete", async () => {
  const h = harness({
    create: [{ error: "email_exists" }],
    rpc: { begin_volunteer_registration: [pending(), okRpc({ code: "email_in_use", message: "m", registration_id: REG })] },
  });
  const body = await (await h.handler(req(good))).json();
  assertEquals(body.code, "email_in_use");
  assertEquals(h.authCalls.map((c) => c.op), ["createUser"]);
  assertEquals(h.rpcCalls.map((c) => c.fn), ["begin_volunteer_registration", "begin_volunteer_registration"]);
});

Deno.test("Auth dice email_exists y begin la reconoce como nuestra (reintento concurrente) -> continua", async () => {
  const h = harness({
    create: [{ error: "email_exists" }],
    rpc: { begin_volunteer_registration: [pending(), pending(NEW_USER)], complete_volunteer_registration: [completed()] },
  });
  assertEquals((await (await h.handler(req(good))).json()).code, "ok");
  assertEquals(h.authCalls.map((c) => c.op), ["createUser", "updatePassword"]);
  assertEquals(h.authCalls[1].args, [NEW_USER, PASSWORD]);
});

Deno.test("tarjeta en uso detectada en begin -> card_in_use, sin crear cuenta", async () => {
  const h = harness({ rpc: { begin_volunteer_registration: [okRpc({ code: "card_in_use", message: "m", registration_id: REG })] } });
  const body = await (await h.handler(req(good))).json();
  assertEquals([body.code, body.account_cleanup], ["card_in_use", undefined]);
  assertEquals(h.authCalls.length, 0);
});

// ---------------------------------------------------------------- fallas y recuperacion
Deno.test("tarjeta tomada en carrera (complete) -> borra la cuenta recien creada: account_cleanup done", async () => {
  const h = harness({
    rpc: {
      begin_volunteer_registration: [pending()],
      complete_volunteer_registration: [okRpc({ code: "card_in_use", message: "m", registration_id: REG, cleanup_auth_user_id: NEW_USER })],
    },
  });
  const body = await (await h.handler(req(good))).json();
  assertEquals(body, { code: "card_in_use", message: "m", registration_id: REG, account_cleanup: "done" });
  assertEquals(h.authCalls.map((c) => [c.op, c.args[0]]), [["createUser", "ana.perez@example.com"], ["deleteUser", NEW_USER]]);
});

Deno.test("si el borrado de compensacion falla -> account_cleanup pending; el reintento lo vuelve a intentar", async () => {
  const failed = { code: "card_in_use", message: "m", registration_id: REG, cleanup_auth_user_id: NEW_USER };
  const h1 = harness({
    remove: [false],
    rpc: { begin_volunteer_registration: [pending()], complete_volunteer_registration: [okRpc(failed)] },
  });
  const logs = await captureLogs(async () => {
    assertEquals((await (await h1.handler(req(good))).json()).account_cleanup, "pending");
  });
  // Reintento: begin vuelve a reportar la cuenta propia por limpiar.
  const h2 = harness({ rpc: { begin_volunteer_registration: [okRpc(failed)] } });
  assertEquals((await (await h2.handler(req(good))).json()).account_cleanup, "done");
  assertEquals(h2.authCalls.map((c) => c.op), ["deleteUser"]);
  for (const l of logs) assert(!l.includes(NEW_USER) && !l.includes(PASSWORD), l);
});

Deno.test("Auth caido al crear la cuenta -> 500; sigue pending y el reintento completa", async () => {
  const h1 = harness({ create: [{ error: "unavailable" }], rpc: { begin_volunteer_registration: [pending()] } });
  await captureLogs(async () => assertEquals((await h1.handler(req(good))).status, 500));
  assertEquals(h1.rpcCalls.map((c) => c.fn), ["begin_volunteer_registration"]); // ni complete ni fail

  const h2 = harness({ rpc: { begin_volunteer_registration: [pending()], complete_volunteer_registration: [completed()] } });
  assertEquals((await (await h2.handler(req(good))).json()).code, "ok");
});

Deno.test("falla DESPUES de crear la cuenta (complete no responde) -> 500 sin borrar; el reintento la reusa", async () => {
  const h1 = harness({
    rpc: { begin_volunteer_registration: [pending()], complete_volunteer_registration: [{ data: null, error: { code: "08006" } }] },
  });
  await captureLogs(async () => assertEquals((await h1.handler(req(good))).status, 500));
  assertEquals(h1.authCalls.map((c) => c.op), ["createUser"]); // la cuenta NO se borra

  const h2 = harness({
    rpc: { begin_volunteer_registration: [pending(NEW_USER)], complete_volunteer_registration: [completed()] },
  });
  assertEquals((await (await h2.handler(req({ ...good, password: "Otra-Clave#2026" }))).json()).code, "ok");
  // No crea otra cuenta; deja la contrasena de este intento (la que el admin entregara).
  assertEquals(h2.authCalls, [{ op: "updatePassword", args: [NEW_USER, "Otra-Clave#2026"] }]);
});

Deno.test("excepcion de red en createUser -> 500 generico", async () => {
  const h = harness({ create: [new Error("fetch failed")], rpc: { begin_volunteer_registration: [pending()] } });
  await captureLogs(async () => assertEquals((await h.handler(req(good))).status, 500));
});

Deno.test("contrasena rechazada por la politica de Auth -> weak_password y la solicitud queda failed", async () => {
  const h = harness({
    create: [{ error: "weak_password" }],
    rpc: {
      begin_volunteer_registration: [pending()],
      fail_volunteer_registration: [okRpc({ code: "weak_password", message: "m", registration_id: REG })],
    },
  });
  const body = await (await h.handler(req(good))).json();
  assertEquals(body.code, "weak_password");
  assertEquals(h.rpcCalls[1], {
    fn: "fail_volunteer_registration",
    args: { p_registration_id: REG, p_reason: "weak_password", p_operator_id: "admin-1" },
  });
});

Deno.test("los logs nunca incluyen contrasena, email ni UID en ningun camino de falla", async () => {
  const scripts: Script[] = [
    { secret: undefined },
    { rpc: { begin_volunteer_registration: [{ data: null, error: { code: "XX000" } }] } },
    { create: [{ error: "unavailable" }], rpc: { begin_volunteer_registration: [pending()] } },
    { create: [new Error(`boom ${PASSWORD}`)], rpc: { begin_volunteer_registration: [pending()] } },
    { update: [{ error: "unavailable" }], rpc: { begin_volunteer_registration: [pending(NEW_USER)] } },
    { remove: [false], rpc: { begin_volunteer_registration: [okRpc({ code: "card_in_use", cleanup_auth_user_id: NEW_USER })] } },
    { rpc: { begin_volunteer_registration: [pending()], complete_volunteer_registration: [{ data: "x", error: null }] } },
  ];
  for (const s of scripts) {
    const logs = await captureLogs(() => harness(s).handler(req(good)));
    for (const l of logs) assert(!/Bamx-Prueba|ana\.perez|example\.com|04A1B2C3|04:a1/i.test(l), l);
  }
});

Deno.test("mapAuthAdminError traduce los codigos de GoTrue", () => {
  assertEquals(mapAuthAdminError({ code: "email_exists" }), "email_exists");
  assertEquals(mapAuthAdminError({ code: "user_already_exists" }), "email_exists");
  assertEquals(mapAuthAdminError({ code: "weak_password" }), "weak_password");
  assertEquals(mapAuthAdminError({ code: "email_address_invalid" }), "invalid_email");
  assertEquals(mapAuthAdminError({ code: "unexpected_failure", status: 500 }), "unavailable");
  assertEquals(mapAuthAdminError(null), "unavailable");
});
