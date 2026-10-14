import { MockNfcReader } from './mock';
import { RealNfcReader } from './real';
import type { NfcReader } from './types';

export { NfcError } from './types';
export type { NfcErrorCode, NfcReader } from './types';
export { normalizeUid, VALID_UID_LENGTHS } from './uid';
export { DEFAULT_MOCK_UID, MockNfcReader } from './mock';
export { DEFAULT_READ_TIMEOUT_MS, RealNfcReader } from './real';

let reader: NfcReader | null = null;

/**
 * Devuelve el lector NFC a usar: el simulado si EXPO_PUBLIC_NFC_MOCK=1, el real
 * en caso contrario. Memoizado para que setNextUid del mock sobreviva entre
 * llamadas; EXPO_PUBLIC_* se inlinea en build, asi que no cambia en caliente.
 */
export function getNfcReader(): NfcReader {
  if (!reader) {
    reader =
      process.env.EXPO_PUBLIC_NFC_MOCK === '1' ? new MockNfcReader() : new RealNfcReader();
  }

  return reader;
}
