import { NfcError } from './types';

/** Longitudes validas en caracteres hex: 4, 7 o 10 bytes (contrato "## UID"). */
export const VALID_UID_LENGTHS: readonly number[] = [8, 14, 20];

/** Separadores que se aceptan en la entrada y se descartan: ":", "-", "_", ".", espacios. */
const SEPARATORS = /[\s:._-]/g;
const HEX_ONLY = /^[0-9A-F]+$/;

/**
 * Normaliza un UID: acepta cualquier caso y con o sin separadores, y devuelve
 * hex en MAYUSCULAS sin separadores.
 *
 * @throws NfcError con code 'unsupported_tag' si no es hex o si la longitud no
 * es 8, 14 o 20 caracteres. Se usa ese code porque el caso real que lo dispara
 * es una tarjeta con un UID que el contrato no cubre.
 */
export function normalizeUid(raw: string): string {
  if (typeof raw !== 'string') {
    throw new NfcError('unsupported_tag', 'UID vacio o no textual');
  }

  const uid = raw.replace(SEPARATORS, '').toUpperCase();

  if (!HEX_ONLY.test(uid)) {
    throw new NfcError('unsupported_tag', 'El UID debe ser hexadecimal');
  }

  if (!VALID_UID_LENGTHS.includes(uid.length)) {
    throw new NfcError(
      'unsupported_tag',
      `Longitud de UID invalida (${uid.length}); se esperan 8, 14 o 20 caracteres hex`
    );
  }

  return uid;
}
