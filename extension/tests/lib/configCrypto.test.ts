/**
 * configCrypto.test.ts
 *
 * Tests for the AES-GCM + PBKDF2 encryption helpers in
 * `extension/src/lib/configCrypto.ts`.
 *
 * Environment: jsdom (declared at the top of this file). jsdom inherits Node's
 * globalThis.crypto / crypto.subtle, so Web Crypto works without a polyfill.
 *
 * Test surface:
 *   - Round-trip (encrypt → decrypt → original plaintext)
 *   - Wrong passphrase rejection (CryptoError)
 *   - Tampered-ciphertext rejection (CryptoError) — flip a byte
 *   - Fresh-random IV: two encrypts of the same plaintext differ
 *   - iterations field is preserved on the returned blob
 *   - Long plaintexts (10 KB) round-trip
 *   - Unicode plaintexts (Japanese, emoji-adjacent) round-trip
 *   - Structural validation (missing fields, bad iteration count)
 */

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import {
  encryptString,
  decryptString,
  CryptoError,
  PBKDF2_ITERATIONS,
  type EncryptedBlob,
} from "../../src/lib/configCrypto";

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("encryptString / decryptString — round-trip", () => {
  it("recovers the original plaintext for a typical API key", async () => {
    const plaintext = "sk-ant-api03-EXAMPLE-1234567890abcdef";
    const passphrase = "correct horse battery staple";

    const blob = await encryptString(plaintext, passphrase);
    const recovered = await decryptString(blob, passphrase);

    expect(recovered).toBe(plaintext);
  });

  it("round-trips a plain ASCII string", async () => {
    const plaintext = "hello world";
    const blob = await encryptString(plaintext, "pw");
    expect(await decryptString(blob, "pw")).toBe(plaintext);
  });

  it("round-trips a Unicode plaintext (Japanese + ASCII)", async () => {
    const plaintext = "sk-ant-日本語-key-value";
    const blob = await encryptString(plaintext, "passphrase");
    expect(await decryptString(blob, "passphrase")).toBe(plaintext);
  });

  it("round-trips an empty string", async () => {
    // GCM allows zero-length plaintext (auth tag still computed over AAD/IV).
    const blob = await encryptString("", "pw");
    expect(await decryptString(blob, "pw")).toBe("");
  });

  it("round-trips a 10 KB plaintext", async () => {
    // Stress-test the chunked base64 path for large ciphertexts.
    const plaintext = "x".repeat(10 * 1024);
    const blob = await encryptString(plaintext, "long-data-pw");
    const recovered = await decryptString(blob, "long-data-pw");
    expect(recovered.length).toBe(10 * 1024);
    expect(recovered).toBe(plaintext);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authentication failures
// ─────────────────────────────────────────────────────────────────────────────

describe("decryptString — authentication failures", () => {
  it("throws CryptoError when the passphrase is wrong", async () => {
    const blob = await encryptString("secret", "right-passphrase");

    await expect(decryptString(blob, "wrong-passphrase")).rejects.toBeInstanceOf(
      CryptoError,
    );
  });

  it("throws CryptoError when a single byte of ciphertext is flipped", async () => {
    const blob = await encryptString("secret", "pw");

    // Decode the base64 ciphertext, flip one bit in the first byte, re-encode.
    const tampered = flipFirstCiphertextByte(blob);

    await expect(decryptString(tampered, "pw")).rejects.toBeInstanceOf(
      CryptoError,
    );
  });

  it("throws CryptoError when the IV is tampered with", async () => {
    const blob = await encryptString("secret", "pw");

    // Flip a byte in the IV — GCM will not authenticate.
    const tampered: EncryptedBlob = {
      ...blob,
      iv: flipFirstByteOfBase64(blob.iv),
    };

    await expect(decryptString(tampered, "pw")).rejects.toBeInstanceOf(
      CryptoError,
    );
  });

  it("throws CryptoError when the salt is tampered with", async () => {
    // Tampering with salt produces a different derived AES key, which then
    // fails GCM auth — same observable behaviour as wrong-passphrase.
    const blob = await encryptString("secret", "pw");

    const tampered: EncryptedBlob = {
      ...blob,
      salt: flipFirstByteOfBase64(blob.salt),
    };

    await expect(decryptString(tampered, "pw")).rejects.toBeInstanceOf(
      CryptoError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Random IV / salt
// ─────────────────────────────────────────────────────────────────────────────

describe("encryptString — randomness", () => {
  it("produces different ciphertexts for two encryptions of the same plaintext", async () => {
    const plaintext = "same-input";
    const passphrase = "same-pw";

    const a = await encryptString(plaintext, passphrase);
    const b = await encryptString(plaintext, passphrase);

    // IV, salt, and (therefore) ciphertext must all differ.
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);

    // But both still decrypt to the same plaintext.
    expect(await decryptString(a, passphrase)).toBe(plaintext);
    expect(await decryptString(b, passphrase)).toBe(plaintext);
  });

  it("produces a 12-byte IV and a 16-byte salt (base64-decoded)", async () => {
    const blob = await encryptString("x", "pw");
    expect(base64ByteLength(blob.iv)).toBe(12);
    expect(base64ByteLength(blob.salt)).toBe(16);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// iterations field
// ─────────────────────────────────────────────────────────────────────────────

describe("encryptString — iterations field", () => {
  it("records the PBKDF2 iteration count on the returned blob", async () => {
    const blob = await encryptString("x", "pw");
    expect(blob.iterations).toBe(PBKDF2_ITERATIONS);
    expect(blob.iterations).toBe(600_000);
  });

  it("preserves the iterations field through a round-trip via JSON", async () => {
    // Simulate storing the blob in JSON (as we will inside jobhelp-config.json).
    const blob = await encryptString("x", "pw");
    const roundTripped = JSON.parse(JSON.stringify(blob)) as EncryptedBlob;

    expect(roundTripped.iterations).toBe(PBKDF2_ITERATIONS);
    expect(await decryptString(roundTripped, "pw")).toBe("x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural validation
// ─────────────────────────────────────────────────────────────────────────────

describe("decryptString — structural validation", () => {
  it("throws CryptoError when a required field is missing", async () => {
    const blob = await encryptString("x", "pw");
    const broken = { ...blob, ciphertext: "" };

    await expect(decryptString(broken, "pw")).rejects.toBeInstanceOf(
      CryptoError,
    );
  });

  it("throws CryptoError when iterations is not a positive integer", async () => {
    const blob = await encryptString("x", "pw");

    await expect(
      decryptString({ ...blob, iterations: 0 }, "pw"),
    ).rejects.toBeInstanceOf(CryptoError);

    await expect(
      decryptString({ ...blob, iterations: -1 }, "pw"),
    ).rejects.toBeInstanceOf(CryptoError);

    await expect(
      decryptString({ ...blob, iterations: 1.5 }, "pw"),
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it("throws CryptoError when a field is non-base64 garbage", async () => {
    const blob = await encryptString("x", "pw");
    const broken = { ...blob, salt: "!!!not-base64!!!" };

    await expect(decryptString(broken, "pw")).rejects.toBeInstanceOf(
      CryptoError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Decode base64 → bytes (test-side, mirrors the impl helper). */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode bytes → base64. */
function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Return the byte length of a base64 string after decoding. */
function base64ByteLength(b64: string): number {
  return decodeBase64(b64).length;
}

/** Flip bit 0 of the first byte of a base64 field. */
function flipFirstByteOfBase64(b64: string): string {
  const bytes = decodeBase64(b64);
  if (bytes.length === 0) throw new Error("empty field — cannot flip");
  bytes[0] = bytes[0] ^ 0x01;
  return encodeBase64(bytes);
}

/** Flip the first byte of the ciphertext in a blob and return the new blob. */
function flipFirstCiphertextByte(blob: EncryptedBlob): EncryptedBlob {
  return { ...blob, ciphertext: flipFirstByteOfBase64(blob.ciphertext) };
}
