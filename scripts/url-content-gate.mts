import { readFileSync } from 'node:fs';
import { gateContent, deriveJobIdFromUrl } from './lib/url-gate.js';

interface Input {
  url: string;
  fetch: { status: number; body: string };
}

function fail(stage: string, errors: string[]): never {
  process.stdout.write(JSON.stringify({ ok: false, stage, errors }));
  process.exit(2);
}

let input: Input;
try {
  input = JSON.parse(readFileSync(0, 'utf8')) as Input;
} catch (e) {
  fail('parse', [(e as Error).message]);
}

const shapeErrors: string[] = [];
if (typeof input.url !== 'string' || input.url.length === 0) {
  shapeErrors.push('url must be a non-empty string');
}
if (typeof input.fetch !== 'object' || input.fetch === null) {
  shapeErrors.push('fetch must be an object');
} else {
  if (typeof input.fetch.status !== 'number') shapeErrors.push('fetch.status must be a number');
  if (typeof input.fetch.body !== 'string') shapeErrors.push('fetch.body must be a string');
}
if (shapeErrors.length > 0) fail('shape', shapeErrors);

const gate = gateContent(input.fetch);
const jobId = deriveJobIdFromUrl(input.url);
process.stdout.write(JSON.stringify({ ...gate, jobId, url: input.url }));
