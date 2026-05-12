/**
 * configLoader.test.ts
 *
 * Tests for the Drive-hosted `jobhelp-config.json` loader (Approach C scaffold).
 *
 * We mock the ApiClient via vi.fn() — no real network, no real Drive call.
 * Each test feeds a base64-encoded JSON string into the mock's
 * downloadTemplate response and asserts the loader's parse / validate /
 * cache behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadConfigFromDrive,
  clearConfigCache,
} from "../../src/lib/configLoader";
import { ConfigValidationError } from "../../src/types/jobhelp-config";
import type { ApiClient } from "../../src/lib/apiClient";
import type { DownloadTemplateResponse } from "../../src/types/api-contract";

/** A canonical fully-valid config object (mirrors the plan's example JSON). */
const VALID_CONFIG = {
  anthropicApiKey: "sk-ant-fake-key",
  appsScriptUrl: "https://script.google.com/macros/s/FAKE/exec",
  folders: {
    source: "src-folder-id",
    rules: "rules-folder-id",
    output: "out-folder-id",
  },
  sheetId: "sheet-id-123",
  templateDocxId: "template-docx-id-456",
  defaults: {
    model: "claude-haiku-4-5-20251001",
    togglePreset: "Quick",
  },
  preferences: {
    autoConvertOnGenerate: false,
    showCostInline: true,
  },
};

/** Helper: encode a JS object as base64-of-JSON (what Drive returns). */
function toBase64(obj: unknown): string {
  const json = JSON.stringify(obj);
  // Node + browser both support Buffer / btoa; use btoa-equivalent here.
  // In Node 16+ globalThis.btoa exists; in test env (node) it's available.
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Build a mock ApiClient whose downloadTemplate returns the given response. */
function mockApiClient(response: DownloadTemplateResponse): {
  client: ApiClient;
  downloadTemplate: ReturnType<typeof vi.fn>;
} {
  const downloadTemplate = vi.fn().mockResolvedValue(response);
  const client = { downloadTemplate } as unknown as ApiClient;
  return { client, downloadTemplate };
}

/** Build an ok DownloadTemplateResponse with the given base64 payload. */
function okResponse(base64: string): DownloadTemplateResponse {
  return {
    ok: true,
    base64,
    fileName: "jobhelp-config.json",
    mimeType: "application/json",
  };
}

beforeEach(() => {
  clearConfigCache();
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("loadConfigFromDrive — happy path", () => {
  it("parses a valid config file correctly", async () => {
    const { client, downloadTemplate } = mockApiClient(
      okResponse(toBase64(VALID_CONFIG)),
    );

    const config = await loadConfigFromDrive("file-1", client);

    expect(downloadTemplate).toHaveBeenCalledOnce();
    expect(downloadTemplate).toHaveBeenCalledWith({ fileId: "file-1" });

    expect(config.anthropicApiKey).toBe("sk-ant-fake-key");
    expect(config.appsScriptUrl).toBe(
      "https://script.google.com/macros/s/FAKE/exec",
    );
    expect(config.folders.source).toBe("src-folder-id");
    expect(config.folders.rules).toBe("rules-folder-id");
    expect(config.folders.output).toBe("out-folder-id");
    expect(config.sheetId).toBe("sheet-id-123");
    expect(config.templateDocxId).toBe("template-docx-id-456");
    expect(config.defaults.model).toBe("claude-haiku-4-5-20251001");
    expect(config.defaults.togglePreset).toBe("Quick");
    expect(config.preferences.autoConvertOnGenerate).toBe(false);
    expect(config.preferences.showCostInline).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema validation — missing required keys
// ─────────────────────────────────────────────────────────────────────────────

describe("loadConfigFromDrive — missing required keys", () => {
  it("throws ConfigValidationError naming a missing top-level field", async () => {
    const incomplete = { ...VALID_CONFIG } as Partial<typeof VALID_CONFIG>;
    delete incomplete.anthropicApiKey;
    const { client } = mockApiClient(okResponse(toBase64(incomplete)));

    await expect(loadConfigFromDrive("file-2", client)).rejects.toBeInstanceOf(
      ConfigValidationError,
    );

    try {
      await loadConfigFromDrive("file-2", client);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const ve = err as ConfigValidationError;
      expect(ve.field).toBe("anthropicApiKey");
      expect(ve.message).toContain("anthropicApiKey");
    }
  });

  it("throws with a nested field path when folders.source is missing", async () => {
    const incomplete = JSON.parse(JSON.stringify(VALID_CONFIG));
    delete incomplete.folders.source;
    const { client } = mockApiClient(okResponse(toBase64(incomplete)));

    try {
      await loadConfigFromDrive("file-3", client);
      throw new Error("expected loadConfigFromDrive to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const ve = err as ConfigValidationError;
      expect(ve.field).toBe("folders.source");
      expect(ve.message).toContain("folders.source");
    }
  });

  it("throws with a typed error when a required key has the wrong type", async () => {
    const bad = JSON.parse(JSON.stringify(VALID_CONFIG));
    bad.preferences.showCostInline = "yes"; // string, not boolean
    const { client } = mockApiClient(okResponse(toBase64(bad)));

    try {
      await loadConfigFromDrive("file-4", client);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const ve = err as ConfigValidationError;
      expect(ve.field).toBe("preferences.showCostInline");
      expect(ve.message).toContain("boolean");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Malformed JSON
// ─────────────────────────────────────────────────────────────────────────────

describe("loadConfigFromDrive — malformed JSON", () => {
  it("throws ConfigValidationError on syntactically invalid JSON", async () => {
    // Encode bytes that decode to text but are not valid JSON.
    const garbage = btoa("this is not { valid json");
    const { client } = mockApiClient(okResponse(garbage));

    try {
      await loadConfigFromDrive("file-5", client);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const ve = err as ConfigValidationError;
      // Non-field-specific parse failure surfaces with field === null.
      expect(ve.field).toBeNull();
      expect(ve.message.toLowerCase()).toContain("json");
    }
  });

  it("throws ConfigValidationError when the JSON root is not an object", async () => {
    const arr = toBase64(["not", "an", "object"]);
    const { client } = mockApiClient(okResponse(arr));

    try {
      await loadConfigFromDrive("file-6", client);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const ve = err as ConfigValidationError;
      expect(ve.field).toBeNull();
      expect(ve.message).toContain("object");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transport failure
// ─────────────────────────────────────────────────────────────────────────────

describe("loadConfigFromDrive — apiClient failure", () => {
  it("propagates apiClient.downloadTemplate error (ok:false response)", async () => {
    const { client } = mockApiClient({
      ok: false,
      error: { type: "drive", message: "File not found", retryable: false },
    });

    await expect(loadConfigFromDrive("missing-file", client)).rejects.toThrow(
      /File not found/,
    );
  });

  it("does NOT throw ConfigValidationError on transport failure — uses plain Error", async () => {
    const { client } = mockApiClient({
      ok: false,
      error: { type: "auth", message: "Unauthorized", retryable: false },
    });

    try {
      await loadConfigFromDrive("file-7", client);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ConfigValidationError);
      expect((err as Error).message).toContain("Unauthorized");
    }
  });

  it("preserves the original error type in the thrown message (audit M12)", async () => {
    const { client } = mockApiClient({
      ok: false,
      error: { type: "drive", message: "File not found", retryable: false },
    });
    await expect(loadConfigFromDrive("file-typed", client)).rejects.toThrow(
      /\[drive\]/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Silent-failure hardening: suspicious API-key format now leaves a trace
// (audit M24)
// ─────────────────────────────────────────────────────────────────────────────

describe("loadConfigFromDrive — anthropicApiKey sanity log", () => {
  it("logs a structured warn when the API key doesn't start with sk-ant- (but still loads)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = mockApiClient(
      okResponse(toBase64({ ...VALID_CONFIG, anthropicApiKey: "sk-ANT-typo-key" })),
    );

    const config = await loadConfigFromDrive("file-badkey", client);
    expect(config.anthropicApiKey).toBe("sk-ANT-typo-key");

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/\[JobHelp\]/);
    expect(logged).toMatch(/does not start with 'sk-ant-'/i);
    // The key value itself must be redacted by the logger.
    expect(logged).not.toContain("sk-ANT-typo-key");
    warnSpy.mockRestore();
  });

  it("does not warn for a well-formed sk-ant- key", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = mockApiClient(okResponse(toBase64(VALID_CONFIG)));
    await loadConfigFromDrive("file-goodkey", client);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

describe("loadConfigFromDrive — in-memory cache", () => {
  it("caches the parsed config; a second call does not re-fetch", async () => {
    const { client, downloadTemplate } = mockApiClient(
      okResponse(toBase64(VALID_CONFIG)),
    );

    const first = await loadConfigFromDrive("cached-file", client);
    const second = await loadConfigFromDrive("cached-file", client);

    expect(downloadTemplate).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // identity equality — same cached object
  });

  it("clearConfigCache() forces a re-fetch on the next call", async () => {
    const { client, downloadTemplate } = mockApiClient(
      okResponse(toBase64(VALID_CONFIG)),
    );

    await loadConfigFromDrive("cleared-file", client);
    clearConfigCache();
    await loadConfigFromDrive("cleared-file", client);

    expect(downloadTemplate).toHaveBeenCalledTimes(2);
  });

  it("caches per fileId — different fileIds trigger separate fetches", async () => {
    const downloadTemplate = vi
      .fn()
      .mockResolvedValueOnce(okResponse(toBase64(VALID_CONFIG)))
      .mockResolvedValueOnce(
        okResponse(
          toBase64({ ...VALID_CONFIG, anthropicApiKey: "sk-ant-other" }),
        ),
      );
    const client = { downloadTemplate } as unknown as ApiClient;

    const a = await loadConfigFromDrive("file-a", client);
    const b = await loadConfigFromDrive("file-b", client);

    expect(downloadTemplate).toHaveBeenCalledTimes(2);
    expect(a.anthropicApiKey).toBe("sk-ant-fake-key");
    expect(b.anthropicApiKey).toBe("sk-ant-other");
  });
});
