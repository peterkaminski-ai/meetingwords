// ---------------------------------------------------------------------------
// Single-owner auth, WebCrypto only (no Node dependencies).
//
// - Owner password: PBKDF2-SHA256, 210k iterations, random salt. Stored in the Registry DO
//   `settings` as `password:v1:<iterations>:<saltB64>:<hashB64>`.
// - Device tokens and API keys: 32 random bytes, base64url. Stored as plain
//   SHA-256 — their entropy is the defense; hashing only protects against a
//   leaked database, and salting adds nothing for 256-bit random values.
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 210_000;

const enc = new TextEncoder();

function toB64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64url(buf);
}

/** Short lowercase alphanumeric id (doc ids, share ids, thread ids). */
export function shortId(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += alphabet[b % alphabet.length];
  return s;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `v1:${PBKDF2_ITERATIONS}:${toB64url(salt)}:${toB64url(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const iterations = Number(parts[1]);
  const salt = fromB64url(parts[2]);
  const expected = fromB64url(parts[3]);
  const bits = new Uint8Array(await pbkdf2(password, salt, iterations));
  if (bits.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
