/**
 * Claude API call interface used by claude.ts. All UrlFetchApp calls go through callClaude.
 * Returns parsed responses or throws typed errors.
 */

export interface CacheControl {
  type: "ephemeral";
}

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

export interface UserMessage {
  role: "user";
  content: string;
}

/** Tool definition for web_search_20250305 and other Anthropic tools */
export interface ClaudeTool {
  type: string;
  name: string;
}

export interface ClaudeRequest {
  /** Anthropic model id, e.g. "claude-haiku-4-5-20251001" */
  model: string;
  /** Max tokens to generate */
  maxTokens: number;
  /** System message — pass as array to enable per-block prompt caching */
  system: SystemBlock[];
  /** User messages */
  messages: UserMessage[];
  /**
   * Optional tools to enable (e.g. web_search_20250305).
   * When provided, Claude may invoke tools during the response.
   */
  tools?: ClaudeTool[];
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClaudeResponse {
  /** Concatenated text from the response */
  text: string;
  /** Stop reason ("end_turn", "max_tokens", etc.) */
  stopReason: string;
  /** Token usage breakdown */
  usage: ClaudeUsage;
  /** The model that actually answered (Anthropic may differ from request) */
  model: string;
}

export type ClaudeErrorType = "auth" | "rate_limit" | "server" | "validation" | "other";

export class ClaudeApiError extends Error {
  constructor(
    public readonly errorType: ClaudeErrorType,
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ClaudeApiError";
  }

  /** Whether retrying with the same request is sensible */
  get retryable(): boolean {
    return this.errorType === "rate_limit" || this.errorType === "server";
  }
}

export interface ClaudeClient {
  /** Make a Messages API call. Throws ClaudeApiError on non-2xx. */
  call(req: ClaudeRequest): ClaudeResponse;
}
