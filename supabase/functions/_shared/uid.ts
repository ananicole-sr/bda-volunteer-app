// Normalizacion de UID identica a frontend/src/lib/nfc/uid.ts (docs/nfc-contract.md):
// se descartan separadores (espacios, ":", "-", "_", "."), MAYUSCULAS, solo hex,
// y longitud 8, 14 o 20 caracteres (4, 7 o 10 bytes).

export const VALID_UID_LENGTHS: readonly number[] = [8, 14, 20];

const SEPARATORS = /[\s:._-]/g;
const HEX_ONLY = /^[0-9A-F]+$/;

/** Devuelve el UID normalizado, o null si no es texto, no es hex o su longitud no es valida. */
export function normalizeUid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const uid = raw.replace(SEPARATORS, "").toUpperCase();
  if (!HEX_ONLY.test(uid)) return null;
  if (!VALID_UID_LENGTHS.includes(uid.length)) return null;
  return uid;
}
