// Render a resume markdown into the sb2nov / "Jake" LaTeX template (.tex).
// Usage: npx tsx scripts/render-jaketex.mts <resume.md> [out.tex]
// Compile with: tectonic <out.tex>   (or pdflatex/xelatex). Output PDF matches the original template.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const inPath = process.argv[2];
if (!inPath) { console.error('usage: npx tsx scripts/render-jaketex.mts <resume.md> [out.tex]'); process.exit(2); }
const outTex = process.argv[3] ? resolve(process.argv[3]) : resolve(dirname(inPath), basename(inPath).replace(/\.md$/i, '.tex'));
const md = readFileSync(inPath, 'utf8');

const PREAMBLE = String.raw`%-------------------------
% Resume in Latex
% Based off of: https://github.com/sb2nov/resume
% License : MIT
%-------------------------
\documentclass[letterpaper,11pt]{article}
\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}
\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}
\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}
\titleformat{\section}{\vspace{-4pt}\scshape\raggedright\large}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]
\ifdefined\pdfgentounicode \input{glyphtounicode} \pdfgentounicode=1 \fi
\newcommand{\resumeItem}[1]{\item\small{{#1 \vspace{-2pt}}}}
\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small#3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeProjectHeading}[2]{
  \item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \small#1 & #2 \\
  \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}
`;

function escapeTex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '$\\sim$')
    .replace(/\^/g, '\\^{}')
    .replace(/→|->/g, '$\\rightarrow$')
    .replace(/—/g, '---')
    .replace(/–/g, '--');
}
// Convert markdown inline (**bold**) to LaTeX while escaping the rest.
function inlineTex(s: string): string {
  return s.split('**').map((p, i) => (i % 2 === 1 ? `\\textbf{${escapeTex(p)}}` : escapeTex(p))).join('');
}

const CANONICAL_SECTION: Record<string, string> = {
  'summary': 'summary',
  'skills': 'skills',
  'technical skills': 'skills',
  'skills & tools': 'skills',
  'skills and tools': 'skills',
  'core skills': 'skills',
  'experience': 'experience',
  'work experience': 'experience',
  'employment': 'experience',
  'employment history': 'experience',
  'professional experience': 'experience',
  'projects': 'projects',
  'personal projects': 'projects',
  'selected projects': 'projects',
  'education': 'education',
};

// --- parse the markdown into header + sections ---
const lines = md.split(/\r?\n/);
let name = '', contact = '';
type ParsedSection = { raw: string; canon: string | undefined; lines: string[] };
const parsed: ParsedSection[] = [];
let cur: ParsedSection | null = null;
for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^#\s+(.+)$/))) { name = m[1].trim(); continue; }
  if ((m = line.match(/^##\s+(.+)$/))) {
    const heading = m[1].trim();
    cur = { raw: heading, canon: CANONICAL_SECTION[heading.toLowerCase().replace(/\s+/g, ' ')], lines: [] };
    parsed.push(cur);
    continue;
  }
  if (!name) continue;
  if (!cur) { if (line.trim() && !contact) contact = line.trim(); continue; }
  cur.lines.push(line);
}

const hasContent = (ls: string[]): boolean => ls.some(l => l.trim());
const sec: Record<string, string[]> = {};
const errors: string[] = [];
for (const s of parsed) {
  if (!s.canon) {
    if (hasContent(s.lines)) errors.push(`unrecognized section '## ${s.raw}' — its content would be silently dropped from the PDF`);
    continue;
  }
  (sec[s.canon] ??= []).push(...s.lines);
}
if (!name) errors.push(`no top-level '# Name' heading found`);
if (!contact) errors.push('no contact line found under the name heading');
if (parsed.some(s => s.canon === 'experience') && !hasContent(sec['experience'] ?? [])) {
  errors.push('experience section is present but empty');
}

function contactPart(p: string): string {
  const t = p.trim();
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(t)) return `\\href{mailto:${t}}{\\underline{${escapeTex(t)}}}`;
  if (/^(https?:\/\/)?(www\.)?(github\.com|linkedin\.com)\//i.test(t)) {
    return `\\href{${t.startsWith('http') ? t : 'https://' + t}}{\\underline{${escapeTex(t)}}}`;
  }
  return escapeTex(t);
}

function header(): string {
  const parts = contact.split('|').map(contactPart).join(' $|$ ');
  return `\\begin{center}\n    {\\Huge \\textbf{${escapeTex(name)}}} \\\\[2pt]\n    \\small ${parts}\n\\end{center}`;
}

function skills(ls: string[]): string {
  const rows = ls.filter(l => l.trim()).map(l => inlineTex(l.trim())).join(' \\\\\n  ');
  return `\\section{Technical Skills}\n\\begin{itemize}[leftmargin=0.15in, label={}]\n  \\small{\\item{\n  ${rows}\n  }}\n\\end{itemize}`;
}

// "**Title** Company | *- City, ST* | Date"  ->  resumeSubheading
function expEntry(headerLine: string, items: string[]): string {
  const hm = headerLine.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  const title = hm ? hm[1].trim() : headerLine.trim();
  const rest = hm ? hm[2].trim() : '';
  const segs = rest.split('|').map(s => s.trim()).filter(Boolean);
  let company = segs[0] ?? '';
  let loc = '', date = '';
  for (const s of segs.slice(1)) {
    const im = s.match(/^\*-?\s*(.+?)\*$/);
    if (im) loc = im[1].trim(); else date = s;
  }
  const subtitle = [company ? `\\textbf{${escapeTex(company)}}` : '', loc ? escapeTex(loc) : ''].filter(Boolean).join(', ');
  const its = items.map(b => `      \\resumeItem{${inlineTex(b.replace(/^[-*]\s*/, ''))}}`).join('\n');
  return `  \\resumeSubheading\n    {${escapeTex(title)}}{${escapeTex(date)}}\n    {${subtitle}}{}\n    \\resumeItemListStart\n${its}\n    \\resumeItemListEnd`;
}

// "**Project** | *stack*"  ->  resumeProjectHeading
function projEntry(headerLine: string, items: string[]): string {
  const hm = headerLine.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  const pname = hm ? hm[1].trim() : headerLine.trim();
  let rest = hm ? hm[2].trim() : '';
  let date = '';
  // a trailing "| Date" that is not italic is a date; the "*...*" piece is the stack
  let stack = '';
  for (const s of rest.split('|').map(x => x.trim()).filter(Boolean)) {
    const im = s.match(/^\*(.+?)\*$/);
    if (im) stack = im[1].trim(); else date = s;
  }
  const head = `\\textbf{${escapeTex(pname)}}` + (stack ? ` \\emph{| ${escapeTex(stack)}}` : '');
  const its = items.map(b => `      \\resumeItem{${inlineTex(b.replace(/^[-*]\s*/, ''))}}`).join('\n');
  return `  \\resumeProjectHeading\n    {${head}}{${escapeTex(date)}}\n    \\resumeItemListStart\n${its}\n    \\resumeItemListEnd`;
}

// "**School** - Degree | Date"  ->  resumeSubheading
function eduEntry(line: string): string {
  const hm = line.match(/^\*\*(.+?)\*\*\s*-?\s*(.*)$/);
  const school = hm ? hm[1].trim() : line.trim();
  const rest = hm ? hm[2].trim() : '';
  const [degree, date] = rest.split('|').map(s => s.trim());
  return `  \\resumeSubheading\n    {${escapeTex(school)}}{}\n    {${escapeTex(degree ?? '')}}{${escapeTex(date ?? '')}}`;
}

// group "header line then its - bullets"
function entries(ls: string[]): { head: string; items: string[] }[] {
  const out: { head: string; items: string[] }[] = [];
  for (const raw of ls) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[-*]\s+/.test(l)) { if (out.length) out[out.length - 1].items.push(l); }
    else out.push({ head: l, items: [] });
  }
  return out;
}

function summaryBlock(ls: string[]): string {
  const text = ls.filter(l => l.trim()).map(l => inlineTex(l.trim())).join(' ');
  return `\\section{Summary}\n\\small{${text}}`;
}

if (errors.length) {
  for (const e of errors) console.error(`render-jaketex: ${e}`);
  console.error(`render-jaketex: refusing to write ${outTex} — the PDF would be incomplete`);
  process.exit(1);
}

const body: string[] = [header()];
const summaryLines = sec['summary'] ?? [];
if (hasContent(summaryLines)) body.push(summaryBlock(summaryLines));
const skillLines = sec['skills'] ?? [];
if (hasContent(skillLines)) body.push(skills(skillLines));
const expLines = sec['experience'] ?? [];
if (hasContent(expLines)) {
  body.push('\\section{Experience}\n\\resumeSubHeadingListStart\n' +
    entries(expLines).map(e => expEntry(e.head, e.items)).join('\n\n') +
    '\n\\resumeSubHeadingListEnd');
}
const projLines = sec['projects'] ?? [];
if (hasContent(projLines)) {
  body.push('\\section{Projects}\n\\resumeSubHeadingListStart\n' +
    entries(projLines).map(e => projEntry(e.head, e.items)).join('\n\n') +
    '\n\\resumeSubHeadingListEnd');
}
const eduLines = sec['education'] ?? [];
if (hasContent(eduLines)) {
  body.push('\\section{Education}\n\\resumeSubHeadingListStart\n' +
    entries(eduLines).map(e => eduEntry(e.head)).join('\n') +
    '\n\\resumeSubHeadingListEnd');
}

const tex = `${PREAMBLE}\n\\begin{document}\n\n${body.join('\n\n')}\n\n\\end{document}\n`;
writeFileSync(outTex, tex);
console.log(`wrote ${outTex} (${Buffer.byteLength(tex)} bytes)`);
