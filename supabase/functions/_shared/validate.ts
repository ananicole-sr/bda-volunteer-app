// Validacion de cuerpos segun docs/nfc-contract.md. Cada validador devuelve
// { ok: true, value } o { ok: false, message }.

import { normalizeUid } from "./uid.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO-8601 con hora y zona obligatoria (Z o +hh:mm): sin zona seria ambiguo.
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

function asRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

/** Texto recortado, no vacio y de maximo `max` caracteres; si no, el mensaje de error. */
function text(v: unknown, field: string, max: number): { value: string } | { ok: false; message: string } {
  if (typeof v !== "string") return fail(`${field} debe ser texto`);
  const t = v.trim();
  if (t.length === 0) return fail(`${field} no puede estar vacio`);
  if (t.length > max) return fail(`${field} excede ${max} caracteres`);
  return { value: t };
}

export interface CheckInBody {
  event_id: string;
  uid: string; // ya normalizado
  terminal_id: string;
  client_ts: string; // ISO-8601 en UTC
}

export function parseCheckIn(body: unknown): Parsed<CheckInBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  if (typeof b.event_id !== "string" || !UUID_V4.test(b.event_id)) {
    return fail("event_id debe ser un UUID v4");
  }
  const uid = normalizeUid(b.uid);
  if (uid === null) return fail("uid invalido: hex de 8, 14 o 20 caracteres");
  const terminal = text(b.terminal_id, "terminal_id", 64);
  if ("ok" in terminal) return terminal;
  if (
    typeof b.client_ts !== "string" || !ISO_TS.test(b.client_ts) ||
    Number.isNaN(Date.parse(b.client_ts))
  ) {
    return fail("client_ts debe ser ISO-8601 con zona horaria");
  }
  return {
    ok: true,
    value: {
      event_id: b.event_id.toLowerCase(),
      uid,
      terminal_id: terminal.value,
      client_ts: new Date(b.client_ts).toISOString(),
    },
  };
}

export interface EnrollBody {
  full_name: string;
  community: string;
  uid: string;
}

export function parseEnroll(body: unknown): Parsed<EnrollBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const full_name = text(b.full_name, "full_name", 120);
  if ("ok" in full_name) return full_name;
  const community = text(b.community, "community", 120);
  if ("ok" in community) return community;
  const uid = normalizeUid(b.uid);
  if (uid === null) return fail("uid invalido: hex de 8, 14 o 20 caracteres");
  return { ok: true, value: { full_name: full_name.value, community: community.value, uid } };
}

/** UUID (cualquier version) en minusculas, o el mensaje de error. */
function uuidField(v: unknown, field: string): { value: string } | { ok: false; message: string } {
  if (typeof v !== "string" || !UUID_ANY.test(v)) return fail(`${field} debe ser un UUID`);
  return { value: v.toLowerCase() };
}

/** volunteer_id valido o el mensaje de error. */
function volunteerId(v: unknown): { value: string } | { ok: false; message: string } {
  return uuidField(v, "volunteer_id");
}

export interface UpdateVolunteerBody {
  volunteer_id: string;
  full_name?: string; // ausente = no cambiar
  community?: string; // ausente = no cambiar
}

export function parseUpdateVolunteer(body: unknown): Parsed<UpdateVolunteerBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const id = volunteerId(b.volunteer_id);
  if ("ok" in id) return id;
  const value: UpdateVolunteerBody = { volunteer_id: id.value };
  if (b.full_name !== undefined) {
    const full_name = text(b.full_name, "full_name", 120);
    if ("ok" in full_name) return full_name;
    value.full_name = full_name.value;
  }
  if (b.community !== undefined) {
    const community = text(b.community, "community", 120);
    if ("ok" in community) return community;
    value.community = community.value;
  }
  if (value.full_name === undefined && value.community === undefined) {
    return fail("se requiere full_name o community");
  }
  return { ok: true, value };
}

export interface DeactivateVolunteerBody {
  volunteer_id: string;
}

export function parseDeactivateVolunteer(body: unknown): Parsed<DeactivateVolunteerBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const id = volunteerId(b.volunteer_id);
  if ("ok" in id) return id;
  return { ok: true, value: { volunteer_id: id.value } };
}

export interface IssueCardBody {
  volunteer_id: string;
  uid: string;
}

export function parseIssueCard(body: unknown): Parsed<IssueCardBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  if (typeof b.volunteer_id !== "string" || !UUID_ANY.test(b.volunteer_id)) {
    return fail("volunteer_id debe ser un UUID");
  }
  const uid = normalizeUid(b.uid);
  if (uid === null) return fail("uid invalido: hex de 8, 14 o 20 caracteres");
  return { ok: true, value: { volunteer_id: b.volunteer_id.toLowerCase(), uid } };
}

// ---------------------------------------------------------------- recompensas

/** Maximo de una columna integer de Postgres (points_cost, stock). */
export const PG_INT_MAX = 2147483647;

const REWARD_NAME_MAX = 120;
const REWARD_DESCRIPTION_MAX = 500;

/** Entero JSON (no texto, no decimal) entre 0 y PG_INT_MAX. */
function nonNegativeInt(v: unknown, field: string): { value: number } | { ok: false; message: string } {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > PG_INT_MAX) {
    return fail(`${field} debe ser un entero entre 0 y ${PG_INT_MAX}`);
  }
  return { value: v };
}

/** Texto recortado de hasta 500 caracteres; vacio o null => null (sin descripcion). */
function description(v: unknown): { value: string | null } | { ok: false; message: string } {
  if (v === null) return { value: null };
  if (typeof v !== "string") return fail("description debe ser texto o null");
  const t = v.trim();
  if (t.length > REWARD_DESCRIPTION_MAX) return fail(`description excede ${REWARD_DESCRIPTION_MAX} caracteres`);
  return { value: t === "" ? null : t };
}

export interface CreateRewardBody {
  name: string;
  description: string | null;
  points_cost: number;
  stock: number;
}

export function parseCreateReward(body: unknown): Parsed<CreateRewardBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const name = text(b.name, "name", REWARD_NAME_MAX);
  if ("ok" in name) return name;
  const desc = b.description === undefined ? { value: null } : description(b.description);
  if ("ok" in desc) return desc;
  const points_cost = nonNegativeInt(b.points_cost, "points_cost");
  if ("ok" in points_cost) return points_cost;
  const stock = nonNegativeInt(b.stock, "stock");
  if ("ok" in stock) return stock;
  return {
    ok: true,
    value: { name: name.value, description: desc.value, points_cost: points_cost.value, stock: stock.value },
  };
}

export interface UpdateRewardBody {
  reward_id: string;
  name?: string; // ausente = no cambiar
  description?: string | null; // ausente = no cambiar; null = borrar
  points_cost?: number; // ausente = no cambiar
  stock?: number; // ausente = no cambiar
}

export function parseUpdateReward(body: unknown): Parsed<UpdateRewardBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const id = uuidField(b.reward_id, "reward_id");
  if ("ok" in id) return id;
  const value: UpdateRewardBody = { reward_id: id.value };
  if (b.name !== undefined) {
    const name = text(b.name, "name", REWARD_NAME_MAX);
    if ("ok" in name) return name;
    value.name = name.value;
  }
  if (b.description !== undefined) {
    const desc = description(b.description);
    if ("ok" in desc) return desc;
    value.description = desc.value;
  }
  if (b.points_cost !== undefined) {
    const points_cost = nonNegativeInt(b.points_cost, "points_cost");
    if ("ok" in points_cost) return points_cost;
    value.points_cost = points_cost.value;
  }
  if (b.stock !== undefined) {
    const stock = nonNegativeInt(b.stock, "stock");
    if ("ok" in stock) return stock;
    value.stock = stock.value;
  }
  if (Object.keys(value).length === 1) {
    return fail("se requiere al menos uno de name, description, points_cost o stock");
  }
  return { ok: true, value };
}

export interface DeactivateRewardBody {
  reward_id: string;
}

export function parseDeactivateReward(body: unknown): Parsed<DeactivateRewardBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const id = uuidField(b.reward_id, "reward_id");
  if ("ok" in id) return id;
  return { ok: true, value: { reward_id: id.value } };
}

// ---------------------------------------------------------------- cuentas de voluntario

export interface LinkVolunteerAccountBody {
  volunteer_id: string;
  user_id: string; // auth.users.id de una cuenta que ya existe con role volunteer
}

export function parseLinkVolunteerAccount(body: unknown): Parsed<LinkVolunteerAccountBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const vid = volunteerId(b.volunteer_id);
  if ("ok" in vid) return vid;
  const uid = uuidField(b.user_id, "user_id");
  if ("ok" in uid) return uid;
  return { ok: true, value: { volunteer_id: vid.value, user_id: uid.value } };
}

// ---------------------------------------------------------------- canjes y notificaciones

/** Maximo de recompensas distintas por solicitud (igual que redemption_max_items() en SQL). */
export const REDEMPTION_MAX_ITEMS = 20;
/** Maximo de notificaciones por llamada a mark-notifications-read. */
export const NOTIFICATIONS_MAX_IDS = 100;

/** Arreglo de 1..max UUIDs, en minusculas; con `unique`, rechaza repetidos. */
function uuidList(
  v: unknown,
  field: string,
  max: number,
  unique: boolean,
): { value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(v) || v.length === 0) return fail(`${field} debe ser un arreglo no vacio`);
  if (v.length > max) return fail(`${field} admite maximo ${max} elementos`);
  const out: string[] = [];
  for (const item of v) {
    const id = uuidField(item, field);
    if ("ok" in id) return fail(`${field} debe contener solo UUIDs`);
    out.push(id.value);
  }
  const distinct = [...new Set(out)];
  if (unique && distinct.length !== out.length) return fail(`${field} no puede repetir ids`);
  return { value: distinct };
}

export interface RedeemRewardsBody {
  client_request_id: string; // UUID v4 que genera el cliente; reusarlo en los reintentos
  reward_ids: string[]; // 1 unidad de cada una
}

export function parseRedeemRewards(body: unknown): Parsed<RedeemRewardsBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  if (typeof b.client_request_id !== "string" || !UUID_V4.test(b.client_request_id)) {
    return fail("client_request_id debe ser un UUID v4");
  }
  const ids = uuidList(b.reward_ids, "reward_ids", REDEMPTION_MAX_ITEMS, true);
  if ("ok" in ids) return ids;
  return { ok: true, value: { client_request_id: b.client_request_id.toLowerCase(), reward_ids: ids.value } };
}

export interface MarkRedemptionDeliveredBody {
  request_id: string; // redemption_requests.id
}

export function parseMarkRedemptionDelivered(body: unknown): Parsed<MarkRedemptionDeliveredBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const id = uuidField(b.request_id, "request_id");
  if ("ok" in id) return id;
  return { ok: true, value: { request_id: id.value } };
}

export interface MarkNotificationsReadBody {
  notification_ids: string[] | null; // null = todas
}

export function parseMarkNotificationsRead(body: unknown): Parsed<MarkNotificationsReadBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  const hasIds = b.notification_ids !== undefined;
  const all = b.all === true;
  if (b.all !== undefined && b.all !== true) return fail("all solo admite true");
  if (hasIds === all) return fail("manda notification_ids o all: true (uno de los dos)");
  if (all) return { ok: true, value: { notification_ids: null } };
  const ids = uuidList(b.notification_ids, "notification_ids", NOTIFICATIONS_MAX_IDS, false);
  if ("ok" in ids) return ids;
  return { ok: true, value: { notification_ids: ids.value } };
}

// ---------------------------------------------------------------- alta con cuenta

/**
 * Politica minima propia; Supabase Auth aplica ADEMAS la politica que tenga
 * configurada el proyecto (y la Edge Function devuelve weak_password si la
 * rechaza). 72 bytes es el maximo que bcrypt toma en cuenta.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterVolunteerAccountBody {
  client_request_id: string;
  full_name: string;
  community: string;
  uid: string; // normalizado
  email: string; // recortado y en minusculas
  password: string; // tal cual (no se recorta); nunca se registra ni se guarda
}

export function parseRegisterVolunteerAccount(body: unknown): Parsed<RegisterVolunteerAccountBody> {
  const b = asRecord(body);
  if (!b) return fail("el cuerpo debe ser un objeto JSON");
  if (typeof b.client_request_id !== "string" || !UUID_V4.test(b.client_request_id)) {
    return fail("client_request_id debe ser un UUID v4");
  }
  const full_name = text(b.full_name, "full_name", 120);
  if ("ok" in full_name) return full_name;
  const community = text(b.community, "community", 120);
  if ("ok" in community) return community;
  const uid = normalizeUid(b.uid);
  if (uid === null) return fail("uid invalido: hex de 8, 14 o 20 caracteres");

  if (typeof b.email !== "string") return fail("email debe ser texto");
  const email = b.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return fail("email invalido");

  // Los mensajes nunca incluyen la contrasena.
  const password = b.password;
  if (typeof password !== "string") return fail("password debe ser texto");
  if (password.trim().length === 0) return fail("password no puede estar vacio");
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return fail(`password debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return fail(`password excede ${PASSWORD_MAX_BYTES} bytes`);
  }

  return {
    ok: true,
    value: {
      client_request_id: b.client_request_id.toLowerCase(),
      full_name: full_name.value,
      community: community.value,
      uid,
      email,
      password,
    },
  };
}
