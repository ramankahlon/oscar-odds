import { describe, it, expect } from "vitest";
import {
  hashPassphrase,
  verifyPassphrase,
  generateSessionToken,
  sessionExpiresAt,
  isSessionExpired,
  SESSION_TTL_MS,
  SESSION_COOKIE,
} from "./auth-utils.js";

describe("hashPassphrase / verifyPassphrase", () => {
  it("correct passphrase verifies", async () => {
    const hash = await hashPassphrase("correct-horse-battery");
    expect(await verifyPassphrase("correct-horse-battery", hash)).toBe(true);
  });

  it("wrong passphrase fails", async () => {
    const hash = await hashPassphrase("correct-horse-battery");
    expect(await verifyPassphrase("wrong-passphrase", hash)).toBe(false);
  });

  it("hash starts with $2b$", async () => {
    const hash = await hashPassphrase("test-pass-word");
    expect(hash.startsWith("$2b$")).toBe(true);
  });
});

describe("generateSessionToken", () => {
  it("returns 64-char hex string", () => {
    const token = generateSessionToken();
    expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
  });

  it("tokens are unique", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).not.toBe(t2);
  });
});

describe("sessionExpiresAt / isSessionExpired", () => {
  it("sessionExpiresAt is ~7 days out", () => {
    const before = Date.now();
    const expires = sessionExpiresAt();
    const after = Date.now();
    expect(expires.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(expires.getTime()).toBeLessThanOrEqual(after + SESSION_TTL_MS);
  });

  it("past ISO string is expired", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isSessionExpired(past)).toBe(true);
  });

  it("future ISO string is not expired", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isSessionExpired(future)).toBe(false);
  });
});

describe("constants", () => {
  it("SESSION_COOKIE is 'oscar_session'", () => {
    expect(SESSION_COOKIE).toBe("oscar_session");
  });

  it("SESSION_TTL_MS is 604800000", () => {
    expect(SESSION_TTL_MS).toBe(604_800_000);
  });
});
