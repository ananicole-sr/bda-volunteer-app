// deno test supabase/functions
import { assert, assertEquals } from "jsr:@std/assert@1";
import { uidHmac } from "./hmac.ts";
import { createHandler, type Deps, type RpcResult } from "./handler.ts";
import {
  checkInSpec,
  createRewardSpec,
  deactivateRewardSpec,
  deactivateVolunteerSpec,
  enrollVolunteerSpec,
  issueCardSpec,
  linkVolunteerAccountSpec,
  updateRewardSpec,
  updateVolunteerSpec,
} from "./specs.ts";
import { normalizeUid } from "./uid.ts";
import {
  parseCheckIn,
  parseCreateReward,
  parseDeactivateReward,
  parseDeactivateVolunteer,
  parseEnroll,
  parseIssueCard,
  parseLinkVolunteerAccount,
  parseUpdateReward,
  parseUpdateVolunteer,
  PG_INT_MAX,
} from "./validate.ts";

// ---------------------------------------------------------------- UID
Deno.test("normalizeUid: mayusculas, sin separadores, longitudes 8/14/20", () => {
  assertEquals(normalizeUid("04:a1:b2:c3"), "04A1B2C3");
  assertEquals(normalizeUid("04-a1_b2.c3"), "04A1B2C3");
  assertEquals(normalizeUid(" 04 a1 b2 c3 d4 e5 f6 "), "04A1B2C3D4E5F6");
  assertEquals(normalizeUid("04A1B2C3D4E5F6A7B8C9"), "04A1B2C3D4E5F6A7B8C9");
});

Deno.test("normalizeUid: rechaza lo invalido", () => {
  for (const bad of ["", "04A1B2", "04A1B2C3D4", "04A1B2C3D", "ZZZZZZZZ", "04A1B2C3D4E5F6A7B8C9D0", null, 12345678, undefined, {}]) {
    assertEquals(normalizeUid(bad), null, `deberia rechazar ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------- HMAC
// Vectores calculados en SQL con el mismo mensaje/clave:
//   select encode(extensions.hmac(upper('<uid>'), 'vector-secret-123', 'sha256'), 'hex');
Deno.test("uidHmac: vectores identicos a extensions.hmac de Postgres", async () => {
  assertEquals(
    await uidHmac("04A1B2C3", "vector-secret-123"),
    "f16abcbfdaec29b865bb65db3e1ada740e772a94e835f378dfb1766584cf90d0",
  );
  assertEquals(
    await uidHmac("04A1B2C3D4E5F6", "vector-secret-123"),
    "d17a31012ec627fc9cf2e13cbba33c64645e04211d76b75edf1ddae429b173e0",
  );
});

Deno.test("uidHmac: el mensaje se usa en mayusculas", async () => {
  assertEquals(await uidHmac("04a1b2c3", "s"), await uidHmac("04A1B2C3", "s"));
});

// ---------------------------------------------------------------- validacion de cuerpos
const EV = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";
const okCheckIn = { event_id: EV, uid: "04:a1:b2:c3", terminal_id: "term-1", client_ts: "2026-10-13T12:00:00-06:00" };

Deno.test("parseCheckIn: caso valido normaliza uid y client_ts", () => {
  const r = parseCheckIn(okCheckIn);
  assert(r.ok);
  assertEquals(r.value.uid, "04A1B2C3");
  assertEquals(r.value.client_ts, "2026-10-13T18:00:00.000Z");
});

Deno.test("parseCheckIn: rechaza cuerpos invalidos", () => {
  const cases: unknown[] = [
    null, [], "x",
    { ...okCheckIn, event_id: "no-uuid" },
    { ...okCheckIn, event_id: "3f2b8c1e-5a4d-1e6f-8a9b-0c1d2e3f4a5b" }, // no es v4
    { ...okCheckIn, uid: "XYZ" },
    { ...okCheckIn, uid: "04A1B2C3D4" }, // 10 hex
    { ...okCheckIn, terminal_id: "" },
    { ...okCheckIn, terminal_id: "x".repeat(65) },
    { ...okCheckIn, terminal_id: 5 },
    { ...okCheckIn, client_ts: "ayer" },
    { ...okCheckIn, client_ts: "2026-10-13T12:00:00" }, // sin zona
    { ...okCheckIn, client_ts: "2026-13-45T99:00:00Z" },
    { ...okCheckIn, client_ts: 1760000000 },
  ];
  for (const c of cases) assertEquals(parseCheckIn(c).ok, false, JSON.stringify(c));
  assert(parseCheckIn({ ...okCheckIn, terminal_id: "x".repeat(64) }).ok);
});

Deno.test("parseEnroll: limites de full_name/community y uid", () => {
  const good = { full_name: " Ana Perez ", community: "Centro", uid: "04a1b2c3" };
  const r = parseEnroll(good);
  assert(r.ok);
  assertEquals(r.value, { full_name: "Ana Perez", community: "Centro", uid: "04A1B2C3" });
  assert(parseEnroll({ ...good, full_name: "x".repeat(120) }).ok);
  for (const bad of [
    { ...good, full_name: "" }, { ...good, full_name: "   " }, { ...good, full_name: "x".repeat(121) },
    { ...good, community: "" }, { ...good, community: "x".repeat(121) }, { ...good, community: null },
    { ...good, uid: "12" }, { full_name: "a", community: "b" },
  ]) assertEquals(parseEnroll(bad).ok, false, JSON.stringify(bad));
});

Deno.test("parseIssueCard: volunteer_id UUID y uid valido", () => {
  const vid = "0a1b2c3d-1111-2222-3333-444455556666";
  assert(parseIssueCard({ volunteer_id: vid, uid: "04A1B2C3" }).ok);
  assertEquals(parseIssueCard({ volunteer_id: "123", uid: "04A1B2C3" }).ok, false);
  assertEquals(parseIssueCard({ volunteer_id: vid, uid: "04A1B2" }).ok, false);
});

// ---------------------------------------------------------------- handler (cliente simulado)
interface Fake {
  deps: Deps;
  calls: { fn: string; args: Record<string, unknown> }[];
}

function fake(opts: { user?: string | null; role?: string | null; rpc?: RpcResult; secret?: string | undefined; roleThrows?: boolean } = {}): Fake {
  const calls: Fake["calls"] = [];
  const has = (k: string) => k in opts;
  return {
    calls,
    deps: {
      hmacSecret: has("secret") ? opts.secret : "vector-secret-123",
      verifyToken: (t) => Promise.resolve(t === "good-token" && opts.user !== null ? { id: opts.user ?? "user-1" } : null),
      getRole: () => {
        if (opts.roleThrows) return Promise.reject(new Error("db down"));
        return Promise.resolve(has("role") ? opts.role ?? null : "admin");
      },
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve(opts.rpc ?? { data: { code: "ok" }, error: null });
      },
    },
  };
}

function req(body: unknown, token: string | null = "good-token", method = "POST"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("http://localhost/fn", { method, headers, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

Deno.test("401 sin Authorization o con token invalido", async () => {
  const f = fake();
  const h = createHandler(checkInSpec, f.deps);
  for (const r of [req(okCheckIn, null), req(okCheckIn, "bad-token")]) {
    const res = await h(r);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { code: "unauthorized" });
  }
  assertEquals(f.calls.length, 0);
});

Deno.test("403 sin fila en profiles o con rol incorrecto", async () => {
  const noProfile = createHandler(checkInSpec, fake({ role: null }).deps);
  assertEquals((await noProfile(req(okCheckIn))).status, 403);

  for (const role of ["volunteer", "guard"]) {
    const f = fake({ role });
    const res = await createHandler(enrollVolunteerSpec, f.deps)(req({ full_name: "A", community: "B", uid: "04A1B2C3" }));
    assertEquals(res.status, 403);
    assertEquals(await res.json(), { code: "forbidden" });
    const res2 = await createHandler(issueCardSpec, f.deps)(req({ volunteer_id: "0a1b2c3d-1111-2222-3333-444455556666", uid: "04A1B2C3" }));
    assertEquals(res2.status, 403);
    assertEquals(f.calls.length, 0);
  }
  assertEquals((await createHandler(checkInSpec, fake({ role: "volunteer" }).deps)(req(okCheckIn))).status, 403);
});

Deno.test("check-in acepta guard y admin", async () => {
  for (const role of ["guard", "admin"]) {
    const res = await createHandler(checkInSpec, fake({ role }).deps)(req(okCheckIn));
    assertEquals(res.status, 200);
  }
});

Deno.test("400 invalid_request con cuerpo invalido o no JSON (despues de auth y rol)", async () => {
  const f = fake();
  const h = createHandler(checkInSpec, f.deps);
  for (const r of [req({ ...okCheckIn, uid: "ZZ" }), req("{no json"), req(okCheckIn, "good-token", "GET")]) {
    const res = await h(r);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.code, "invalid_request");
    assertEquals(typeof body.message, "string");
  }
  assertEquals(f.calls.length, 0);
});

Deno.test("200 pasa tal cual el jsonb de negocio, incluidos codigos de error de negocio", async () => {
  for (const data of [
    { code: "ok", points_awarded: 10, volunteer: { id: "v", full_name: "A", points: 10, total_visits: 1 } },
    { code: "duplicate_event", points_awarded: 10 },
    { code: "daily_limit", message: "Ya se registro un check-in hoy" },
    { code: "card_unknown", message: "Tarjeta no registrada" },
  ]) {
    const res = await createHandler(checkInSpec, fake({ rpc: { data, error: null } }).deps)(req(okCheckIn));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), data);
  }
});

Deno.test("check-in: RPC con operator_id del JWT (no del body) y HMAC correcto", async () => {
  const f = fake({ user: "jwt-user" });
  const res = await createHandler(checkInSpec, f.deps)(req({ ...okCheckIn, operator_id: "hacker", p_operator_id: "hacker" }));
  assertEquals(res.status, 200);
  assertEquals(f.calls.length, 1);
  assertEquals(f.calls[0].fn, "register_check_in");
  assertEquals(f.calls[0].args, {
    p_event_id: EV,
    p_uid_hmac: "f16abcbfdaec29b865bb65db3e1ada740e772a94e835f378dfb1766584cf90d0",
    p_terminal_id: "term-1",
    p_operator_id: "jwt-user",
    p_client_ts: "2026-10-13T18:00:00.000Z",
  });
});

Deno.test("enroll-volunteer e issue-card llaman a su RPC con operator_id del JWT", async () => {
  const f = fake({ user: "admin-1" });
  await createHandler(enrollVolunteerSpec, f.deps)(req({ full_name: "Ana", community: "Centro", uid: "04A1B2C3D4E5F6", operator_id: "x" }));
  await createHandler(issueCardSpec, f.deps)(req({ volunteer_id: "0a1b2c3d-1111-2222-3333-444455556666", uid: "04A1B2C3D4E5F6" }));
  assertEquals(f.calls[0], {
    fn: "enroll_volunteer",
    args: { p_full_name: "Ana", p_community: "Centro", p_uid_hmac: "d17a31012ec627fc9cf2e13cbba33c64645e04211d76b75edf1ddae429b173e0", p_operator_id: "admin-1" },
  });
  assertEquals(f.calls[1], {
    fn: "issue_card",
    args: { p_volunteer_id: "0a1b2c3d-1111-2222-3333-444455556666", p_uid_hmac: "d17a31012ec627fc9cf2e13cbba33c64645e04211d76b75edf1ddae429b173e0", p_operator_id: "admin-1" },
  });
});

Deno.test("500 generico: error de RPC, forma inesperada, sin secreto o fallo de profiles; sin filtrar detalles", async () => {
  const cases: Fake[] = [
    fake({ rpc: { data: null, error: { code: "42501" } } }),
    fake({ rpc: { data: { sin: "code" }, error: null } }),
    fake({ secret: undefined }),
    fake({ roleThrows: true }),
  ];
  const origError = console.error;
  console.error = () => {};
  try {
    for (const f of cases) {
      const res = await createHandler(checkInSpec, f.deps)(req(okCheckIn));
      assertEquals(res.status, 500);
      const text = await res.text();
      assertEquals(JSON.parse(text), { code: "server_error" });
      assert(!text.includes("42501") && !text.includes("db down"));
    }
  } finally {
    console.error = origError;
  }
});

Deno.test("los logs de error no incluyen UID ni secreto", async () => {
  const logged: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(" "));
  try {
    await createHandler(checkInSpec, fake({ rpc: { data: null, error: { code: "XX000" } } }).deps)(req(okCheckIn));
  } finally {
    console.error = origError;
  }
  assert(logged.length > 0);
  for (const l of logged) assert(!/04A1B2C3|vector-secret-123/i.test(l), l);
});

// ---------------------------------------------------------------- update-volunteer / deactivate-volunteer
const VID = "0A1B2C3D-1111-2222-3333-444455556666";
const vid = VID.toLowerCase();

Deno.test("parseUpdateVolunteer: parcial o completo, recorta y descarta campos ajenos", () => {
  const onlyName = parseUpdateVolunteer({ volunteer_id: VID, full_name: "  Ana  " });
  assert(onlyName.ok);
  assertEquals(onlyName.value, { volunteer_id: vid, full_name: "Ana" });

  const onlyCommunity = parseUpdateVolunteer({ volunteer_id: VID, community: "Centro" });
  assert(onlyCommunity.ok);
  assertEquals(onlyCommunity.value, { volunteer_id: vid, community: "Centro" });

  const both = parseUpdateVolunteer({
    volunteer_id: VID, full_name: "Ana", community: "x".repeat(120),
    points: 9999, is_active: true, uid: "04A1B2C3", operator_id: "x",
  });
  assert(both.ok);
  assertEquals(both.value, { volunteer_id: vid, full_name: "Ana", community: "x".repeat(120) });
});

Deno.test("parseUpdateVolunteer: rechaza cuerpos invalidos", () => {
  for (const bad of [
    null, [], "x",
    { volunteer_id: VID },                                 // nada que cambiar
    { full_name: "Ana" },                                  // sin volunteer_id
    { volunteer_id: "123", full_name: "Ana" },
    { volunteer_id: VID, full_name: "" },
    { volunteer_id: VID, full_name: "   " },
    { volunteer_id: VID, full_name: "x".repeat(121) },
    { volunteer_id: VID, full_name: null },                // null no es "no cambiar"
    { volunteer_id: VID, community: 5 },
    { volunteer_id: VID, full_name: "Ana", community: "" }, // un campo malo invalida todo
  ]) assertEquals(parseUpdateVolunteer(bad).ok, false, JSON.stringify(bad));
});

Deno.test("parseDeactivateVolunteer: solo volunteer_id UUID", () => {
  const r = parseDeactivateVolunteer({ volunteer_id: VID, is_active: true });
  assert(r.ok);
  assertEquals(r.value, { volunteer_id: vid });
  for (const bad of [null, {}, { volunteer_id: "no-uuid" }, { volunteer_id: 1 }]) {
    assertEquals(parseDeactivateVolunteer(bad).ok, false, JSON.stringify(bad));
  }
});

const volunteerCases = [
  { spec: updateVolunteerSpec, body: { volunteer_id: VID, full_name: "Ana" } },
  { spec: deactivateVolunteerSpec, body: { volunteer_id: VID } },
] as const;

Deno.test("update/deactivate-volunteer: 401 sin token o con token invalido, sin llamar RPC", async () => {
  for (const { spec, body } of volunteerCases) {
    const f = fake();
    const h = createHandler(spec as typeof updateVolunteerSpec, f.deps);
    for (const r of [req(body, null), req(body, "bad-token")]) {
      const res = await h(r);
      assertEquals(res.status, 401, spec.name);
      assertEquals(await res.json(), { code: "unauthorized" });
    }
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("update/deactivate-volunteer: 403 para guard, volunteer y sin profile (solo admin)", async () => {
  for (const { spec, body } of volunteerCases) {
    for (const role of ["guard", "volunteer", null]) {
      const f = fake({ role });
      const res = await createHandler(spec as typeof updateVolunteerSpec, f.deps)(req(body));
      assertEquals(res.status, 403, `${spec.name} role=${role}`);
      assertEquals(await res.json(), { code: "forbidden" });
      assertEquals(f.calls.length, 0);
    }
  }
});

Deno.test("update/deactivate-volunteer: el rol se revisa antes que el cuerpo (403, no 400)", async () => {
  for (const { spec } of volunteerCases) {
    const res = await createHandler(spec as typeof updateVolunteerSpec, fake({ role: "guard" }).deps)(req({}));
    assertEquals(res.status, 403, spec.name);
  }
});

Deno.test("update/deactivate-volunteer: 400 invalid_request con cuerpo invalido, sin llamar RPC", async () => {
  for (const { spec } of volunteerCases) {
    const f = fake();
    const h = createHandler(spec as typeof updateVolunteerSpec, f.deps);
    for (const r of [req({ volunteer_id: "123" }), req("{no json"), req({}, "good-token", "GET")]) {
      const res = await h(r);
      assertEquals(res.status, 400, spec.name);
      assertEquals((await res.json()).code, "invalid_request");
    }
    assertEquals(f.calls.length, 0);
  }
  const res = await createHandler(updateVolunteerSpec, fake().deps)(req({ volunteer_id: VID }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).message, "se requiere full_name o community");
});

Deno.test("update-volunteer: RPC con operator_id del JWT, null en lo que no cambia, sin campos ajenos", async () => {
  const f = fake({ user: "admin-1" });
  const h = createHandler(updateVolunteerSpec, f.deps);
  await h(req({ volunteer_id: VID, community: " Centro ", operator_id: "hacker", points: 1, is_active: false }));
  await h(req({ volunteer_id: VID, full_name: "Ana", community: "Zapopan" }));
  assertEquals(f.calls, [
    {
      fn: "update_volunteer",
      args: { p_volunteer_id: vid, p_full_name: null, p_community: "Centro", p_operator_id: "admin-1" },
    },
    {
      fn: "update_volunteer",
      args: { p_volunteer_id: vid, p_full_name: "Ana", p_community: "Zapopan", p_operator_id: "admin-1" },
    },
  ]);
});

Deno.test("deactivate-volunteer: RPC con operator_id del JWT, ignora operator_id del body", async () => {
  const f = fake({ user: "admin-1" });
  await createHandler(deactivateVolunteerSpec, f.deps)(req({ volunteer_id: VID, operator_id: "hacker" }));
  assertEquals(f.calls, [{ fn: "deactivate_volunteer", args: { p_volunteer_id: vid, p_operator_id: "admin-1" } }]);
});

Deno.test("update/deactivate-volunteer: no requieren CARD_UID_HMAC_SECRET", async () => {
  for (const { spec, body } of volunteerCases) {
    const f = fake({ secret: undefined });
    const res = await createHandler(spec as typeof updateVolunteerSpec, f.deps)(req(body));
    assertEquals(res.status, 200, spec.name);
    assertEquals(f.calls.length, 1);
  }
});

Deno.test("update/deactivate-volunteer: 200 pasa tal cual ok y volunteer_not_found", async () => {
  for (const data of [
    { code: "ok", changed_fields: ["full_name"], volunteer: { id: vid, full_name: "Ana", community: "C", is_active: true } },
    { code: "ok", already_inactive: true, volunteer: { id: vid, full_name: "Ana", is_active: false } },
    { code: "volunteer_not_found", message: "El voluntario no existe" },
  ]) {
    for (const { spec, body } of volunteerCases) {
      const res = await createHandler(spec as typeof updateVolunteerSpec, fake({ rpc: { data, error: null } }).deps)(req(body));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), data);
    }
  }
});

Deno.test("update/deactivate-volunteer: 500 generico ante error de RPC o forma inesperada", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    for (const rpc of [{ data: null, error: { code: "22023" } }, { data: "x", error: null }]) {
      for (const { spec, body } of volunteerCases) {
        const res = await createHandler(spec as typeof updateVolunteerSpec, fake({ rpc }).deps)(req(body));
        assertEquals(res.status, 500);
        assertEquals(await res.json(), { code: "server_error" });
      }
    }
  } finally {
    console.error = origError;
  }
});

// ---------------------------------------------------------------- create/update/deactivate-reward
const RID = "5D3E2A10-AAAA-4BBB-8CCC-0123456789AB";
const rid = RID.toLowerCase();
const okCreate = { name: " Playera BAMX ", description: " Talla M ", points_cost: 500, stock: 40 };

/** Valores que nunca son un entero >= 0 de Postgres. */
const BAD_INTS: unknown[] = [-1, 1.5, "10", null, true, [], {}, PG_INT_MAX + 1, 1e20, Number.MAX_SAFE_INTEGER + 2];

Deno.test("parseCreateReward: valido recorta, description opcional/vacia -> null, limites", () => {
  const r = parseCreateReward(okCreate);
  assert(r.ok);
  assertEquals(r.value, { name: "Playera BAMX", description: "Talla M", points_cost: 500, stock: 40 });

  for (const description of [undefined, null, "", "   "]) {
    const d = parseCreateReward({ ...okCreate, description });
    assert(d.ok, JSON.stringify(description));
    assertEquals(d.value.description, null);
  }

  const edges = parseCreateReward({ name: "n".repeat(120), description: "d".repeat(500), points_cost: 0, stock: PG_INT_MAX });
  assert(edges.ok);
  assertEquals([edges.value.points_cost, edges.value.stock], [0, PG_INT_MAX]);

  // campos ajenos se descartan
  const extra = parseCreateReward({ ...okCreate, is_active: false, id: RID, operator_id: "x" });
  assert(extra.ok);
  assertEquals(Object.keys(extra.value).sort(), ["description", "name", "points_cost", "stock"]);
});

Deno.test("parseCreateReward: rechaza name, description y numeros invalidos", () => {
  const bad: unknown[] = [
    null, [], "x",
    { ...okCreate, name: undefined }, { ...okCreate, name: "" }, { ...okCreate, name: "   " },
    { ...okCreate, name: "n".repeat(121) }, { ...okCreate, name: 5 },
    { ...okCreate, description: "d".repeat(501) }, { ...okCreate, description: 7 },
    { ...okCreate, points_cost: undefined }, { ...okCreate, stock: undefined },
  ];
  for (const v of BAD_INTS) bad.push({ ...okCreate, points_cost: v }, { ...okCreate, stock: v });
  for (const b of bad) assertEquals(parseCreateReward(b).ok, false, JSON.stringify(b));
});

Deno.test("parseUpdateReward: parcial, description null/vacia = borrar, ausente = no cambiar", () => {
  const stock = parseUpdateReward({ reward_id: RID, stock: 0 });
  assert(stock.ok);
  assertEquals(stock.value, { reward_id: rid, stock: 0 });

  for (const description of [null, "", "  "]) {
    const c = parseUpdateReward({ reward_id: RID, description });
    assert(c.ok);
    assertEquals(c.value, { reward_id: rid, description: null });
  }

  const all = parseUpdateReward({ reward_id: RID, name: " N ", description: " D ", points_cost: PG_INT_MAX, stock: 1, is_active: true });
  assert(all.ok);
  assertEquals(all.value, { reward_id: rid, name: "N", description: "D", points_cost: PG_INT_MAX, stock: 1 });
});

Deno.test("parseUpdateReward: rechaza id invalido, nada que cambiar y valores invalidos", () => {
  const bad: unknown[] = [
    null, {},
    { reward_id: RID },                          // nada que cambiar
    { reward_id: RID, is_active: false },        // solo campos ajenos
    { reward_id: "123", stock: 1 }, { stock: 1 },
    { reward_id: RID, name: "" }, { reward_id: RID, name: null }, { reward_id: RID, name: "n".repeat(121) },
    { reward_id: RID, description: "d".repeat(501) },
    { reward_id: RID, name: "ok", stock: -1 },   // un campo malo invalida todo
  ];
  for (const v of BAD_INTS) bad.push({ reward_id: RID, points_cost: v }, { reward_id: RID, stock: v });
  for (const b of bad) assertEquals(parseUpdateReward(b).ok, false, JSON.stringify(b));
});

Deno.test("parseDeactivateReward: solo reward_id UUID", () => {
  const r = parseDeactivateReward({ reward_id: RID, is_active: true });
  assert(r.ok);
  assertEquals(r.value, { reward_id: rid });
  for (const b of [null, {}, { reward_id: "x" }, { reward_id: 1 }, { volunteer_id: RID }]) {
    assertEquals(parseDeactivateReward(b).ok, false, JSON.stringify(b));
  }
});

const rewardCases = [
  { spec: createRewardSpec, body: okCreate },
  { spec: updateRewardSpec, body: { reward_id: RID, stock: 3 } },
  { spec: deactivateRewardSpec, body: { reward_id: RID } },
] as const;
type AnySpec = typeof createRewardSpec;

Deno.test("rewards: 401 sin token o con token invalido, sin llamar RPC", async () => {
  for (const { spec, body } of rewardCases) {
    const f = fake();
    const h = createHandler(spec as unknown as AnySpec, f.deps);
    for (const r of [req(body, null), req(body, "bad-token")]) {
      const res = await h(r);
      assertEquals(res.status, 401, spec.name);
      assertEquals(await res.json(), { code: "unauthorized" });
    }
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("rewards: 403 para guard, volunteer, rol desconocido y sin profile (solo admin)", async () => {
  for (const { spec, body } of rewardCases) {
    for (const role of ["guard", "volunteer", "superadmin", null]) {
      const f = fake({ role });
      const res = await createHandler(spec as unknown as AnySpec, f.deps)(req(body));
      assertEquals(res.status, 403, `${spec.name} role=${role}`);
      assertEquals(await res.json(), { code: "forbidden" });
      assertEquals(f.calls.length, 0);
    }
    // el rol se revisa antes que el cuerpo: un guard con cuerpo invalido recibe 403, no 400
    assertEquals((await createHandler(spec as unknown as AnySpec, fake({ role: "guard" }).deps)(req({}))).status, 403);
  }
});

Deno.test("rewards: 400 invalid_request con cuerpo invalido, sin llamar RPC", async () => {
  const invalid: Record<string, unknown[]> = {
    "create-reward": [{ ...okCreate, points_cost: -1 }, { ...okCreate, stock: 1.5 }, { ...okCreate, name: "" }],
    "update-reward": [{ reward_id: RID }, { reward_id: RID, points_cost: PG_INT_MAX + 1 }, { reward_id: "x", stock: 1 }],
    "deactivate-reward": [{}, { reward_id: "x" }],
  };
  for (const { spec } of rewardCases) {
    const f = fake();
    const h = createHandler(spec as unknown as AnySpec, f.deps);
    for (const r of [...invalid[spec.name].map((b) => req(b)), req("{no json"), req({}, "good-token", "GET")]) {
      const res = await h(r);
      assertEquals(res.status, 400, spec.name);
      const body = await res.json();
      assertEquals(body.code, "invalid_request");
      assertEquals(typeof body.message, "string");
    }
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("create-reward: RPC con valores normalizados y operator_id del JWT", async () => {
  const f = fake({ user: "admin-1", secret: undefined }); // no necesita CARD_UID_HMAC_SECRET
  const res = await createHandler(createRewardSpec, f.deps)(req({ ...okCreate, operator_id: "hacker", is_active: false }));
  assertEquals(res.status, 200);
  assertEquals(f.calls, [{
    fn: "create_reward",
    args: { p_name: "Playera BAMX", p_description: "Talla M", p_points_cost: 500, p_stock: 40, p_operator_id: "admin-1" },
  }]);
});

Deno.test("update-reward: null en lo que no cambia y p_clear_description solo con description null/vacia", async () => {
  const f = fake({ user: "admin-1" });
  const h = createHandler(updateRewardSpec, f.deps);
  await h(req({ reward_id: RID, stock: 0 }));
  await h(req({ reward_id: RID, description: "" }));
  await h(req({ reward_id: RID, name: "N", description: "D", points_cost: 1, stock: 2, operator_id: "hacker" }));
  const base = { p_reward_id: rid, p_operator_id: "admin-1" };
  assertEquals(f.calls.map((c) => c.args), [
    { ...base, p_name: null, p_description: null, p_clear_description: false, p_points_cost: null, p_stock: 0 },
    { ...base, p_name: null, p_description: null, p_clear_description: true, p_points_cost: null, p_stock: null },
    { ...base, p_name: "N", p_description: "D", p_clear_description: false, p_points_cost: 1, p_stock: 2 },
  ]);
  assert(f.calls.every((c) => c.fn === "update_reward"));
});

Deno.test("deactivate-reward: RPC solo con reward_id y operator_id del JWT", async () => {
  const f = fake({ user: "admin-1" });
  await createHandler(deactivateRewardSpec, f.deps)(req({ reward_id: RID, operator_id: "hacker" }));
  assertEquals(f.calls, [{ fn: "deactivate_reward", args: { p_reward_id: rid, p_operator_id: "admin-1" } }]);
});

Deno.test("rewards: 200 pasa tal cual ok y reward_not_found; 500 generico ante error", async () => {
  const reward = { id: rid, name: "P", description: null, points_cost: 1, stock: 1, is_active: true, created_at: "2026-10-18T00:00:00Z" };
  for (const data of [
    { code: "ok", reward },
    { code: "ok", changed_fields: ["stock"], reward },
    { code: "reward_not_found", message: "La recompensa no existe" },
  ]) {
    for (const { spec, body } of rewardCases) {
      const res = await createHandler(spec as unknown as AnySpec, fake({ rpc: { data, error: null } }).deps)(req(body));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), data);
    }
  }
  const origError = console.error;
  console.error = () => {};
  try {
    for (const { spec, body } of rewardCases) {
      const res = await createHandler(spec as unknown as AnySpec, fake({ rpc: { data: null, error: { code: "22023" } } }).deps)(req(body));
      assertEquals([res.status, await res.json()], [500, { code: "server_error" }]);
    }
  } finally {
    console.error = origError;
  }
});

// ---------------------------------------------------------------- link-volunteer-account
const LINK_VID = "f2000000-0000-0000-0000-00000000000A";
const LINK_UID = "F1000000-0000-0000-0000-00000000000A";
const okLink = { volunteer_id: LINK_VID, user_id: LINK_UID };

Deno.test("parseLinkVolunteerAccount: dos UUID en minusculas, descarta lo demas", () => {
  const r = parseLinkVolunteerAccount({ ...okLink, email: "a@b.c", full_name: "Ana", role: "volunteer" });
  assert(r.ok);
  assertEquals(r.value, { volunteer_id: LINK_VID.toLowerCase(), user_id: LINK_UID.toLowerCase() });
});

Deno.test("parseLinkVolunteerAccount: rechaza ids faltantes o invalidos (no busca por email/nombre)", () => {
  for (const bad of [
    null, [], {}, { volunteer_id: LINK_VID }, { user_id: LINK_UID },
    { ...okLink, user_id: "a@b.c" }, { ...okLink, volunteer_id: "Ana" },
    { ...okLink, user_id: null }, { ...okLink, user_id: 5 },
    { volunteer_id: LINK_VID, email: "vol-a@test.local" },
  ]) assertEquals(parseLinkVolunteerAccount(bad).ok, false, JSON.stringify(bad));
});

Deno.test("link-volunteer-account: 401 sin sesion, 403 si no es admin (antes de validar el cuerpo)", async () => {
  for (const r of [req(okLink, null), req(okLink, "bad-token")]) {
    const f = fake();
    const res = await createHandler(linkVolunteerAccountSpec, f.deps)(r);
    assertEquals([res.status, await res.json()], [401, { code: "unauthorized" }]);
    assertEquals(f.calls.length, 0);
  }
  for (const role of ["guard", "volunteer", null]) {
    for (const body of [okLink, {}]) {
      const f = fake({ role });
      const res = await createHandler(linkVolunteerAccountSpec, f.deps)(req(body));
      assertEquals([res.status, await res.json()], [403, { code: "forbidden" }], `role=${role}`);
      assertEquals(f.calls.length, 0);
    }
  }
});

Deno.test("link-volunteer-account: 400 con cuerpo invalido, sin llamar RPC", async () => {
  const f = fake();
  const h = createHandler(linkVolunteerAccountSpec, f.deps);
  for (const r of [req({ volunteer_id: LINK_VID }), req({ ...okLink, user_id: "x" }), req("{no json"), req({}, "good-token", "GET")]) {
    const res = await h(r);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).code, "invalid_request");
  }
  assertEquals(f.calls.length, 0);
});

Deno.test("link-volunteer-account: RPC con operator_id del JWT; no requiere CARD_UID_HMAC_SECRET", async () => {
  const f = fake({ user: "admin-1", secret: undefined });
  const res = await createHandler(linkVolunteerAccountSpec, f.deps)(req({ ...okLink, operator_id: "hacker" }));
  assertEquals(res.status, 200);
  assertEquals(f.calls, [{
    fn: "link_volunteer_account",
    args: { p_volunteer_id: LINK_VID.toLowerCase(), p_user_id: LINK_UID.toLowerCase(), p_operator_id: "admin-1" },
  }]);
});

Deno.test("link-volunteer-account: 200 pasa tal cual ok y cada rechazo de negocio", async () => {
  for (const data of [
    { code: "ok", already_linked: false, volunteer: { id: "v", full_name: "A", user_id: "u" } },
    { code: "ok", already_linked: true, volunteer: { id: "v", full_name: "A", user_id: "u" } },
    { code: "volunteer_not_found", message: "El voluntario no existe" },
    { code: "account_not_found", message: "La cuenta no existe" },
    { code: "account_not_volunteer", message: "La cuenta no tiene el rol volunteer" },
    { code: "volunteer_already_linked", message: "El voluntario ya esta vinculado a otra cuenta" },
    { code: "account_in_use", message: "La cuenta ya esta vinculada a otro voluntario" },
  ]) {
    const res = await createHandler(linkVolunteerAccountSpec, fake({ rpc: { data, error: null } }).deps)(req(okLink));
    assertEquals([res.status, await res.json()], [200, data]);
  }
});
