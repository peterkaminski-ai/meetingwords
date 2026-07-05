// ---------------------------------------------------------------------------
// Global backoff for password attempts, and setup-token freshness.
//
// Single-owner instance, so the throttle is deliberately global rather than
// per-IP: there is exactly one password to guess, and a distributed guesser
// must not do better than a local one. The first FREE_ATTEMPTS consecutive
// failures cost nothing (typo room for the owner); each failure past that
// locks all password endpoints for BASE_LOCK_SECONDS doubling per failure,
// capped at MAX_LOCK_SECONDS. Any successful login clears the counter.
//
// State is one JSON value in the Registry `settings` (key `login_throttle`).
// The worker read-modify-writes it around each verification; concurrent
// requests can lose an increment to the race, which widens the throttle by
// at most one attempt — acceptable for a lockout, so no atomicity ceremony.
// ---------------------------------------------------------------------------

export const LOGIN_THROTTLE_KEY = "login_throttle";
export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_SECONDS = 30;
export const MAX_LOCK_SECONDS = 900; // 15 minutes

export type ThrottleState = {
  failures: number;
  lockedUntil: string | null; // ISO timestamp, or null when not locked
};

export function parseThrottle(raw: string | null): ThrottleState {
  if (!raw) return { failures: 0, lockedUntil: null };
  try {
    const parsed = JSON.parse(raw) as Partial<ThrottleState>;
    const failures = Number(parsed.failures);
    const lockedUntil = typeof parsed.lockedUntil === "string" ? parsed.lockedUntil : null;
    if (!Number.isInteger(failures) || failures < 0) return { failures: 0, lockedUntil: null };
    return { failures, lockedUntil };
  } catch {
    return { failures: 0, lockedUntil: null };
  }
}

export function serializeThrottle(state: ThrottleState): string {
  return JSON.stringify(state);
}

/** Seconds until password endpoints reopen; 0 when open. */
export function lockRemaining(state: ThrottleState, now: Date): number {
  if (!state.lockedUntil) return 0;
  const until = Date.parse(state.lockedUntil);
  if (Number.isNaN(until)) return 0;
  return Math.max(0, Math.ceil((until - now.getTime()) / 1000));
}

/** Record one failed password attempt and compute any new lock. */
export function recordFailure(state: ThrottleState, now: Date): ThrottleState {
  const failures = state.failures + 1;
  if (failures <= FREE_ATTEMPTS) return { failures, lockedUntil: null };
  const lockSeconds = Math.min(BASE_LOCK_SECONDS * 2 ** (failures - FREE_ATTEMPTS - 1), MAX_LOCK_SECONDS);
  return { failures, lockedUntil: new Date(now.getTime() + lockSeconds * 1000).toISOString() };
}

// -- setup-token freshness ------------------------------------------------------
//
// Fleet-issued setup tokens (stored as `setup_token_hash` + `setup_token_expires`)
// travel in a URL, so they get a TTL. No expiry recorded means no deadline —
// that covers deploy-time env SETUP_TOKEN (config, not a secret in flight) and
// hashes stored before TTLs existed. An expired token fails closed: setup stays
// token-gated until a fresh fleet reset issues a new one.

export const SETUP_TOKEN_EXPIRES_KEY = "setup_token_expires";
export const SETUP_TOKEN_TTL_HOURS = 24;

export function setupTokenFresh(expiresRaw: string | null, now: Date): boolean {
  if (!expiresRaw) return true;
  const expires = Date.parse(expiresRaw);
  if (Number.isNaN(expires)) return false; // unreadable deadline: fail closed
  return now.getTime() < expires;
}

export function setupTokenExpiry(now: Date): string {
  return new Date(now.getTime() + SETUP_TOKEN_TTL_HOURS * 3600 * 1000).toISOString();
}
