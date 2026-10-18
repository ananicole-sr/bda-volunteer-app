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

/** volunteer_id valido o el mensaje de error. */
function volunteerId(v: unknown): { value: string } | { ok: false; message: string } {
  if (typeof v !== "string" || !UUID_ANY.test(v)) return fail("volunteer_id debe ser un UUID");
  return { value: v.toLowerCase() };
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
