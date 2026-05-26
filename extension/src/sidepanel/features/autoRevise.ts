import { applyBulletEdit, applySectionEdit, findAnchorLine, validateByteEqualityOutsideEdits } from "../../lib/anchor-replace.js";
import { replaceMarkdownRange, type MarkdownRange } from "../../lib/resume-selection.js";
import type { AutoReviseScopedRequest, AutoReviseScopedResponse } from "../../types/api-contract.js";

interface ApiSurface {
  autoReviseScoped: (req: AutoReviseScopedRequest) => Promise<AutoReviseScopedResponse>;
}

export interface RunScopedReviseArgs {
  api: ApiSurface;
  slot: HTMLElement;
  scope: "bullet" | "section" | "selection";
  currentMarkdown: string;
  bulletText?: string;
  selection?: MarkdownRange & { excerpt: string; sectionName: string };
  sectionPath: string;
  instruction: string;
  model: string;
  useChecker?: boolean;
  getCurrentMarkdown?: () => string;
  onAccept: (nextMarkdown: string) => void;
  onReject: () => void;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadingNode(): HTMLElement {
  const n = document.createElement("div");
  n.className = "revise-loading";
  n.textContent = "Revising…";
  return n;
}

function errorNode(msg: string): HTMLElement {
  const n = document.createElement("div");
  n.className = "revise-error";
  n.textContent = msg;
  return n;
}

function extractSectionExcerpt(md: string, sectionName: string): string {
  const lines = md.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h && h[1].trim() === sectionName) {
      start = i;
      break;
    }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function bulletLineMatchesExcerpt(md: string, sectionName: string, excerpt: string): boolean {
  try {
    const lines = md.split("\n");
    const idx = findAnchorLine(lines, excerpt, sectionName);
    const content = lines[idx].match(/^\s*-\s+(.*)$/)?.[1];
    return content === excerpt;
  } catch {
    return false;
  }
}

function preserveTrailingDelimiter(original: string, replacement: string): string {
  const delimiter = original.endsWith("\r\n") ? "\r\n" : original.endsWith("\n") ? "\n" : original.endsWith("\r") ? "\r" : "";
  if (!delimiter || replacement.endsWith("\n") || replacement.endsWith("\r")) return replacement;
  return `${replacement}${delimiter}`;
}

export async function runScopedRevise(args: RunScopedReviseArgs): Promise<void> {
  const { api, slot, scope, currentMarkdown, bulletText, sectionPath, instruction, model, onAccept, onReject } = args;
  const useChecker = args.useChecker ?? true;

  slot.replaceChildren(loadingNode());

  const writeSlot = (node: Node | null): boolean => {
    if (!slot.isConnected) return false;
    if (node === null) slot.replaceChildren();
    else slot.replaceChildren(node);
    return true;
  };

  const selection = args.selection;
  if (scope === "selection" && selection && currentMarkdown.slice(selection.from, selection.to) !== selection.excerpt) {
    slot.replaceChildren(errorNode("Selection changed. Select the text again and retry."));
    return;
  }

  let resp: AutoReviseScopedResponse;
  const requestExcerpt =
    scope === "bullet"
      ? (bulletText ?? "")
      : scope === "selection"
        ? (selection?.excerpt ?? "")
        : extractSectionExcerpt(currentMarkdown, sectionPath);
  try {
    resp = await api.autoReviseScoped({
      scope,
      excerpt: requestExcerpt,
      sectionPath: scope === "selection" ? (selection?.sectionName ?? sectionPath) : sectionPath,
      instruction,
      model,
      useChecker,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeSlot(errorNode(`Revise failed: ${msg}`));
    return;
  }
  if (!resp.ok) {
    writeSlot(errorNode(`Revise failed: ${resp.error.message}`));
    return;
  }
  if (resp.checker && resp.checker.ok === false) {
    const issues = resp.checker.issues.length > 0 ? resp.checker.issues.join("; ") : "checker rejected rewrite";
    writeSlot(errorNode(`Safety check failed: ${issues}`));
    return;
  }

  let next: string;
  let editedLineIndices: number[];
  let replaceWithStr: string | null = null;
  let replaceWithArr: string[] | null = null;
  try {
    if (scope === "bullet") {
      if (typeof resp.replaceWith !== "string") throw new Error("server returned non-string replaceWith for bullet");
      replaceWithStr = resp.replaceWith;
      const result = applyBulletEdit(currentMarkdown, requestExcerpt, sectionPath, replaceWithStr);
      next = result.next;
      editedLineIndices = result.editedLineIndices;
    } else if (scope === "selection") {
      if (typeof resp.replaceWith !== "string") throw new Error("server returned non-string replaceWith for selection");
      if (!args.selection) throw new Error("selection metadata missing");
      replaceWithStr = preserveTrailingDelimiter(requestExcerpt, resp.replaceWith);
      next = replaceMarkdownRange(currentMarkdown, args.selection, replaceWithStr);
      editedLineIndices = [];
    } else {
      if (!Array.isArray(resp.replaceWith)) throw new Error("server returned non-array replaceWith for section");
      replaceWithArr = resp.replaceWith;
      const result = applySectionEdit(currentMarkdown, sectionPath, replaceWithArr);
      next = result.next;
      editedLineIndices = result.editedLineIndices;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeSlot(errorNode(`Could not locate the target in your resume: ${msg}`));
    return;
  }

  if (scope !== "selection") {
    const replacements = Array.isArray(resp.replaceWith) ? resp.replaceWith : [resp.replaceWith];
    const validation = validateByteEqualityOutsideEdits(currentMarkdown, next, editedLineIndices, replacements);
    if (!validation.ok) {
      writeSlot(errorNode(`Safety check failed: ${validation.errors.join("; ")}`));
      return;
    }
  }

  const diffBlock = document.createElement("div");
  diffBlock.className = "revise-diff";

  const row = document.createElement("div");
  row.className = "revise-diff__row";
  if (scope === "bullet") {
    row.innerHTML = `
      <div class="revise-diff__before">${escapeHtml(requestExcerpt)}</div>
      <div class="revise-diff__after">${escapeHtml(replaceWithStr!)}</div>`;
  } else if (scope === "selection") {
    row.innerHTML = `
      <div class="revise-diff__before">${escapeHtml(requestExcerpt)}</div>
      <div class="revise-diff__after">${escapeHtml(replaceWithStr!)}</div>`;
  } else {
    const after = replaceWithArr!.map((b) => `- ${escapeHtml(b)}`).join("<br>");
    row.classList.add("revise-diff__row--section");
    row.innerHTML = `
      <div class="revise-diff__before"><em>(section replaced)</em></div>
      <div class="revise-diff__after">${after}</div>`;
  }
  diffBlock.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "revise-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "btn btn-primary";
  accept.setAttribute("data-action", "accept");
  accept.textContent = "Accept";
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "btn btn-secondary";
  reject.setAttribute("data-action", "reject");
  reject.textContent = "Reject";
  actions.appendChild(accept);
  actions.appendChild(reject);
  diffBlock.appendChild(actions);

  if (!writeSlot(diffBlock)) return;

  accept.addEventListener("click", () => {
    let acceptedNext: string;
    try {
      const latestMarkdown = args.getCurrentMarkdown ? args.getCurrentMarkdown() : currentMarkdown;
      if (scope === "bullet") {
        if (!bulletLineMatchesExcerpt(latestMarkdown, sectionPath, requestExcerpt)) {
          writeSlot(errorNode("Target bullet changed. Review the latest resume and retry."));
          return;
        }
        const result = applyBulletEdit(latestMarkdown, requestExcerpt, sectionPath, replaceWithStr!);
        acceptedNext = result.next;
        const validation = validateByteEqualityOutsideEdits(
          latestMarkdown,
          acceptedNext,
          result.editedLineIndices,
          [replaceWithStr!],
        );
        if (!validation.ok) {
          writeSlot(errorNode(`Safety check failed: ${validation.errors.join("; ")}`));
          return;
        }
      } else if (scope === "selection") {
        if (!args.selection) throw new Error("selection metadata missing");
        if (latestMarkdown.slice(args.selection.from, args.selection.to) !== requestExcerpt) {
          writeSlot(errorNode("Selection changed. Select the text again and retry."));
          return;
        }
        acceptedNext = replaceMarkdownRange(latestMarkdown, args.selection, replaceWithStr!);
      } else {
        if (extractSectionExcerpt(latestMarkdown, sectionPath) !== requestExcerpt) {
          writeSlot(errorNode("Target section changed. Review the latest resume and retry."));
          return;
        }
        const result = applySectionEdit(latestMarkdown, sectionPath, replaceWithArr!);
        acceptedNext = result.next;
        const replacements = replaceWithArr!;
        const validation = validateByteEqualityOutsideEdits(
          latestMarkdown,
          acceptedNext,
          result.editedLineIndices,
          replacements,
        );
        if (!validation.ok) {
          writeSlot(errorNode(`Safety check failed: ${validation.errors.join("; ")}`));
          return;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeSlot(errorNode(`Could not locate the target in your resume: ${msg}`));
      return;
    }
    onAccept(acceptedNext);
    writeSlot(null);
  });
  reject.addEventListener("click", () => {
    onReject();
    writeSlot(null);
  });
}
