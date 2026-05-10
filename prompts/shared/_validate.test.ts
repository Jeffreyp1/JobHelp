// Validators for prompts/shared/ rule files.
// All 10 assertions must pass before rule files are considered complete.
// Run: `npx vitest run prompts/shared/_validate.test.ts`

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SHARED_DIR = path.dirname(new URL(import.meta.url).pathname);

const FILENAME_RE = /^\d{2}-[a-z-]+\.md$/;

const LOAD_BEARING_FILES = new Set([
  "02-anti-fabrication.md",
  "06-bullet-construction.md",
  "08-bridge-language.md",
  "11-self-scan-checklist.md",
]);

const T5_BANNED_WORDS = [
  "delve",
  "leverage",
  "utilize",
  "harness",
  "spearhead",
  "tapestry",
  "synergy",
];

interface Frontmatter {
  raw: string;
  body: string;
  parsed: Record<string, string>;
}

function parseFrontmatter(content: string): Frontmatter | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const raw = content.slice(4, end);
  const body = content.slice(end + 5);
  const parsed: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (m) parsed[m[1]] = m[2].trim();
  }
  return { raw, body, parsed };
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function getMarkdownFiles(): string[] {
  return fs
    .readdirSync(SHARED_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

function readFile(name: string): string {
  return fs.readFileSync(path.join(SHARED_DIR, name), "utf8");
}

describe("prompts/shared/ rule file validators", () => {
  it("T1: every file matches pattern ^\\d{2}-[a-z-]+\\.md$", () => {
    const files = getMarkdownFiles();
    expect(files.length, "no markdown files found").toBeGreaterThan(0);
    for (const f of files) {
      expect(FILENAME_RE.test(f), `bad filename: ${f}`).toBe(true);
    }
  });

  it("T2: every file has YAML frontmatter with file_id, load_bearing (boolean), description", () => {
    const files = getMarkdownFiles();
    for (const f of files) {
      const fm = parseFrontmatter(readFile(f));
      expect(fm, `missing frontmatter: ${f}`).not.toBeNull();
      const p = fm!.parsed;
      expect(p.file_id, `file_id missing in ${f}`).toBeDefined();
      expect(/^\d+$/.test(p.file_id), `file_id not numeric in ${f}`).toBe(true);
      expect(p.load_bearing, `load_bearing missing in ${f}`).toBeDefined();
      expect(
        p.load_bearing === "true" || p.load_bearing === "false",
        `load_bearing not boolean in ${f}: ${p.load_bearing}`,
      ).toBe(true);
      expect(p.description, `description missing in ${f}`).toBeDefined();
      expect(p.description.length, `empty description in ${f}`).toBeGreaterThan(0);
    }
  });

  it("T3: only the 4 specified files are load_bearing: true", () => {
    const files = getMarkdownFiles();
    for (const f of files) {
      const fm = parseFrontmatter(readFile(f));
      const isLB = fm!.parsed.load_bearing === "true";
      const shouldBeLB = LOAD_BEARING_FILES.has(f);
      expect(
        isLB,
        `${f}: load_bearing=${isLB}, expected ${shouldBeLB}`,
      ).toBe(shouldBeLB);
    }
  });

  it("T4: each file is under 1500 tokens (chars/4 estimate)", () => {
    const files = getMarkdownFiles();
    for (const f of files) {
      const t = tokenEstimate(readFile(f));
      expect(t, `${f}: ${t} tokens (>=1500)`).toBeLessThan(1500);
    }
  });

  it("T5: 03-banned-words.md contains all required Tier 1 banned strings", () => {
    const c = readFile("03-banned-words.md").toLowerCase();
    for (const w of T5_BANNED_WORDS) {
      expect(c.includes(w.toLowerCase()), `missing word: ${w}`).toBe(true);
    }
  });

  it("T6: 06-bullet-construction.md contains the verb+number/artifact rule", () => {
    const c = readFile("06-bullet-construction.md");
    expect(
      c.includes("every bullet must contain a number OR a concrete proper-noun artifact"),
    ).toBe(true);
  });

  it("T7: 05-structural-rules.md contains the no -ing analysis bullet ending rule", () => {
    const c = readFile("05-structural-rules.md").toLowerCase();
    // Must mention -ing endings on bullets being banned
    expect(c.includes("-ing")).toBe(true);
    expect(
      c.includes("ending") || c.includes("end with") || c.includes("endings"),
    ).toBe(true);
    expect(c.includes("bullet")).toBe(true);
  });

  it("T8: 07-reframing-strategies.md references all 4 named strategies", () => {
    const c = readFile("07-reframing-strategies.md");
    expect(c.includes("Keyword Alignment")).toBe(true);
    expect(c.includes("Emphasis Shift")).toBe(true);
    expect(c.includes("Abstraction Level")).toBe(true);
    expect(c.includes("Scale Emphasis")).toBe(true);
  });

  it("T9: 10-cover-letter-industry.md specifies 250-300 words and 3 paragraphs", () => {
    const c = readFile("10-cover-letter-industry.md");
    expect(c.includes("250-300 words")).toBe(true);
    expect(c.includes("3 paragraphs")).toBe(true);
  });

  it("T10: total token count of all 12 files is between 5000 and 10000 tokens", () => {
    const files = getMarkdownFiles();
    expect(files.length).toBe(12);
    let total = 0;
    for (const f of files) total += tokenEstimate(readFile(f));
    expect(total, `total tokens: ${total}`).toBeGreaterThanOrEqual(5000);
    expect(total, `total tokens: ${total}`).toBeLessThanOrEqual(10000);
  });
});
