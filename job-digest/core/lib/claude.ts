import Anthropic from '@anthropic-ai/sdk';
import { err, ok, type Result } from '../types/result.js';

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

export type ClaudeErrorType = 'rate_limit' | 'auth' | 'server' | 'parse' | 'unknown';

export interface ClaudeError {
  readonly type: ClaudeErrorType;
  readonly message: string;
  readonly retryable: boolean;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS: readonly number[] = [1000, 2000, 4000];

type AnthropicLike = {
  readonly messages: {
    create(args: unknown): unknown;
  };
};

type ClientFactory = (apiKey: string) => AnthropicLike;

const defaultFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey });
let clientFactory: ClientFactory = defaultFactory;

export function __setClientFactoryForTests(factory: ClientFactory | null): void {
  clientFactory = factory ?? defaultFactory;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function classifyError(e: unknown): ClaudeError {
  const message = e instanceof Error ? e.message : 'unknown error';
  if (e instanceof Anthropic.AuthenticationError) {
    return { type: 'auth', message, retryable: false };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { type: 'rate_limit', message, retryable: true };
  }
  if (e instanceof Anthropic.InternalServerError) {
    return { type: 'server', message, retryable: true };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { type: 'server', message, retryable: true };
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    if (status === 401) return { type: 'auth', message, retryable: false };
    if (status === 429) return { type: 'rate_limit', message, retryable: true };
    if (typeof status === 'number' && status >= 500) {
      return { type: 'server', message, retryable: true };
    }
    return { type: 'unknown', message, retryable: false };
  }
  return { type: 'unknown', message, retryable: false };
}

function extractText(response: unknown): Result<ClaudeResponse, ClaudeError> {
  if (!isPlainObject(response)) {
    return err({ type: 'parse', message: 'response is not an object', retryable: false });
  }
  const content = response['content'];
  if (!Array.isArray(content) || content.length === 0) {
    return err({ type: 'parse', message: 'response.content is missing or empty', retryable: false });
  }
  const first = content[0];
  if (!isPlainObject(first) || first['type'] !== 'text' || typeof first['text'] !== 'string') {
    return err({
      type: 'parse',
      message: 'response.content[0] is not a TextBlock',
      retryable: false,
    });
  }
  const text = first['text'];
  const usage = response['usage'];
  if (!isPlainObject(usage)) {
    return err({ type: 'parse', message: 'response.usage is missing', retryable: false });
  }
  const inputTokens = usage['input_tokens'];
  const outputTokens = usage['output_tokens'];
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return err({ type: 'parse', message: 'response.usage token fields missing', retryable: false });
  }
  return ok({ text, inputTokens, outputTokens });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callClaude(
  params: ClaudeCallParams,
): Promise<Result<ClaudeResponse, ClaudeError>> {
  const client = clientFactory(params.apiKey);
  let lastError: ClaudeError = {
    type: 'unknown',
    message: 'no attempts made',
    retryable: false,
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const createArgs: Record<string, unknown> = {
        model: params.model,
        max_tokens: params.maxTokens,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (params.system !== undefined) {
        createArgs['system'] = params.system;
      }
      const response = await client.messages.create(createArgs);
      return extractText(response);
    } catch (e: unknown) {
      lastError = classifyError(e);
      if (!lastError.retryable) {
        return err(lastError);
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 1000;
        await sleep(wait);
      }
    }
  }
  return err(lastError);
}
