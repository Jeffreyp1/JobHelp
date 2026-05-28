/**
 * Job Insights card component.
 *
 * Renders the structured metadata extracted by the scraper into a compact
 * card matching the design doc Section 8 mockup:
 *
 *   ┌─ Job Insights ─────────────────────────────────┐
 *   │ NYC (Hybrid)                                   │
 *   │ $180k-$220k · 5+ years · BS/MS in CS           │
 *   │ Posted 3 days ago · 47 applicants              │
 *   │                                                │
 *   │ Top required skills:                           │
 *   │   Python ●●●●●●●  Kubernetes ●●●●●             │
 *   │   AWS ●●●●  Distributed Systems ●●●            │
 *   │                                                │
 *   │ Nice-to-have: Rust, GraphQL, Terraform         │
 *   │                                                │
 *   │ ⚠ Sponsorship: NOT mentioned                   │
 *   └─────────────────────────────────────────────────┘
 *
 * Pure DOM construction. The parent owns company/role/url which are passed
 * separately to the Generate tab — the card here is metadata-only.
 */
import type { JobInsights } from '../../types/job-insights.js';

const ED_LABELS: Record<NonNullable<JobInsights['educationRequired']>, string> = {
  highschool: 'High school',
  associate: 'Associate degree',
  bachelor: "Bachelor's",
  master: "Master's",
  phd: 'PhD',
};

const REMOTE_LABELS: Record<NonNullable<JobInsights['remote']>, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

/** Format a salary number to "$180k", "$220k", "$1.2M". */
function formatSalary(n: number, currency: string | null): string {
  const symbol = currency === 'USD' || currency === null ? '$' : `${currency} `;
  if (n >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${symbol}${Math.round(n / 1_000)}k`;
  return `${symbol}${n}`;
}

function formatPostedDate(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const now = Date.now();
  const diffDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;
  if (diffDays === 0) return 'Posted today';
  if (diffDays === 1) return 'Posted yesterday';
  if (diffDays < 30) return `Posted ${diffDays} days ago`;
  if (diffDays < 365) {
    const m = Math.floor(diffDays / 30);
    return `Posted ${m} month${m === 1 ? '' : 's'} ago`;
  }
  const y = Math.floor(diffDays / 365);
  return `Posted ${y} year${y === 1 ? '' : 's'} ago`;
}

/** Build a simple element with optional class + text. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Render the Job Insights card. */
export function renderJobInsightsCard(insights: JobInsights | null): HTMLElement {
  const card = el('section', 'job-insights-card');
  card.setAttribute('aria-label', 'Job Insights');

  const heading = el('h2', 'job-insights-title', 'Job Insights');
  card.appendChild(heading);

  if (!insights) {
    const placeholder = el(
      'p',
      'job-insights-empty',
      'No job detected. Open a job posting to see insights here.',
    );
    card.appendChild(placeholder);
    return card;
  }

  // ─── Header line: location + remote mode ────────────────────────────
  const header = el('div', 'job-insights-header');
  const headerParts: string[] = [];
  if (insights.location) headerParts.push(insights.location);
  if (insights.remote) headerParts.push(`(${REMOTE_LABELS[insights.remote]})`);
  if (headerParts.length) {
    header.appendChild(el('span', 'job-insights-location', headerParts.join(' ')));
  }
  if (insights.jobType) {
    const jt = el('span', 'job-insights-jobtype', insights.jobType);
    header.appendChild(jt);
  }
  if (header.childNodes.length) card.appendChild(header);

  // ─── Compensation / experience / education line ────────────────────
  const compParts: string[] = [];
  if (insights.salaryMin !== null && insights.salaryMax !== null) {
    compParts.push(
      `${formatSalary(insights.salaryMin, insights.salaryCurrency)}-${formatSalary(
        insights.salaryMax,
        insights.salaryCurrency,
      )}`,
    );
  } else if (insights.salaryMin !== null) {
    compParts.push(`${formatSalary(insights.salaryMin, insights.salaryCurrency)}+`);
  }
  if (insights.yearsExperience !== null) {
    compParts.push(`${insights.yearsExperience}+ years`);
  }
  if (insights.educationRequired) {
    compParts.push(ED_LABELS[insights.educationRequired]);
  }
  if (compParts.length) {
    card.appendChild(el('div', 'job-insights-comp', compParts.join(' · ')));
  }

  // ─── Posted / applicants line ──────────────────────────────────────
  const activityParts: string[] = [];
  const posted = formatPostedDate(insights.postedDate);
  if (posted) activityParts.push(posted);
  if (insights.applicantCount !== null) {
    activityParts.push(`${insights.applicantCount} applicants`);
  }
  if (activityParts.length) {
    card.appendChild(el('div', 'job-insights-activity', activityParts.join(' · ')));
  }

  // ─── Skills section ────────────────────────────────────────────────
  if (insights.skillsRequired.length > 0) {
    const skillsBlock = el('div', 'job-insights-skills');
    skillsBlock.appendChild(el('h3', 'skills-title', 'Top required skills'));
    const maxCount = Math.max(...insights.skillsRequired.map((s) => s.count), 1);
    // Show top ~8
    const top = insights.skillsRequired.slice(0, 8);
    for (const skill of top) {
      const row = el('div', 'skill-row');
      row.dataset.skill = skill.canonical;
      row.appendChild(el('span', 'skill-name', skill.canonical));
      const barWrap = el('span', 'skill-bar');
      const fill = el('span', 'skill-bar-fill');
      const pct = Math.max(8, Math.round((skill.count / maxCount) * 100));
      fill.style.width = `${pct}%`;
      fill.setAttribute('aria-label', `${skill.count} occurrences`);
      barWrap.appendChild(fill);
      row.appendChild(barWrap);
      row.appendChild(el('span', 'skill-count', String(skill.count)));
      skillsBlock.appendChild(row);
    }
    card.appendChild(skillsBlock);
  }

  // ─── Nice-to-have section ──────────────────────────────────────────
  if (insights.skillsNiceToHave.length > 0) {
    const nth = el('div', 'nice-to-have');
    nth.appendChild(el('span', 'nth-label', 'Nice-to-have: '));
    nth.appendChild(
      el(
        'span',
        'nth-list',
        insights.skillsNiceToHave.map((s) => s.canonical).join(', '),
      ),
    );
    card.appendChild(nth);
  }

  // ─── Visa indicator ────────────────────────────────────────────────
  const visa = el('div', 'job-insights-visa');
  if (insights.visaSponsorship === 'no') {
    visa.classList.add('visa-warn');
    visa.textContent = '⚠ Sponsorship: not available';
  } else if (insights.visaSponsorship === 'yes') {
    visa.classList.add('visa-ok');
    visa.textContent = '✓ Sponsorship: available';
  } else {
    visa.classList.add('visa-unknown');
    visa.textContent = 'Sponsorship: not mentioned';
  }
  card.appendChild(visa);

  return card;
}
