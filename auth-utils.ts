import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

export const BCRYPT_ROUNDS  = 12;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_COOKIE = "oscar_session";
export const CSRF_COOKIE    = "oscar_csrf";

export async function hashPassphrase(p: string): Promise<string> {
  return bcrypt.hash(p, BCRYPT_ROUNDS);
}

export async function verifyPassphrase(p: string, hash: string): Promise<boolean> {
  return bcrypt.compare(p, hash);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex"); // 64-char hex = 256-bit entropy
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex"); // 256-bit entropy, same as session tokens
}

export function sessionExpiresAt(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export function isSessionExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
