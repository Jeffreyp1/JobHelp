/**
 * Claude Messages API caller for Apps Script.
 *
 * Uses the V8-runtime UrlFetchApp global to POST to /v1/messages. The API key
 * lives in Script Properties under ANTHROPIC_API_KEY — set it once via the
 * Apps Script editor; never check it in.
 *
 * Prompt caching: we always send the system message as a `[{ type: "text",
 * text, cache_control: { type: "ephemeral" } }]` array. The composer in
 * prompt.ts produces exactly that shape. Subsequent calls within the 5-minute
 * cache TTL bill at the cache-read rate (~10% of input).
 *
 * Errors: every non-2xx is parsed and rethrown as a typed ClaudeApiError so
 * Code.ts can map to the ApiError shape returned over the wire. We don't
 * retry here — that's the caller's responsibility (it owns the timeout
 * budget for a single request).
 */
import {
  ClaudeApiError,
  type ClaudeRequest,
  type ClaudeResponse,
  type ClaudeUsage,
  type ClaudeErrorType,
} from "./types/claude-api.js";
import { log } from "./lib/structuredLog.js";

export { ClaudeApiError } from "./types/claude-api.js";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_RETRY_AFTER_SECONDS = 30;

// Apps Script globals — declared as ambient so the file compiles in Node tests
// (where vi.stubGlobal injects the actual mocks).
declare const UrlFetchApp: {
  fetch(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      payload?: string;
      contentType?: string;
      muteHttpExceptions?: boolean;
    },
  ): {
    getResponseCode(): number;
    getContentText(): string;
  };
};

declare const PropertiesService: {
  getScriptProperties(): { getProperty(key: string): string | null };
};

interface AnthropicErrorBody {
  type?: string;
  error?: {
    type?: string;
    message?: string;
  };
  retry_after?: number; // some Anthropic errors include this
}

interface AnthropicMessageBody {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  usage: ClaudeUsage;
}

function getApiKey(): string {
  const key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!key) {
    throw new ClaudeApiError(
      "auth",
      0,
      "ANTHROPIC_API_KEY is not set in Script Properties. Open the Apps Script editor → Project Settings → Script Properties to add it.",
    );
  }
  return key;
}

function classifyStatus(status: number): ClaudeErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 404 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "other";
}

function parseErrorBody(body: string): AnthropicErrorBody {
  try {
    return JSON.parse(body) as AnthropicErrorBody;
  } catch {
    return {};
  }
}

function throwApiError(status: number, rawBody: string): never {
  const errorType = classifyStatus(status);
  const parsed = parseErrorBody(rawBody);
  const message =
    parsed.error?.message ?? rawBody.slice(0, 500) ?? `Claude API request failed (${status})`;
  const retryAfterSeconds =
    errorType === "rate_limit"
      ? typeof parsed.retry_after === "number" && parsed.retry_after > 0
        ? parsed.retry_after
        : DEFAULT_RETRY_AFTER_SECONDS
      : undefined;
  throw new ClaudeApiError(errorType, status, message, retryAfterSeconds);
}

export function callClaude(req: ClaudeRequest): ClaudeResponse {
  const apiKey = getApiKey();

  const payload: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  };
  if (req.tools && req.tools.length > 0) {
    payload['tools'] = req.tools;
  }

  const response = UrlFetchApp.fetch(MESSAGES_URL, {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    // Surface the failure before we rethrow as a typed error. The body may
    // contain Anthropic's structured error; structuredLog truncates it if huge
    // and would redact anything key-shaped.
    log("warn", "Claude API returned a non-2xx status", {
      status,
      model: req.model,
      bodySnippet: body.slice(0, 500),
    });
    throwApiError(status, body);
  }

  let parsed: AnthropicMessageBody;
  try {
    parsed = JSON.parse(body) as AnthropicMessageBody;
  } catch (e) {
    log("error", "Claude returned 2xx but body was not JSON", {
      status,
      model: req.model,
      error: (e as Error).message,
      bodySnippet: body.slice(0, 500),
    });
    throw new ClaudeApiError(
      "other",
      status,
      `Claude returned 2xx but body was not JSON: ${(e as Error).message}`,
    );
  }

  const text = (parsed.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");

  return {
    text,
    stopReason: parsed.stop_reason,
    usage: parsed.usage,
    model: parsed.model,
  };
}
