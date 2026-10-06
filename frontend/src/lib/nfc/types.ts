/**
 * Interfaz publica del modulo NFC, tal como la fija docs/nfc-contract.md.
 * El resto del frontend solo importa desde src/lib/nfc (index.ts).
 */

/** Codigos de error del contrato. No agregar ni renombrar sin cambiar el contrato. */
export type NfcErrorCode =
  | 'nfc_disabled'
  | 'cancelled'
  | 'timeout'
  | 'unsupported_tag'
  | 'unavailable';

export class NfcError extends Error {
  readonly code: NfcErrorCode;

  constructor(code: NfcErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'NfcError';
    this.code = code;
    // Hermes/ES5 rompen la cadena de prototipos al extender Error: sin esto,
    // `err instanceof NfcError` da false en el bundle de produccion.
    Object.setPrototypeOf(this, NfcError.prototype);
  }
}

export interface NfcReader {
  /** Devuelve el UID normalizado (hex mayusculas, sin separadores) o lanza NfcError. */
  readUid(): Promise<string>;
  /** Cierra la sesion NFC en curso. Seguro de llamar aunque no haya lectura activa. */
  cancel(): void;
}
