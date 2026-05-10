import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { scrapePage } from '../src/scraper.js';
import type { ScraperOutput } from '../src/types/scraper-output.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/scraper');

function load(name: string): { document: Document; html: string; url: string } {
  const html = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  const url = `https://example.com/${name}`;
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document as unknown as Document, html, url };
}

// Per-fixture URL overrides — many strategies key off hostname.
const FIXTURE_URLS: Record<string, string> = {
  'linkedin.html': 'https://www.linkedin.com/jobs/view/123456789',
  'indeed.html': 'https://www.indeed.com/viewjob?jk=abc123',
  'greenhouse.html': 'https://boards.greenhouse.io/lumenwave/jobs/4001',
  'lever.html': 'https://jobs.lever.co/halcyon/00000000-1111-2222-3333-444444444444',
  'workday.html': 'https://stratford.wd5.myworkdayjobs.com/External/job/Seattle/Principal-Machine-Learning-Engineer_R-2026-04-118',
  'ashby.html': 'https://jobs.ashbyhq.com/veridian/00000000',
  'generic-static.html': 'https://anvilcloud.example/careers/founding-backend',
  'generic-spa.html': 'https://krakenlabs.example/careers/senior-product-designer',
};

function loadFixture(name: string) {
  const html = readFileSync(join(FIXTURES_DIR, name), 'utf8');
  const url = FIXTURE_URLS[name] ?? `https://example.com/${name}`;
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document as unknown as Document, html, url };
}

describe('scrapePage', () => {
  // Cache scraped outputs per fixture so we don't re-scrape repeatedly.
  const outputs: Record<string, ScraperOutput> = {};

  beforeAll(async () => {
    for (const name of Object.keys(FIXTURE_URLS)) {
      const { document, url } = loadFixture(name);
      outputs[name] = await scrapePage({ document, url });
    }
  });

  // ────────────────────────── LinkedIn ──────────────────────────
  it('T1: linkedin.html — company === "ScaleStream Technologies"', () => {
    expect(outputs['linkedin.html'].company).toBe('ScaleStream Technologies');
  });

  it('T2: linkedin.html — role contains "Senior Backend Engineer"', () => {
    expect(outputs['linkedin.html'].role).toContain('Senior Backend Engineer');
  });

  it('T3: linkedin.html — jd.length > 500', () => {
    expect(outputs['linkedin.html'].jd.length).toBeGreaterThan(500);
  });

  it('T4: linkedin.html — scrapeStrategy === "linkedin"', () => {
    expect(outputs['linkedin.html'].scrapeStrategy).toBe('linkedin');
  });

  // ────────────────────────── Indeed ──────────────────────────
  it('T5: indeed.html — company "Northgate Robotics", strategy "indeed"', () => {
    const o = outputs['indeed.html'];
    expect(o.company).toBe('Northgate Robotics');
    expect(o.scrapeStrategy).toBe('indeed');
  });

  // ────────────────────────── Greenhouse ──────────────────────────
  it('T6: greenhouse.html — strategy "greenhouse", company "Lumenwave"', () => {
    const o = outputs['greenhouse.html'];
    expect(o.scrapeStrategy).toBe('greenhouse');
    expect(o.company).toBe('Lumenwave');
  });

  // ────────────────────────── Lever ──────────────────────────
  it('T7: lever.html — strategy "lever"', () => {
    expect(outputs['lever.html'].scrapeStrategy).toBe('lever');
  });

  // ────────────────────────── Workday ──────────────────────────
  it('T8: workday.html — strategy "workday"', () => {
    expect(outputs['workday.html'].scrapeStrategy).toBe('workday');
  });

  // ────────────────────────── Ashby ──────────────────────────
  it('T9: ashby.html — strategy "ashby"', () => {
    expect(outputs['ashby.html'].scrapeStrategy).toBe('ashby');
  });

  // ────────────────────────── Generic ──────────────────────────
  it('T10: generic-static.html — strategy "generic", non-empty jd', () => {
    const o = outputs['generic-static.html'];
    expect(o.scrapeStrategy).toBe('generic');
    expect(o.jd.length).toBeGreaterThan(0);
  });

  it('T11: generic-spa.html — strategy "generic", non-empty jd', () => {
    const o = outputs['generic-spa.html'];
    expect(o.scrapeStrategy).toBe('generic');
    expect(o.jd.length).toBeGreaterThan(0);
  });

  // ────────────────────────── Job Insights ──────────────────────────
  it('T12: jobInsights.skillsRequired contains at least 5 entries (linkedin)', () => {
    const insights = outputs['linkedin.html'].jobInsights;
    expect(insights).not.toBeNull();
    expect(insights!.skillsRequired.length).toBeGreaterThanOrEqual(5);
  });

  it('T13: jobInsights.salaryMin/Max parsed correctly for at least 5 of the 8 fixtures', () => {
    const fixtures = Object.keys(FIXTURE_URLS);
    let parsedCount = 0;
    for (const fx of fixtures) {
      const ji = outputs[fx].jobInsights;
      if (ji && ji.salaryMin !== null && ji.salaryMax !== null && ji.salaryMin > 0 && ji.salaryMax > ji.salaryMin) {
        parsedCount++;
      }
    }
    expect(parsedCount).toBeGreaterThanOrEqual(5);
  });

  it('T14: jobInsights.yearsExperience parsed correctly when "5+ years" appears', () => {
    // linkedin says "5+ years" → 5
    expect(outputs['linkedin.html'].jobInsights!.yearsExperience).toBe(5);
    // generic-spa says "5+ years"  → 5
    expect(outputs['generic-spa.html'].jobInsights!.yearsExperience).toBe(5);
    // indeed says "4+ years"
    expect(outputs['indeed.html'].jobInsights!.yearsExperience).toBe(4);
  });

  it('T15: jobInsights.location parsed (city or "Remote")', () => {
    for (const fx of Object.keys(FIXTURE_URLS)) {
      const ji = outputs[fx].jobInsights;
      expect(ji).not.toBeNull();
      expect(ji!.location).not.toBeNull();
      expect(ji!.location!.length).toBeGreaterThan(0);
    }
  });

  it('T16: jobInsights.remote === "hybrid" for fixtures mentioning hybrid', () => {
    expect(outputs['linkedin.html'].jobInsights!.remote).toBe('hybrid');
    expect(outputs['indeed.html'].jobInsights!.remote).toBe('hybrid');
    expect(outputs['ashby.html'].jobInsights!.remote).toBe('hybrid');
    expect(outputs['generic-spa.html'].jobInsights!.remote).toBe('hybrid');
  });

  it('T17: jobInsights.sectionBreakdown.requirements contains text from Requirements section', () => {
    const lk = outputs['linkedin.html'].jobInsights!;
    expect(lk.sectionBreakdown.requirements.length).toBeGreaterThan(0);
    // From the LinkedIn Requirements section:
    expect(lk.sectionBreakdown.requirements.toLowerCase()).toContain('5+ years');
    // Lever uses "What we're looking for"
    const lv = outputs['lever.html'].jobInsights!;
    expect(lv.sectionBreakdown.requirements.toLowerCase()).toContain('react');
  });

  it('T18: jobInsights.visaSponsorship — "no" for indeed, "yes" for linkedin/greenhouse/lever, etc.', () => {
    expect(outputs['indeed.html'].jobInsights!.visaSponsorship).toBe('no');
    // Linkedin says "Sponsorship for work authorization is available"
    expect(outputs['linkedin.html'].jobInsights!.visaSponsorship).toBe('yes');
    // Greenhouse: "will sponsor work authorization"
    expect(outputs['greenhouse.html'].jobInsights!.visaSponsorship).toBe('yes');
    // Lever: "We sponsor visas"
    expect(outputs['lever.html'].jobInsights!.visaSponsorship).toBe('yes');
    // Workday: "will sponsor work authorization"
    expect(outputs['workday.html'].jobInsights!.visaSponsorship).toBe('yes');
    // Ashby: "unable to sponsor visas"
    expect(outputs['ashby.html'].jobInsights!.visaSponsorship).toBe('no');
    // generic-spa: "We are unable to sponsor visas"
    expect(outputs['generic-spa.html'].jobInsights!.visaSponsorship).toBe('no');
    // generic-static — no sponsorship language
    expect(outputs['generic-static.html'].jobInsights!.visaSponsorship).toBe('unmentioned');
  });

  it('T19: empty/garbage HTML returns scrapeStrategy "failed", jobInsights null', async () => {
    const dom = new JSDOM('<html><body></body></html>', { url: 'https://random.example/empty' });
    const out = await scrapePage({ document: dom.window.document as unknown as Document, url: 'https://random.example/empty' });
    expect(out.scrapeStrategy).toBe('failed');
    expect(out.jobInsights).toBeNull();
    expect(out.jd).toBe('');
  });

  it('T20: scrapePage executes in <100ms for the largest fixture', async () => {
    // Determine the largest fixture by HTML size.
    let largest = '';
    let largestSize = 0;
    for (const fx of Object.keys(FIXTURE_URLS)) {
      const html = readFileSync(join(FIXTURES_DIR, fx), 'utf8');
      if (html.length > largestSize) {
        largestSize = html.length;
        largest = fx;
      }
    }
    const { document, url } = loadFixture(largest);
    const start = performance.now();
    await scrapePage({ document, url });
    const elapsed = performance.now() - start;
    // Allow a generous-but-still-meaningful budget.
    expect(elapsed).toBeLessThan(100);
  });
});
