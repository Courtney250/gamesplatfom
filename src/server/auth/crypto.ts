import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 64;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };
function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) throw new Error("Password must be 12 to 128 characters.");
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, nText, rText, pText, saltHex, keyHex] = encoded.split("$");
    if (algorithm !== "scrypt" || !nText || !rText || !pText || !saltHex || !keyHex || !/^(?:[\da-f]{2})+$/i.test(saltHex + keyHex)) return false;
    const n = Number(nText), r = Number(rText), p = Number(pText);
    if (n < 16_384 || n > 131_072 || r !== 8 || p !== 1) return false;
    const expected = Buffer.from(keyHex, "hex");
    const salt = Buffer.from(saltHex, "hex");
    if (expected.length !== KEY_BYTES || salt.length < 16 || salt.length > 64) return false;
    const actual = await derive(password, salt, expected.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string): Buffer { return createHash("sha256").update(token, "utf8").digest(); }
export function createSessionSecret(): string { return randomBytes(32).toString("base64url"); }
