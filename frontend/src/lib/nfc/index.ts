import { MockNfcReader } from './mock';
import { NfcError, type NfcReader } from './types';

export { NfcError } from './types';
export type { NfcErrorCode, NfcReader } from './types';
export { normalizeUid, VALID_UID_LENGTHS } from './uid';
export { DEFAULT_MOCK_UID, MockNfcReader } from './mock';

/**
 * Marcador de posicion hasta que la Fase 3 traiga el lector real
 * (react-native-nfc-manager). Cumple la interfaz del contrato fallando con
 * code 'unavailable' en vez de reventar en el import.
 */
class UnavailableNfcReader implements NfcReader {
  readUid(): Promise<string> {
    return Promise.reject(
      new NfcError('unavailable', 'Lector NFC real no implementado todavia (Fase 3)')
    );
  }

  cancel(): void {
    // Nada que liberar: nunca se abrio una sesion.
  }
}

let reader: NfcReader | null = null;

/**
 * Devuelve el lector NFC a usar: el simulado si EXPO_PUBLIC_NFC_MOCK=1, el real
 * en caso contrario. Memoizado para que setNextUid del mock sobreviva entre
 * llamadas; EXPO_PUBLIC_* se inlinea en build, asi que no cambia en caliente.
 */
export function getNfcReader(): NfcReader {
  if (!reader) {
    reader =
      process.env.EXPO_PUBLIC_NFC_MOCK === '1' ? new MockNfcReader() : new UnavailableNfcReader();
  }

  return reader;
}
