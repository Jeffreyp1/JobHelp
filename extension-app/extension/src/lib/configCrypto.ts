/**
 * Optional encryption-at-rest helpers for the Drive-hosted
 * `jobhelp-config.json`.
 *
 * The encrypted blob is self-contained except for the user passphrase. Binary
 * fields are base64-encoded so callers can embed the blob directly in JSON.
 */

/** PBKDF2 iteration count. OWASP 2023 minimum for PBKDF2-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;

/** Length of the per-encryption salt, in bytes. */
export const SALT_BYTES = 16;

/** Length of the per-encryption AES-GCM initialization vector, in bytes. */
export const IV_BYTES = 12;

/** AES key length, in bits. */
export const AES_KEY_BITS = 256;

/**
 * Serialized encrypted payload. All four fields are required for decryption.
 *
 * Binary fields are base64-encoded (no `Buffer` dependency — uses
 * `btoa`/`atob` so this works unchanged in Chrome MV3 service workers, the
 * sidepanel, and Node test envs).
 *
 * The `iterations` field travels with the blob so that future increases to
 * `PBKDF2_ITERATIONS` (e.g. when OWASP raises the floor) do not invalidate
 * older blobs — `decryptString` uses the blob's stored iteration count.
 */
export interface EncryptedBlob {
  /** AES-GCM ciphertext (includes the 16-byte auth tag appended by GCM). */
  ciphertext: string;
  /** 12-byte AES-GCM initialization vector. */
  iv: string;
  /** 16-byte PBKDF2 salt. */
  salt: string;
  /** PBKDF2 iteration count used to derive the AES key. */
  iterations: number;
}

/**
 * Thrown by `decryptString` when the passphrase is wrong, the ciphertext is
 * tampered with, or the blob is structurally invalid. Callers can catch this
 * to render a "wrong passphrase or corrupted config" message without leaking
 * the underlying Web Crypto error (which is uniformly opaque anyway — GCM
 * deliberately gives the same error for wrong-key and tampered-data to
 * prevent oracle attacks).
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
    Object.setPrototypeOf(this, CryptoError.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base64 helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode a Uint8Array as base64. Uses `btoa` (available in browsers, Chrome
 * extension contexts including MV3 service workers, and Node 16+).
 *
 * We chunk to avoid the call-stack limit on `String.fromCharCode(...arr)` for
 * large inputs — relevant because the API key itself is short, but long
 * arbitrary plaintexts (e.g. an entire config blob, in a possible future use)
 * could exceed the spread-operator limit (~125k args on V8).
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to a Uint8Array. Throws if the input is not valid
 * base64 (we wrap the underlying DOMException in a CryptoError so callers
 * only need one catch).
 */
function base64ToBytes(b64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64);
  } catch (err) {
    throw new CryptoError(
      `Invalid base64 in encrypted blob: ${(err as Error)?.message ?? "unknown"}`,
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the SubtleCrypto instance, or throw a clear error if Web Crypto is
 * unavailable. Web Crypto is present in Chrome MV3 (service workers + DOM)
 * and in Node 16+ (`globalThis.crypto`), so this should never throw in our
 * supported environments — but we want a non-cryptic message if someone
 * runs the extension in a stripped-down sandbox.
 */
function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CryptoError(
      "Web Crypto API (crypto.subtle) is not available in this environment.",
    );
  }
  return subtle;
}

/**
 * Derive an AES-GCM 256-bit key from a passphrase using PBKDF2-SHA256.
 *
 * Steps:
 *   1. Import the passphrase as a raw "key material" object (Web Crypto
 *      requires this — you cannot pass a string directly to `deriveKey`).
 *   2. Derive 256 bits of AES key material via PBKDF2 with the given salt
 *      and iteration count.
 *   3. Return the derived AES-GCM CryptoKey, marked as `extractable: false`
 *      so it cannot be accidentally serialized out of the runtime.
 */
async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = getSubtle();

  const passBytes = new TextEncoder().encode(passphrase);
  const keyMaterial = await subtle.importKey(
    "raw",
    passBytes as BufferSource,
    { name: "PBKDF2" },
    false, // not extractable — passphrase bytes never leave the crypto layer
    ["deriveKey"],
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false, // derived key not extractable
    ["encrypt", "decrypt"],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt `plaintext` with `passphrase` and return a serialized
 * `EncryptedBlob`. Each call generates fresh random salt + IV, so two
 * encryptions of the same plaintext with the same passphrase produce
 * different ciphertexts (a property tests assert).
 *
 * @param plaintext  UTF-8 string to encrypt (typically the Anthropic API key).
 * @param passphrase User-chosen passphrase. No length / complexity check —
 *                   that's a UI concern. We recommend ≥12 chars in the docs.
 * @returns The EncryptedBlob, ready to be JSON-serialized.
 */
export async function encryptString(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedBlob> {
  const subtle = getSubtle();

  // Generate fresh random salt + IV for this encryption.
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintextBytes as BufferSource,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypt an `EncryptedBlob` with `passphrase` and return the original
 * UTF-8 plaintext.
 *
 * Throws `CryptoError` if:
 *   - The passphrase is wrong (AES-GCM authentication fails).
 *   - The ciphertext / IV / salt has been tampered with (AES-GCM auth fails).
 *   - The blob is structurally invalid (missing fields, non-base64 fields,
 *     non-positive iteration count).
 *
 * Note: AES-GCM deliberately gives the same error for "wrong key" and
 * "tampered ciphertext" — this is by design (prevents distinguishing
 * attacks). We surface a single `CryptoError` covering both cases.
 */
export async function decryptString(
  blob: EncryptedBlob,
  passphrase: string,
): Promise<string> {
  validateBlob(blob);

  const subtle = getSubtle();

  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);

  const key = await deriveAesKey(passphrase, salt, blob.iterations);

  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    // Web Crypto throws an opaque OperationError for any GCM auth failure.
    // Wrap it in CryptoError so callers don't need to know about the
    // platform-specific error type.
    throw new CryptoError(
      "Decryption failed: wrong passphrase or tampered ciphertext.",
    );
  }

  return new TextDecoder("utf-8").decode(plaintextBuffer);
}

/**
 * Cheap structural check on the blob. We do this *before* hitting the crypto
 * layer so a malformed blob fails fast with a precise message instead of
 * "OperationError" 600k PBKDF2 rounds later.
 */
function validateBlob(blob: EncryptedBlob): void {
  if (typeof blob !== "object" || blob === null) {
    throw new CryptoError("EncryptedBlob must be a non-null object.");
  }
  for (const field of ["ciphertext", "iv", "salt"] as const) {
    if (typeof blob[field] !== "string" || blob[field].length === 0) {
      throw new CryptoError(
        `EncryptedBlob field "${field}" must be a non-empty base64 string.`,
      );
    }
  }
  if (
    typeof blob.iterations !== "number" ||
    !Number.isFinite(blob.iterations) ||
    blob.iterations < 1 ||
    !Number.isInteger(blob.iterations)
  ) {
    throw new CryptoError(
      `EncryptedBlob field "iterations" must be a positive integer.`,
    );
  }
}
