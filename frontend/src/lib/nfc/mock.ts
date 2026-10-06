import type { NfcReader } from './types';
import { normalizeUid } from './uid';

/** UID de prueba por defecto (4 bytes) que devuelve el lector simulado. */
export const DEFAULT_MOCK_UID = '04A1B2C3';

/**
 * Lector simulado para desarrollo sin tarjeta ni dispositivo.
 * Se activa con EXPO_PUBLIC_NFC_MOCK=1 (ver getNfcReader en index.ts).
 */
export class MockNfcReader implements NfcReader {
  private nextUid: string = DEFAULT_MOCK_UID;

  /**
   * Fija el UID de la siguiente lectura. Se guarda tal cual: la normalizacion
   * (y su NfcError) ocurre en readUid, como con el lector real, para poder
   * simular tambien tarjetas con UID invalido.
   */
  setNextUid(uid: string): void {
    this.nextUid = uid;
  }

  readUid(): Promise<string> {
    return Promise.resolve(normalizeUid(this.nextUid));
  }

  cancel(): void {
    // El lector simulado no abre ninguna sesion NFC: nada que liberar.
  }
}
