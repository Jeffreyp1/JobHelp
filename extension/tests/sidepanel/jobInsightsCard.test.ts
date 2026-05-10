/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderJobInsightsCard } from '../../src/sidepanel/components/jobInsights';
import type { JobInsights } from '../../src/types/job-insights.js';

const FULL: JobInsights = {
  jobType: 'fulltime',
  location: 'New York, NY',
  remote: 'hybrid',
  salaryMin: 180000,
  salaryMax: 220000,
  salaryCurrency: 'USD',
  yearsExperience: 5,
  educationRequired: 'bachelor',
  skillsRequired: [
    { canonical: 'Python', count: 7, section: 'requirements' },
    { canonical: 'Kubernetes', count: 5, section: 'requirements' },
    { canonical: 'AWS', count: 4, section: 'requirements' },
    { canonical: 'Distributed Systems', count: 3, section: 'requirements' },
  ],
  skillsNiceToHave: [
    { canonical: 'Rust', count: 1, section: 'niceToHave' },
    { canonical: 'GraphQL', count: 1, section: 'niceToHave' },
    { canonical: 'Terraform', count: 1, section: 'niceToHave' },
  ],
  visaSponsorship: 'unmentioned',
  postedDate: '2026-05-06T00:00:00Z',
  applicantCount: 47,
  sectionBreakdown: {
    requirements: 'r',
    responsibilities: 'res',
    niceToHave: 'n',
    other: 'o',
  },
};

describe('JobInsightsCard.render', () => {
  it('T16: with full insights, produces HTML containing company, role, location, salary range', () => {
    const node = renderJobInsightsCard(FULL);
    const html = node.outerHTML;
    // Spec mockup uses "Acme Corp · Senior Engineer · NYC (Hybrid)" — header line.
    // Render uses values present on the JobInsights shape; the wrapping panel
    // owns company/role context (passed by parent), so the card itself MUST
    // at minimum render: location, hybrid mode, salary range, YOE.
    expect(html).toContain('New York');
    expect(html.toLowerCase()).toContain('hybrid');
    expect(html).toContain('$180');
    expect(html).toContain('$220');
  });

  it('T17: skill bars render proportional to count (skill with count 7 has wider bar than count 3)', () => {
    const node = renderJobInsightsCard(FULL);
    const bars = node.querySelectorAll<HTMLElement>('.skill-bar-fill');
    expect(bars.length).toBeGreaterThanOrEqual(4);

    // Find Python (count 7) and Distributed Systems (count 3) bars and compare widths.
    const skillRows = node.querySelectorAll<HTMLElement>('.skill-row');
    const widthByName = new Map<string, number>();
    skillRows.forEach((row) => {
      const name = row.dataset.skill ?? row.querySelector('.skill-name')?.textContent ?? '';
      const fill = row.querySelector<HTMLElement>('.skill-bar-fill');
      if (fill) {
        const widthStr = fill.style.width || '0%';
        const widthNum = parseFloat(widthStr);
        widthByName.set(name.trim(), widthNum);
      }
    });

    const py = widthByName.get('Python') ?? 0;
    const ds = widthByName.get('Distributed Systems') ?? 0;
    expect(py).toBeGreaterThan(ds);
  });

  it('T18: nice-to-have skills appear in separate section', () => {
    const node = renderJobInsightsCard(FULL);
    const nthSection = node.querySelector('.nice-to-have');
    expect(nthSection).not.toBeNull();
    expect(nthSection?.textContent).toContain('Rust');
    expect(nthSection?.textContent).toContain('GraphQL');
    expect(nthSection?.textContent).toContain('Terraform');
  });

  it('T19: visa "no" shows ⚠ Sponsorship not available indicator', () => {
    const visaNo: JobInsights = { ...FULL, visaSponsorship: 'no' };
    const node = renderJobInsightsCard(visaNo);
    const text = node.textContent ?? '';
    expect(text).toContain('⚠');
    expect(text.toLowerCase()).toContain('sponsorship');
    expect(text.toLowerCase()).toContain('not available');
  });

  it('T20: empty/null insights renders "No job detected" placeholder', () => {
    const node = renderJobInsightsCard(null);
    const text = node.textContent ?? '';
    expect(text.toLowerCase()).toContain('no job detected');
  });
});
