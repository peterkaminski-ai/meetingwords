import { describe, expect, it } from "vitest";
import {
  BASE_LOCK_SECONDS,
  FREE_ATTEMPTS,
  MAX_LOCK_SECONDS,
  SETUP_TOKEN_TTL_HOURS,
  lockRemaining,
  parseThrottle,
  recordFailure,
  serializeThrottle,
  setupTokenExpiry,
  setupTokenFresh,
  type ThrottleState,
} from "../src/auth-throttle";

const T0 = new Date("2026-07-04T12:00:00Z");

function fail(times: number, state: ThrottleState = { failures: 0, lockedUntil: null }, now = T0): ThrottleState {
  for (let i = 0; i < times; i++) state = recordFailure(state, now);
  return state;
}

describe("password throttle", () => {
  it("starts open from empty or absent state", () => {
    expect(parseThrottle(null)).toEqual({ failures: 0, lockedUntil: null });
    expect(lockRemaining(parseThrottle(null), T0)).toBe(0);
  });

  it("survives serialize/parse round-trip", () => {
    const state = fail(FREE_ATTEMPTS + 2);
    expect(parseThrottle(serializeThrottle(state))).toEqual(state);
  });

  it("treats garbage state as open rather than locking the owner out", () => {
    expect(parseThrottle("not json")).toEqual({ failures: 0, lockedUntil: null });
    expect(parseThrottle('{"failures":-3}')).toEqual({ failures: 0, lockedUntil: null });
    expect(parseThrottle('{"failures":"many","lockedUntil":42}')).toEqual({ failures: 0, lockedUntil: null });
  });

  it("gives the owner typo room: no lock through the free attempts", () => {
    const state = fail(FREE_ATTEMPTS);
    expect(state.failures).toBe(FREE_ATTEMPTS);
    expect(state.lockedUntil).toBeNull();
    expect(lockRemaining(state, T0)).toBe(0);
  });

  it("locks on the first failure past the free attempts", () => {
    const state = fail(FREE_ATTEMPTS + 1);
    expect(lockRemaining(state, T0)).toBe(BASE_LOCK_SECONDS);
  });

  it("doubles the lock with each further failure", () => {
    expect(lockRemaining(fail(FREE_ATTEMPTS + 2), T0)).toBe(BASE_LOCK_SECONDS * 2);
    expect(lockRemaining(fail(FREE_ATTEMPTS + 3), T0)).toBe(BASE_LOCK_SECONDS * 4);
    expect(lockRemaining(fail(FREE_ATTEMPTS + 4), T0)).toBe(BASE_LOCK_SECONDS * 8);
  });

  it("caps the lock at the maximum", () => {
    const state = fail(FREE_ATTEMPTS + 50);
    expect(lockRemaining(state, T0)).toBe(MAX_LOCK_SECONDS);
  });

  it("reopens after the lock expires, and the next failure locks longer", () => {
    const locked = fail(FREE_ATTEMPTS + 1);
    const later = new Date(T0.getTime() + (BASE_LOCK_SECONDS + 1) * 1000);
    expect(lockRemaining(locked, later)).toBe(0);
    const relocked = recordFailure(locked, later);
    expect(lockRemaining(relocked, later)).toBe(BASE_LOCK_SECONDS * 2);
  });

  it("rounds partial seconds up so Retry-After is never 0 while locked", () => {
    const locked = fail(FREE_ATTEMPTS + 1);
    const almostOver = new Date(T0.getTime() + BASE_LOCK_SECONDS * 1000 - 1);
    expect(lockRemaining(locked, almostOver)).toBe(1);
  });

  it("ignores an unparseable lockedUntil (open, not stuck)", () => {
    expect(lockRemaining({ failures: 9, lockedUntil: "someday" }, T0)).toBe(0);
  });
});

describe("setup-token freshness", () => {
  it("has no deadline when no expiry is recorded (env SETUP_TOKEN, legacy hashes)", () => {
    expect(setupTokenFresh(null, T0)).toBe(true);
  });

  it("is fresh before the deadline and stale after", () => {
    const expires = setupTokenExpiry(T0);
    expect(setupTokenFresh(expires, new Date(T0.getTime() + 1000))).toBe(true);
    const deadline = T0.getTime() + SETUP_TOKEN_TTL_HOURS * 3600 * 1000;
    expect(setupTokenFresh(expires, new Date(deadline - 1))).toBe(true);
    expect(setupTokenFresh(expires, new Date(deadline))).toBe(false);
    expect(setupTokenFresh(expires, new Date(deadline + 1))).toBe(false);
  });

  it("fails closed on an unreadable deadline", () => {
    expect(setupTokenFresh("not a date", T0)).toBe(false);
  });
});
