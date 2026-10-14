// uid_hmac = hex(HMAC-SHA256(clave = CARD_UID_HMAC_SECRET, mensaje = UID normalizado
// como TEXTO en mayusculas, UTF-8)). Debe coincidir exactamente con
//   encode(extensions.hmac(upper(uid), secreto, 'sha256'), 'hex')
// que usan el backfill de 002_nfc_security.sql y el seed.

const encoder = new TextEncoder();

export async function uidHmac(normalizedUid: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(normalizedUid.toUpperCase()));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
