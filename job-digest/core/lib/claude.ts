import { err, type Result } from '../types/result.js';

export interface ClaudeCallParams {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly ClaudeMessage[];
  readonly maxTokens: number;
  readonly apiKey: string;
}

export interface ClaudeMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ClaudeResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ClaudeError {
  readonly type: 'rate_limit' | 'auth' | 'server' | 'parse' | 'unknown';
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * Minimal Anthropic SDK wrapper. Auto-retries on `rate_limit` and `server` errors with backoff.
 *
 * @param params - Claude call parameters including model, messages, and api key
 * @returns Result with text + token usage or a typed ClaudeError
 */
export async function callClaude(
  params: ClaudeCallParams,
): Promise<Result<ClaudeResponse, ClaudeError>> {
  // STUB body — Agent D owns the real implementation.
  void params;
  return err({
    type: 'unknown',
    message: 'callClaude() not implemented — Agent D owns core/lib/claude.ts',
    retryable: false,
  });
}
