import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  callClaude,
  type ClaudeMessage,
} from '../../core/lib/claude.js';
import { __setClientFactoryForTests } from '../../core/lib/claude.testing.js';
import { isErr, isOk } from '../../core/types/result.js';

function okResponse(text: string, inputTokens = 10, outputTokens = 20): Record<string, unknown> {
  return {
    id: 'msg_abc',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function makeMockClient(create: ReturnType<typeof vi.fn>): { messages: { create: typeof create } } {
  return { messages: { create } };
}

const baseParams = {
  model: 'claude-haiku-4-5',
  messages: [{ role: 'user', content: 'hi' }] as readonly ClaudeMessage[],
  maxTokens: 100,
  apiKey: 'test',
};

describe('callClaude', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    __setClientFactoryForTests(null);
    vi.useRealTimers();
  });

  it('returns ok with text and token counts on success', async () => {
    const create = vi.fn().mockResolvedValueOnce(okResponse('hello world', 42, 17));
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isOk(result)) {
      throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
    }
    expect(result.value.text).toBe('hello world');
    expect(result.value.inputTokens).toBe(42);
    expect(result.value.outputTokens).toBe(17);
    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (callArgs === undefined) throw new Error('no call args');
    expect(callArgs.model).toBe('claude-haiku-4-5');
    expect(callArgs.max_tokens).toBe(100);
  });

  it('forwards the system prompt only when provided', async () => {
    const create = vi.fn().mockResolvedValue(okResponse('x'));
    __setClientFactoryForTests(() => makeMockClient(create));

    const p1 = callClaude({ ...baseParams, system: 'be helpful' });
    await vi.runAllTimersAsync();
    await p1;

    const p2 = callClaude(baseParams);
    await vi.runAllTimersAsync();
    await p2;

    expect(create.mock.calls[0]?.[0]?.system).toBe('be helpful');
    expect(create.mock.calls[1]?.[0]?.system).toBeUndefined();
  });

  it('maps 401 / AuthenticationError to type=auth, retryable=false, no retry', async () => {
    const authErr = new Anthropic.AuthenticationError(401, undefined, 'bad key', undefined);
    const create = vi.fn().mockRejectedValue(authErr);
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('auth');
    expect(result.error.retryable).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('maps 429 / RateLimitError to type=rate_limit, retryable=true, retries up to 3 attempts', async () => {
    const rateErr = new Anthropic.RateLimitError(429, undefined, 'slow down', undefined);
    const create = vi.fn().mockRejectedValue(rateErr);
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('rate_limit');
    expect(result.error.retryable).toBe(true);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('maps 500 / InternalServerError to type=server, retryable=true, retries up to 3 attempts', async () => {
    const srvErr = new Anthropic.InternalServerError(500, undefined, 'oops', undefined);
    const create = vi.fn().mockRejectedValue(srvErr);
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('maps APIConnectionError to type=server, retryable=true, retries', async () => {
    const connErr = new Anthropic.APIConnectionError({ message: 'dns fail' });
    const create = vi.fn().mockRejectedValue(connErr);
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('server');
    expect(result.error.retryable).toBe(true);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('maps unrecognized errors to type=unknown, retryable=false, no retry', async () => {
    const create = vi.fn().mockRejectedValue(new Error('weird'));
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('unknown');
    expect(result.error.retryable).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns ok on the 3rd attempt after 2 retryable failures', async () => {
    const rateErr = new Anthropic.RateLimitError(429, undefined, 'slow down', undefined);
    const create = vi
      .fn()
      .mockRejectedValueOnce(rateErr)
      .mockRejectedValueOnce(rateErr)
      .mockResolvedValueOnce(okResponse('finally', 1, 2));
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isOk(result)) {
      throw new Error(`expected ok; got ${JSON.stringify(result.error)}`);
    }
    expect(result.value.text).toBe('finally');
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('returns parse error when response.content is missing or not a TextBlock', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    __setClientFactoryForTests(() => makeMockClient(create));

    const promise = callClaude(baseParams);
    await vi.runAllTimersAsync();
    const result = await promise;

    if (!isErr(result)) throw new Error('expected err');
    expect(result.error.type).toBe('parse');
  });
});
