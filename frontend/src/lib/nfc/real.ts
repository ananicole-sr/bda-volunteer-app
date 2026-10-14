import { Platform } from 'react-native';

import { NfcError, type NfcReader } from './types';
import { normalizeUid } from './uid';

/** Tiempo maximo de espera de una tarjeta, en ms (contrato: code 'timeout'). */
export const DEFAULT_READ_TIMEOUT_MS = 15_000;

/** NfcTech.NfcA de react-native-nfc-manager. Solo lee tag.id: no hace falta autenticar MIFARE Classic. */
const TECH_NFC_A = 'NfcA';
/** NfcAdapter.FLAG_READER_NFC_A | FLAG_READER_SKIP_NDEF_CHECK (reader mode de Android). */
const READER_FLAGS = 0x1 | 0x80;

/** Subconjunto de react-native-nfc-manager que usa el lector (permite simularlo en pruebas). */
export interface NfcLib {
  start(): Promise<void>;
  isSupported(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  requestTechnology(
    tech: string,
    options?: { isReaderModeEnabled?: boolean; readerModeFlags?: number; alertMessage?: string }
  ): Promise<unknown>;
  getTag(): Promise<{ id?: string } | null>;
  cancelTechnologyRequest(options?: { throwOnError?: boolean }): Promise<void>;
}

export interface RealNfcReaderOptions {
  /** Carga la libreria; por defecto un require() perezoso de react-native-nfc-manager. */
  loadLib?: () => NfcLib;
  timeoutMs?: number;
  /** Plataforma; por defecto Platform.OS. Solo Android esta verificado. */
  platform?: string;
}

function defaultLoadLib(): NfcLib {
  // require perezoso: si el modulo nativo no existe (Expo Go, web) el import no revienta la app.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-nfc-manager');
  const lib = mod?.default ?? mod;
  if (!lib || typeof lib.requestTechnology !== 'function') {
    throw new Error('react-native-nfc-manager no disponible');
  }
  return lib as NfcLib;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : '';
}

/** Traduce un fallo de la libreria a un NfcError del contrato. */
function mapLibError(e: unknown): NfcError {
  if (e instanceof NfcError) return e;
  const msg = messageOf(e);
  if (/cancel/i.test(msg) || (e as Error | undefined)?.name === 'UserCancel') {
    return new NfcError('cancelled', 'Lectura cancelada');
  }
  if (/disabled|radio|turned off/i.test(msg)) {
    return new NfcError('nfc_disabled', 'NFC apagado');
  }
  if (/timeout|timed out/i.test(msg)) {
    return new NfcError('timeout', 'Tiempo de espera agotado');
  }
  // Tecnologia no soportada por la tarjeta, tarjeta retirada a media lectura, etc.
  return new NfcError('unsupported_tag', 'No se pudo leer la tarjeta (tecnologia no soportada)');
}

/**
 * Lector NFC real (Android) basado en react-native-nfc-manager. Lee tag.id con
 * NfcA, asi que funciona aunque el telefono no soporte MIFARE Classic.
 */
export class RealNfcReader implements NfcReader {
  private readonly loadLib: () => NfcLib;
  private readonly timeoutMs: number;
  private readonly platform: string;

  private lib: NfcLib | null = null;
  private started = false;
  private abort: (() => void) | null = null;
  /** Limpieza (cancelTechnologyRequest) de la lectura anterior; la siguiente la espera. */
  private cleanup: Promise<void> = Promise.resolve();

  constructor(options: RealNfcReaderOptions = {}) {
    this.loadLib = options.loadLib ?? defaultLoadLib;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this.platform = options.platform ?? Platform.OS;
  }

  async readUid(): Promise<string> {
    if (this.platform !== 'android') {
      throw new NfcError('unavailable', 'Lectura NFC solo verificada en Android');
    }

    // Una sola lectura a la vez: la anterior se cancela.
    this.abort?.();
    this.abort = null;
    await this.cleanup;

    const lib = await this.prepare();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void lib.cancelTechnologyRequest().catch(() => {});
        reject(new NfcError('timeout', `Sin tarjeta tras ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.abort = () => reject(new NfcError('cancelled', 'Lectura cancelada'));
    });
    // Evita "unhandled rejection" si la lectura termina antes de que `aborted` se rechace.
    aborted.catch(() => {});

    const request = lib.requestTechnology(TECH_NFC_A, {
      isReaderModeEnabled: true,
      readerModeFlags: READER_FLAGS,
    });
    request.catch(() => {}); // idem si pierde la carrera

    try {
      await Promise.race([request, aborted]);
      const tag = await Promise.race([lib.getTag(), aborted]);
      if (!tag?.id) {
        throw new NfcError('unsupported_tag', 'La tarjeta no expone UID');
      }
      return normalizeUid(tag.id);
    } catch (e) {
      throw mapLibError(e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.abort = null;
      // Siempre se libera la sesion; la siguiente lectura espera a que termine.
      this.cleanup = lib.cancelTechnologyRequest().catch(() => {});
    }
  }

  cancel(): void {
    this.abort?.();
    this.abort = null;
    // Libera la sesion aunque la lectura ya hubiera terminado o nunca empezado.
    if (this.lib) {
      this.cleanup = this.lib.cancelTechnologyRequest().catch(() => {});
    }
  }

  /** Carga la libreria, la inicia una vez y comprueba hardware y NFC encendido. */
  private async prepare(): Promise<NfcLib> {
    let enabled: boolean;
    try {
      this.lib ??= this.loadLib();
      if (!this.started) {
        await this.lib.start();
        this.started = true;
      }
      if (!(await this.lib.isSupported())) {
        throw new NfcError('unavailable', 'Este dispositivo no tiene NFC');
      }
      enabled = await this.lib.isEnabled();
    } catch (e) {
      if (e instanceof NfcError) throw e;
      throw new NfcError('unavailable', 'Libreria NFC no disponible');
    }
    if (!enabled) {
      throw new NfcError('nfc_disabled', 'NFC apagado');
    }
    return this.lib;
  }
}
