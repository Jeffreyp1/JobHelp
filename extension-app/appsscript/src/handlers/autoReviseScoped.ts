import type { Deps } from "../Code.js";
import type {
  AutoReviseScopedRequest,
  AutoReviseScopedSuccess,
  AutoReviseScopedCheckerResult,
  ApiResult,
  ApiErrorResponse,
} from "../types/api-contract.js";
import { ClaudeApiError } from "../types/claude-api.js";
import type { ClaudeUsage } from "../types/claude-api.js";
import { calculateCost } from "../cost.js";
import { log } from "../lib/structuredLog.js";

function neutraliseFences(s: string): string {
  return s.replace(/```/g, "​`​`​`​");
}

function validationError(message: string): ApiErrorResponse {
  return { ok: false, error: { type: "validation", message, retryable: false } };
}

const VALID_SCOPES = ["bullet", "section", "selection"] as const;

class ScopedValidationError extends Error {}

export function validateAutoReviseScoped(
  raw: Record<string, unknown>,
): ApiErrorResponse | null {
  if (typeof raw["scope"] !== "string" || !(VALID_SCOPES as readonly string[]).includes(raw["scope"] as string)) {
    return validationError(`scope must be one of: ${VALID_SCOPES.join(", ")}`);
  }
  if (typeof raw["excerpt"] !== "string" || (raw["excerpt"] as string).trim().length === 0) {
    return validationError("excerpt must be a non-empty string");
  }
  if (typeof raw["sectionPath"] !== "string") {
    return validationError("sectionPath must be a string");
  }
  if (typeof raw["instruction"] !== "string" || (raw["instruction"] as string).trim().length === 0) {
    return validationError("instruction must be non-whitespace");
  }
  if (typeof raw["model"] !== "string" || (raw["model"] as string).length === 0) {
    return validationError("model is required");
  }
  if (typeof raw["useChecker"] !== "boolean") {
    return validationError("useChecker must be a boolean");
  }
  return null;
}

function buildCreatorPrompt(req: AutoReviseScopedRequest, priorIssues: string[]): { system: string; user: string } {
  const isBullet = req.scope === "bullet";
  const isSelection = req.scope === "selection";
  const system = [
    "You are a precision resume editor.",
    "",
    isBullet
      ? "Rewrite ONE bullet to satisfy the instruction. Return ONLY the new bullet text as a single line, with NO leading '- ', NO markdown headers, NO commentary, NO code fences."
      : isSelection
        ? "Rewrite ONLY the selected Markdown excerpt to satisfy the instruction. Return ONLY replacement Markdown for that selected range, with NO commentary and NO code fences."
        : "Rewrite the bullets in this section to satisfy the instruction. Return ONLY a JSON array of strings — each string is one bullet's text with NO leading '- ', NO markdown headers, NO commentary, NO code fences.",
    "",
    "Hard rules:",
    "- Do NOT fabricate metrics, dates, companies, titles, or claims that are not supported by the original.",
    "- Avoid banned words: delve, leverage, utilize, harness, spearhead, tapestry, synergy, multifaceted, pivotal, realm, paradigm, holistic, foster, cornerstone, cutting-edge, novel, innovative, groundbreaking.",
    "- Avoid banned adverbs: meticulously, notably, subsequently, seamlessly, holistically.",
    "- Every bullet must contain a number OR a concrete proper-noun artifact.",
    "- Do not end a bullet with an -ing analysis phrase (e.g. 'advancing the field').",
    "- Do not start a bullet with: Responsible for, Helped, Assisted with, Worked on, Participated in, In charge of, Duties included, Tasked with, Involved in, Supported.",
  ].join("\n");
  const issueAddendum =
    priorIssues.length > 0
      ? `\n\nA prior attempt failed checks for these reasons — address them this time:\n- ${priorIssues.join("\n- ")}`
      : "";
  const user = [
    `Section: ${neutraliseFences(req.sectionPath)}`,
    "",
    isBullet ? "Original bullet:" : isSelection ? "Selected markdown:" : "Original section content:",
    "```",
    neutraliseFences(req.excerpt),
    "```",
    "",
    `Instruction: ${neutraliseFences(req.instruction)}${issueAddendum}`,
  ].join("\n");
  return { system, user };
}

function buildCheckerPrompt(req: AutoReviseScopedRequest, proposal: string | string[]): { system: string; user: string } {
  const system = [
    "You are a strict resume reviewer.",
    "Compare the proposed rewrite against the original excerpt and return JSON:",
    `{"ok": boolean, "issues": string[]}.`,
    "Flag any of: fabrication (numbers/claims/dates/companies not in the original), banned words, bullets missing a number AND a named artifact, -ing analysis endings, forbidden bullet openers, dates/titles/companies changed.",
    "Return ONLY the JSON object, no commentary, no fences.",
  ].join("\n");
  const proposalText = Array.isArray(proposal) ? JSON.stringify(proposal) : proposal;
  const user = [
    "Original:",
    "```",
    neutraliseFences(req.excerpt),
    "```",
    "",
    "Proposed rewrite:",
    "```",
    neutraliseFences(proposalText),
    "```",
  ].join("\n");
  return { system, user };
}

function stripFences(text: string): string {
  const m = text.match(/^\s*```(?:json|markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : text;
}

function parseCreatorReply(scope: AutoReviseScopedRequest["scope"], text: string): string | string[] {
  const t = stripFences(text).trim();
  if (scope === "bullet") return t.replace(/^\s*-\s+/, "");
  if (scope === "selection") return t;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`section scope: creator did not return valid JSON: ${reason}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    throw new Error("section scope: creator JSON must be an array of strings");
  }
  return (parsed as string[]).map((s) => s.replace(/^\s*-\s+/, ""));
}

function isMarkerOnly(s: string): boolean {
  return /^[-*+]$/.test(s.trim());
}

function assertUsableProposal(scope: AutoReviseScopedRequest["scope"], proposal: string | string[]): void {
  if (scope === "bullet" || scope === "selection") {
    if (typeof proposal !== "string" || proposal.trim().length === 0 || isMarkerOnly(proposal)) {
      throw new ScopedValidationError(scope === "bullet" ? "creator returned empty bullet output" : "creator returned empty selection output");
    }
    return;
  }
  if (!Array.isArray(proposal) || proposal.length === 0) {
    throw new ScopedValidationError("creator returned empty section output");
  }
  if (proposal.some((s) => s.trim().length === 0 || isMarkerOnly(s))) {
    throw new ScopedValidationError("creator returned an empty section bullet");
  }
}

function parseCheckerReply(text: string): AutoReviseScopedCheckerResult {
  const t = stripFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return { ok: false, issues: ["checker returned non-JSON output"] };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, issues: ["checker returned non-object"] };
  const p = parsed as Record<string, unknown>;
  const ok = p["ok"] === true;
  const issues = Array.isArray(p["issues"]) ? (p["issues"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { ok, issues };
}

function sumUsage(a: ClaudeUsage, b: ClaudeUsage): ClaudeUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

export function handleAutoReviseScoped(
  deps: Deps,
  req: AutoReviseScopedRequest,
): ApiResult<AutoReviseScopedSuccess> {
  log("info", "autoReviseScoped start", { scope: req.scope, sectionPath: req.sectionPath, useChecker: req.useChecker });

  let proposal: string | string[] | undefined;
  let checker: AutoReviseScopedCheckerResult | null = null;
  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let modelUsed = req.model;
  let priorIssues: string[] = [];

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { system, user } = buildCreatorPrompt(req, priorIssues);
      const creator = deps.claude.call({
        model: req.model,
        maxTokens: 1024,
        system: [{ type: "text", text: system }],
        messages: [{ role: "user", content: user }],
      });
      totalUsage = sumUsage(totalUsage, creator.usage);
      modelUsed = creator.model;
      proposal = parseCreatorReply(req.scope, creator.text);
      assertUsableProposal(req.scope, proposal);

      if (!req.useChecker) {
        checker = null;
        break;
      }

      const { system: csys, user: cuser } = buildCheckerPrompt(req, proposal);
      const checkerResp = deps.claude.call({
        model: req.model,
        maxTokens: 512,
        system: [{ type: "text", text: csys }],
        messages: [{ role: "user", content: cuser }],
      });
      totalUsage = sumUsage(totalUsage, checkerResp.usage);
      const verdict = parseCheckerReply(checkerResp.text);
      checker = verdict;

      if (verdict.ok || attempt === 1) break;
      priorIssues = verdict.issues;
    }
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      log("error", "autoReviseScoped Claude API error", { errorType: err.errorType, retryable: err.retryable });
      return { ok: false, error: { type: err.errorType, message: err.message, retryable: err.retryable } };
    }
    if (err instanceof ScopedValidationError) {
      log("warn", "autoReviseScoped validation failure", { error: err.message });
      return validationError(err.message);
    }
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "autoReviseScoped failure", { error: msg });
    return { ok: false, error: { type: "server", message: msg, retryable: true } };
  }

  if (checker !== null && !checker.ok) {
    const issues = checker.issues.length > 0 ? checker.issues.join("; ") : "checker rejected rewrite";
    const cost = calculateCost(totalUsage, modelUsed);
    log("warn", "autoReviseScoped checker rejected final proposal", { issues: checker.issues, cost: cost.totalUsd });
    return validationError(`checker rejected final proposal: ${issues}`);
  }

  const cost = calculateCost(totalUsage, modelUsed);
  log("info", "autoReviseScoped done", { scope: req.scope, checkerOk: checker?.ok ?? null, cost: cost.totalUsd });

  return {
    ok: true,
    replaceWith: proposal as string | string[],
    checker,
    cost,
  };
}
