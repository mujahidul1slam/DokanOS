// Dev-only TOTP generator (RFC 6238, HMAC-SHA1) for e2e tests — not used in prod.
// Used by the W9 e2e runbook to drive enroll → challenge → verify on the local stack.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function generateTotp(
  secretBase32: string,
  digits = 6,
  period = 30,
  at: number = Date.now(),
): Promise<string> {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / period);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // big-endian 64-bit counter; high 32 bits stay zero for practical counters
  view.setUint32(0, 0);
  view.setUint32(4, counter);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
  const offset = sig[sig.length - 1] & 0xf;
  const code =
    ((sig[offset] & 0x7f) << 24) |
    (sig[offset + 1] << 16) |
    (sig[offset + 2] << 8) |
    sig[offset + 3];
  return (code % 10 ** digits).toString().padStart(digits, "0");
}