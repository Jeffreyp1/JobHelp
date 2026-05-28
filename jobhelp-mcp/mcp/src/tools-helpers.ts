import type { Result } from '../../core/types/result.js';
import type {
  ApplicationKind,
  RulesMode,
  ToolCallContentItem,
  ToolCallResponse,
  ToolDefinition,
  ToolError,
  ToolHandler,
  ToolJsonSchema,
} from './tools-types.js';

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function jsonText(payload: unknown): readonly ToolCallContentItem[] {
  return [{ type: 'text', text: JSON.stringify(payload, null, 2) }];
}

export function errorResponse(error: ToolError): ToolCallResponse {
  return { content: jsonText({ ok: false, error }), isError: true };
}

export function okResponse(value: unknown): ToolCallResponse {
  return { content: jsonText({ ok: true, value }) };
}

export function getOptional<T>(
  obj: Record<string, unknown>,
  key: string,
  check: (v: unknown) => v is T,
): T | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  return check(v) ? v : undefined;
}

export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}

export function isStringArray(v: unknown): v is readonly string[] {
  if (!Array.isArray(v)) return false;
  for (const item of v) if (!isString(item)) return false;
  return true;
}

export function requireObject(raw: unknown): Result<Record<string, unknown>, ToolError> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { type: 'invalid_input', message: 'expected an object argument' },
    };
  }
  return { ok: true, value: raw };
}

export function unwrap<T>(r: Result<T, ToolError>): ToolCallResponse {
  if (r.ok) return okResponse(r.value);
  return errorResponse(r.error);
}

export function isApplicationKind(v: unknown): v is ApplicationKind {
  return v === 'resume' || v === 'cover-letter' || v === 'critique' || v === 'notes';
}

export function isRulesMode(v: unknown): v is RulesMode {
  return v === 'defaults' || v === 'user' || v === 'merged';
}

export interface BuildOptions<TArgs> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
  readonly parse: (raw: Record<string, unknown>) => Result<TArgs, ToolError>;
  readonly run: (args: TArgs) => Promise<ToolCallResponse>;
}

export function buildHandler<TArgs>(opts: BuildOptions<TArgs>): ToolHandler {
  const definition: ToolDefinition = {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
  };
  return {
    definition,
    invoke: async (rawArgs: unknown): Promise<ToolCallResponse> => {
      const obj = requireObject(rawArgs);
      if (!obj.ok) return errorResponse(obj.error);
      const parsed = opts.parse(obj.value);
      if (!parsed.ok) return errorResponse(parsed.error);
      try {
        return await opts.run(parsed.value);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return errorResponse({ type: 'internal', message });
      }
    },
  };
}
