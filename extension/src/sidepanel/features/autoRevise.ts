import { applyBulletEdit, applySectionEdit, validateByteEqualityOutsideEdits } from "../../lib/anchor-replace.js";
import type { AutoReviseScopedRequest, AutoReviseScopedResponse } from "../../types/api-contract.js";

interface ApiSurface {
  autoReviseScoped: (req: AutoReviseScopedRequest) => Promise<AutoReviseScopedResponse>;
}

export interface RunScopedReviseArgs {
  api: ApiSurface;
  slot: HTMLElement;
  scope: "bullet" | "section";
  currentMarkdown: string;
  bulletText?: string;
  sectionPath: string;
  instruction: string;
  model: string;
  useChecker?: boolean;
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

  let resp: AutoReviseScopedResponse;
  try {
    resp = await api.autoReviseScoped({
      scope,
      excerpt: scope === "bullet" ? (bulletText ?? "") : extractSectionExcerpt(currentMarkdown, sectionPath),
      sectionPath,
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

  let next: string;
  let editedLineIndices: number[];
  let replaceWithStr: string | null = null;
  let replaceWithArr: string[] | null = null;
  try {
    if (scope === "bullet") {
      if (typeof resp.replaceWith !== "string") throw new Error("server returned non-string replaceWith for bullet");
      replaceWithStr = resp.replaceWith;
      const result = applyBulletEdit(currentMarkdown, bulletText ?? "", sectionPath, replaceWithStr);
      next = result.next;
      editedLineIndices = result.editedLineIndices;
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

  const replacements = Array.isArray(resp.replaceWith) ? resp.replaceWith : [resp.replaceWith];
  const validation = validateByteEqualityOutsideEdits(currentMarkdown, next, editedLineIndices, replacements);
  if (!validation.ok) {
    writeSlot(errorNode(`Safety check failed: ${validation.errors.join("; ")}`));
    return;
  }

  const diffBlock = document.createElement("div");
  diffBlock.className = "revise-diff";

  if (resp.checker && resp.checker.ok === false) {
    const warn = document.createElement("div");
    warn.className = "revise-warning";
    warn.innerHTML =
      `<strong>Warnings:</strong> ` +
      resp.checker.issues.map((s) => `<span class="warn-chip">${escapeHtml(s)}</span>`).join(" ");
    diffBlock.appendChild(warn);
  }

  const row = document.createElement("div");
  row.className = "revise-diff__row";
  if (scope === "bullet") {
    row.innerHTML = `
      <div class="revise-diff__before">${escapeHtml(bulletText ?? "")}</div>
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
    onAccept(next);
    writeSlot(null);
  });
  reject.addEventListener("click", () => {
    onReject();
    writeSlot(null);
  });
}
