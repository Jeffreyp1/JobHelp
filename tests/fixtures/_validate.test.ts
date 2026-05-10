import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRAPER_DIR = join(__dirname, "scraper");
const SOURCE_DIR = join(__dirname, "source-materials");
const API_DIR = join(__dirname, "api-responses");

const SCRAPER_FIXTURES = [
  "linkedin.html",
  "indeed.html",
  "greenhouse.html",
  "lever.html",
  "workday.html",
  "ashby.html",
  "generic-static.html",
  "generic-spa.html",
];

describe("fixtures", () => {
  it("T1: scraper fixtures all present", () => {
    for (const f of SCRAPER_FIXTURES) {
      expect(existsSync(join(SCRAPER_DIR, f)), `missing ${f}`).toBe(true);
    }
  });

  it("T2: each HTML fixture is between 2KB and 500KB", () => {
    for (const f of SCRAPER_FIXTURES) {
      const size = statSync(join(SCRAPER_DIR, f)).size;
      expect(size, `${f} size ${size}`).toBeGreaterThan(2_000);
      expect(size, `${f} size ${size}`).toBeLessThan(500_000);
    }
  });

  it("T3: each HTML fixture has a <title> tag", () => {
    for (const f of SCRAPER_FIXTURES) {
      const html = readFileSync(join(SCRAPER_DIR, f), "utf8");
      expect(html, f).toMatch(/<title>[^<]+<\/title>/i);
    }
  });

  it("T4: each HTML fixture looks like a job page", () => {
    for (const f of SCRAPER_FIXTURES) {
      const html = readFileSync(join(SCRAPER_DIR, f), "utf8");
      expect(html, f).toMatch(/(senior|engineer|developer|manager|analyst)/i);
    }
  });

  it("T5: sample source materials has required sections", () => {
    const path = join(SOURCE_DIR, "sample-source-materials.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toMatch(/##\s+Experience/);
    expect(content).toMatch(/##\s+Skills/);
    expect(content).toMatch(/##\s+Education/);
  });

  it("T6: sample template has placeholders", () => {
    const path = join(SOURCE_DIR, "sample-template.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toMatch(/\{\{NAME\}\}/);
    expect(content).toMatch(/\{\{COMPANY\}\}/);
  });

  it("T7: claude success response has valid shape", () => {
    const path = join(API_DIR, "claude-success.json");
    expect(existsSync(path)).toBe(true);
    const obj = JSON.parse(readFileSync(path, "utf8"));
    expect(obj).toHaveProperty("content");
    expect(obj).toHaveProperty("usage");
    expect(obj).toHaveProperty("stop_reason");
  });

  it("T8: claude rate-limit response has valid shape", () => {
    const path = join(API_DIR, "claude-rate-limit.json");
    expect(existsSync(path)).toBe(true);
    const obj = JSON.parse(readFileSync(path, "utf8"));
    expect(obj.error?.type).toBe("rate_limit_error");
  });
});
