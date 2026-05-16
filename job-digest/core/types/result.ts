/**
 * Discriminated-union Result type for fallible operations.
 * Mirrors the JobHelp ApiResult pattern from extension/src/types/api-contract.ts.
 *
 * Never throw across module boundaries — return a Result.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a success Result. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Construct a failure Result. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Type guard for the success branch. */
export const isOk = <T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } =>
  r.ok;

/** Type guard for the failure branch. */
export const isErr = <T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } =>
  !r.ok;
