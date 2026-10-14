/// <reference types="jest" />
import { MockNfcReader, NfcError, normalizeUid, RealNfcReader } from '..';
import type { NfcLib } from '../real';

/** Libreria simulada: cada metodo se puede reemplazar por prueba. */
function fakeLib(over: Partial<NfcLib> = {}): jest.Mocked<NfcLib> {
  return {
    start: jest.fn().mockResolvedValue(undefined),
    isSupported: jest.fn().mockResolvedValue(true),
    isEnabled: jest.fn().mockResolvedValue(true),
    requestTechnology: jest.fn().mockResolvedValue('NfcA'),
    getTag: jest.fn().mockResolvedValue({ id: '04a1b2c3' }),
    cancelTechnologyRequest: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as jest.Mocked<NfcLib>;
}

const reader = (lib: NfcLib, opts: { timeoutMs?: number; platform?: string } = {}) =>
  new RealNfcReader({ loadLib: () => lib, platform: 'android', ...opts });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(NfcError);
    return (e as NfcError).code;
  }
  throw new Error('se esperaba un NfcError');
}

describe('normalizeUid', () => {
  it('acepta separadores y minusculas', () => {
    expect(normalizeUid('04:a1-b2_c3')).toBe('04A1B2C3');
    expect(normalizeUid(' 04 a1 b2 c3 d4 e5 f6 ')).toBe('04A1B2C3D4E5F6');
    expect(normalizeUid('04A1B2C3D4E5F6A7B8C9')).toHaveLength(20);
  });

  it.each(['', '04A1B2', '04A1B2C3D4', 'ZZZZZZZZ', '04A1B2C3D4E5F6A7B8C9D0'])(
    'rechaza %p con unsupported_tag',
    (bad) => {
      expect(() => normalizeUid(bad)).toThrow(NfcError);
      try {
        normalizeUid(bad);
      } catch (e) {
        expect((e as NfcError).code).toBe('unsupported_tag');
      }
    }
  );
});

describe('RealNfcReader', () => {
  it('lee tag.id con NfcA y lo devuelve normalizado', async () => {
    const lib = fakeLib();
    await expect(reader(lib).readUid()).resolves.toBe('04A1B2C3');
    expect(lib.requestTechnology).toHaveBeenCalledWith('NfcA', expect.objectContaining({ isReaderModeEnabled: true }));
  });

  it('siempre llama cancelTechnologyRequest (exito y error)', async () => {
    const ok = fakeLib();
    await reader(ok).readUid();
    expect(ok.cancelTechnologyRequest).toHaveBeenCalled();

    const bad = fakeLib({ getTag: jest.fn().mockResolvedValue({ id: 'XYZ' }) });
    await codeOf(reader(bad).readUid());
    expect(bad.cancelTechnologyRequest).toHaveBeenCalled();
  });

  it('UID de longitud invalida -> unsupported_tag', async () => {
    const lib = fakeLib({ getTag: jest.fn().mockResolvedValue({ id: '04A1B2C3D4' }) });
    expect(await codeOf(reader(lib).readUid())).toBe('unsupported_tag');
  });

  it('tag sin id -> unsupported_tag', async () => {
    expect(await codeOf(reader(fakeLib({ getTag: jest.fn().mockResolvedValue(null) })).readUid())).toBe('unsupported_tag');
  });

  it('tecnologia no soportada por la tarjeta -> unsupported_tag', async () => {
    const lib = fakeLib({ requestTechnology: jest.fn().mockRejectedValue(new Error('fail to connect')) });
    expect(await codeOf(reader(lib).readUid())).toBe('unsupported_tag');
  });

  it('NFC apagado -> nfc_disabled (sin abrir sesion)', async () => {
    const lib = fakeLib({ isEnabled: jest.fn().mockResolvedValue(false) });
    expect(await codeOf(reader(lib).readUid())).toBe('nfc_disabled');
    expect(lib.requestTechnology).not.toHaveBeenCalled();
  });

  it('sin hardware NFC -> unavailable', async () => {
    const lib = fakeLib({ isSupported: jest.fn().mockResolvedValue(false) });
    expect(await codeOf(reader(lib).readUid())).toBe('unavailable');
  });

  it('libreria que no carga o falla en start -> unavailable', async () => {
    const noLib = new RealNfcReader({ platform: 'android', loadLib: () => { throw new Error('no native module'); } });
    expect(await codeOf(noLib.readUid())).toBe('unavailable');
    const badStart = fakeLib({ start: jest.fn().mockRejectedValue(new Error('boom')) });
    expect(await codeOf(reader(badStart).readUid())).toBe('unavailable');
  });

  it('plataforma distinta de Android -> unavailable', async () => {
    expect(await codeOf(reader(fakeLib(), { platform: 'ios' }).readUid())).toBe('unavailable');
  });

  it('cancelacion de la libreria (UserCancel) -> cancelled', async () => {
    const lib = fakeLib({ requestTechnology: jest.fn().mockRejectedValue(new Error('cancelled')) });
    expect(await codeOf(reader(lib).readUid())).toBe('cancelled');
  });

  it('cancel() durante la espera -> cancelled y libera la sesion', async () => {
    const lib = fakeLib({ requestTechnology: jest.fn(() => new Promise(() => {})) });
    const r = reader(lib);
    const p = codeOf(r.readUid());
    await new Promise((res) => setTimeout(res, 0));
    r.cancel();
    expect(await p).toBe('cancelled');
    expect(lib.cancelTechnologyRequest).toHaveBeenCalled();
  });

  it('cancel() sin lectura activa es seguro', () => {
    expect(() => reader(fakeLib()).cancel()).not.toThrow();
    expect(() => new RealNfcReader({ platform: 'android' }).cancel()).not.toThrow();
  });

  describe('timeout', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sin tarjeta tras timeoutMs -> timeout y cancelTechnologyRequest', async () => {
      const lib = fakeLib({ requestTechnology: jest.fn(() => new Promise(() => {})) });
      const p = codeOf(reader(lib, { timeoutMs: 15_000 }).readUid());
      await jest.advanceTimersByTimeAsync(14_999);
      expect(lib.cancelTechnologyRequest).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(await p).toBe('timeout');
      expect(lib.cancelTechnologyRequest).toHaveBeenCalled();
    });

    it('el timeout por defecto es de 15 s', async () => {
      const lib = fakeLib({ requestTechnology: jest.fn(() => new Promise(() => {})) });
      const p = codeOf(new RealNfcReader({ platform: 'android', loadLib: () => lib }).readUid());
      await jest.advanceTimersByTimeAsync(15_000);
      expect(await p).toBe('timeout');
    });
  });
});

describe('MockNfcReader', () => {
  it('devuelve el UID fijado y valida como el lector real', async () => {
    const m = new MockNfcReader();
    m.setNextUid('aa:bb:cc:dd');
    await expect(m.readUid()).resolves.toBe('AABBCCDD');
    m.setNextUid('123');
    await expect(m.readUid()).rejects.toMatchObject({ code: 'unsupported_tag' });
  });
});
