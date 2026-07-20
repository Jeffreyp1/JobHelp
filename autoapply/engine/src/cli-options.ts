import { parseArgs } from 'node:util';

export const HELP = `
jobhelp-autoapply — fill job application forms from the queue

USAGE
  node src/cli.ts [options]

OPTIONS
  --batch <n>              Max jobs to process (default: 8)
  --concurrency <n>        Parallel tabs (default: 3)
  --auto-submit            Auto-submit when form is fully deterministic
  --dry-run                Fill but never submit
  --prefill                Deterministic pass only; write leftovers.json, leave tabs open
  --watch-leftovers <s>    With --prefill: keep watching for up to <s> seconds and,
                           as each job dir gains freeform-answers.json, apply it to
                           that job's open tab and park it (exits early once every
                           prefilled job is handled)
  --job <jobId>            Process only this job from the queue
  --headless               Run browser headless (default: headful)
  --freeform-timeout <s>   Seconds to wait for freeform-answers.json (default: 0)
  --cdp <endpoint>         Attach to existing browser via CDP instead of launching
                           (e.g. http://localhost:9222); tabs survive CLI exit
  --url <url>              Ad-hoc job URL (bypasses queue; requires --dir)
  --dir <path>             Job directory for ad-hoc job
  --company <name>         Company name for ad-hoc job (default: adhoc)
  --role <name>            Role name for ad-hoc job (default: adhoc)
  --resume-md <path>       Markdown resume for conversion (ad-hoc job)
  --resume <path>          Pre-built PDF/DOCX to upload directly (ad-hoc job, when no --resume-md)
  --ats <name>             Force ATS adapter by name (needed for localhost fixture URLs)
  --help                   Show this help

ENVIRONMENT
  JOBHELP_CDP_PORT         Default CDP port for --cdp / browser-daemon (default: 9222)
  JOBHELP_SLOWMO           Milliseconds of slow-mo between playwright actions
  JOBHELP_HOME             Override state directory (default: ~/jobhelp)
  JOBHELP_CONFIG_DIR       Override config directory (default: ~/.config/jobhelp)
`.trim();

export interface CliOptions {
  batch: number;
  concurrency: number;
  autoSubmit: boolean;
  dryRun: boolean;
  prefill: boolean;
  watchLeftoversMs: number;
  job?: string;
  headful: boolean;
  freeformWaitMs: number;
  cdp?: string;
  url?: string;
  dir?: string;
  company: string;
  role: string;
  resumeMd?: string;
  resume?: string;
  ats?: string;
  help: boolean;
}

export function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      batch: { type: 'string', default: '8' },
      concurrency: { type: 'string', default: '3' },
      'auto-submit': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      prefill: { type: 'boolean', default: false },
      'watch-leftovers': { type: 'string', default: '0' },
      job: { type: 'string' },
      headless: { type: 'boolean', default: false },
      'freeform-timeout': { type: 'string', default: '0' },
      cdp: { type: 'string' },
      url: { type: 'string' },
      dir: { type: 'string' },
      company: { type: 'string', default: 'adhoc' },
      role: { type: 'string', default: 'adhoc' },
      'resume-md': { type: 'string' },
      resume: { type: 'string' },
      ats: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const batch = Number.parseInt(String(values.batch), 10);
  const concurrency = Number.parseInt(String(values.concurrency), 10);
  return {
    batch: Number.isFinite(batch) && batch > 0 ? batch : 8,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
    autoSubmit: values['auto-submit'] === true,
    dryRun: values['dry-run'] === true,
    prefill: values['prefill'] === true,
    watchLeftoversMs: Math.max(0, Number.parseInt(String(values['watch-leftovers']), 10) || 0) * 1000,
    ...(values.job !== undefined ? { job: String(values.job) } : {}),
    headful: values.headless !== true,
    freeformWaitMs: Math.max(0, Number.parseInt(String(values['freeform-timeout']), 10) || 0) * 1000,
    ...(values.cdp !== undefined ? { cdp: String(values.cdp) } : {}),
    ...(values.url !== undefined ? { url: String(values.url) } : {}),
    ...(values.dir !== undefined ? { dir: String(values.dir) } : {}),
    company: String(values.company ?? 'adhoc'),
    role: String(values.role ?? 'adhoc'),
    ...(values['resume-md'] !== undefined ? { resumeMd: String(values['resume-md']) } : {}),
    ...(values.resume !== undefined ? { resume: String(values.resume) } : {}),
    ...(values.ats !== undefined ? { ats: String(values.ats) } : {}),
    help: values.help === true,
  };
}
