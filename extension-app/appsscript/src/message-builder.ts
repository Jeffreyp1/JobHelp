/**
 * Composes the user-facing portion of a Claude prompt from the request inputs.
 * Shared by Code.ts (generate flow) and handlers/multiVersion.ts (fan-out flow)
 * so the framing-directive variants stay in lockstep with the canonical shape.
 */

import type { JobInsights } from './types/job-insights.js';

export interface UserMessageParts {
  jd: string;
  company: string | null;
  role: string | null;
  jobInsightsSummary: string;
  sourceMaterialsText: string;
  /** Optional pre-fetched research summary (rendered under "=== Company Research ==="). */
  researchSummary?: string;
  /** Optional pre-fetched LinkedIn role benchmark text (rendered under "=== Role Benchmark ==="). */
  benchmarkPatterns?: string;
  /** When false, the trailing "Output ONLY the resume markdown" instruction is omitted. */
  appendFinalInstruction?: boolean;
}

export function buildJobInsightsSummary(insights: JobInsights): string {
  const lines: string[] = [];
  if (insights.jobType) lines.push(`Job type: ${insights.jobType}`);
  if (insights.location) {
    lines.push(`Location: ${insights.location}${insights.remote ? ` (${insights.remote})` : ''}`);
  }
  if (insights.salaryMin !== null) {
    lines.push(
      `Salary: $${insights.salaryMin.toLocaleString()}–$${(insights.salaryMax ?? 0).toLocaleString()} ${insights.salaryCurrency ?? ''}`,
    );
  }
  if (insights.yearsExperience !== null) lines.push(`Experience: ${insights.yearsExperience}+ years`);
  if (insights.educationRequired) lines.push(`Education: ${insights.educationRequired}`);
  if (insights.skillsRequired.length > 0) {
    lines.push(`Required skills: ${insights.skillsRequired.map(s => s.canonical).join(', ')}`);
  }
  if (insights.skillsNiceToHave.length > 0) {
    lines.push(`Nice-to-have skills: ${insights.skillsNiceToHave.map(s => s.canonical).join(', ')}`);
  }
  if (insights.visaSponsorship !== 'unmentioned') {
    lines.push(`Visa sponsorship: ${insights.visaSponsorship}`);
  }
  return lines.join('\n');
}

export function buildUserMessage(parts: UserMessageParts): string {
  const sections: string[] = [];

  if (parts.company || parts.role) {
    sections.push(`Position: ${[parts.role, parts.company].filter(Boolean).join(' at ')}`);
  }

  if (parts.jobInsightsSummary) {
    sections.push(`=== Job Insights ===\n${parts.jobInsightsSummary}`);
  }

  if (parts.researchSummary && parts.researchSummary.trim()) {
    sections.push(`=== Company Research ===\n${parts.researchSummary.trim()}`);
  }

  if (parts.benchmarkPatterns && parts.benchmarkPatterns.trim()) {
    sections.push(`=== Role Benchmark ===\n${parts.benchmarkPatterns.trim()}`);
  }

  sections.push(`=== Job Description ===\n${parts.jd}`);
  sections.push(`=== Source Materials ===\n${parts.sourceMaterialsText}`);

  if (parts.appendFinalInstruction !== false) {
    sections.push(
      'Using the rules above and the candidate\'s source materials, produce a tailored resume in Markdown. ' +
      'Output ONLY the resume markdown with no preamble or explanation.',
    );
  }

  return sections.join('\n\n');
}
