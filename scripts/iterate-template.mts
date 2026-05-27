// Iteration pipeline: sample-data → .docx → .pdf → .png.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SAMPLE_MD = `# Lisan al-Gaib
name@gmail.com | portfolio.com | github.com/name

## Skills
**CAD:** Siemens NX, CATIA V5, SolidWorks
**Analysis:** Thermal Desktop, Abaqus, LS-DYNA, STAR-CCM+

## Experience

**Job Title** Company | *— City, ST* | June 2022 – Present
- **STAR:** Situation Task Action Result: article 1, article 2
- **STAR:** Situation Task Action Result
- **STAR:** Situation Task Action Result
- **STAR:** Situation Task Action Result

**Job Title** Company | *— City, ST* | Jan 2021 – May 2022
- **XYZ:** Accomplished X as measured by Y by doing Z: article 1, article 2
- **XYZ:** Accomplished X as measured by Y by doing Z
- **XYZ:** Accomplished X as measured by Y by doing Z
- **XYZ:** Accomplished X as measured by Y by doing Z

**Job Title** Company | *— City, ST* | Aug 2014 – Sept 2020
- **CAR:** Challenge Action Result: article 1, article 2
- **CAR:** Challenge Action Result
- **CAR:** Challenge Action Result

**Job Title** Company | *— City, ST* | June 2014 – July 2014
- **Start:** each bullet with a strong, past-tense action verb
- **Tip:** Having trouble coming up with content for your bullet points? Read these: link 1, link 2
- **Length:** Each bullet point should be 1-2 lines long and max 1 sentence long
- **Avoid:** Don't let bullets spill onto the next line with only 1-4 words on it

## Projects

**Paper Trading App** | *Go, Node.js, Redis, PostgreSQL, Kafka*
- **Optimized microservice throughput:** Achieved 6,600 → 16,884 TPS by implementing Redis caching and WebSocket broadcasting, reducing external API calls by 99%.
- **Built data reliability pipeline:** Engineered Redis Stream → Kafka → PostgreSQL integration to ensure zero data loss across 5+ million trades in 5 minutes.

**MapAI** | *Python, Flask, React, Anthropic Claude API, SQLite*
- **Implemented AI schema detection:** Built agent loop that auto-detects legacy column types, maps to SAP S/4HANA fields with confidence scoring, and generates migration-ready templates.
- **Developed ETL cleaning pipeline:** Normalized phone numbers, currencies, and country codes across thousands of records with tagged migration status, eliminating per-row API calls.

## Education

**School** – PhD in Physics | May 2010
**School** – MS in Physics | June 2006
**School** – BS in Physics | Apr 2004
`;

writeFileSync('/tmp/iter-sample.md', SAMPLE_MD);

const bundlePath = '/tmp/iter-filler.mjs';
execSync(
  `npx esbuild --bundle --format=esm --platform=node ` +
  `--outfile=${bundlePath} ${join(ROOT, 'extension-app/extension/src/lib/templateFiller.ts')}`,
  { stdio: 'pipe' },
);

interface ResumeData {
  name: string;
  contact: string;
  skills: unknown[];
  experiences: unknown[];
  projects: unknown[];
  education: unknown[];
}

interface FillerModule {
  fillResumeTemplate: (templateBuf: ArrayBuffer, data: ResumeData) => Promise<Blob>;
  parseResumeMarkdown: (md: string) => ResumeData;
}

const { fillResumeTemplate, parseResumeMarkdown } = await import(bundlePath) as FillerModule;

const data = parseResumeMarkdown(SAMPLE_MD);
console.log(JSON.stringify({
  name: data.name,
  contact: data.contact,
  skills: data.skills.length,
  experiences: data.experiences.length,
  projects: data.projects.length,
  education: data.education.length,
}));

const templatePath = join(ROOT, 'templates/engineering-resume-template.docx');
const templateBuf = readFileSync(templatePath);

const filledBlob = await fillResumeTemplate(templateBuf.buffer as ArrayBuffer, data);
const filledArr = new Uint8Array(await filledBlob.arrayBuffer());
writeFileSync('/tmp/iter-out.docx', filledArr);

execSync('soffice --headless --convert-to pdf --outdir /tmp /tmp/iter-out.docx', { stdio: 'pipe' });
execSync('pdftoppm -r 100 -singlefile /tmp/iter-out.pdf /tmp/iter-out -png', { stdio: 'pipe' });
console.log('OK: /tmp/iter-out.png');
