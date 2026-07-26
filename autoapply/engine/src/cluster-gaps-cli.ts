#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import os from 'node:os';
import { parseGapLines, clusterGaps, renderMarkdown } from './cluster-gaps.ts';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    json: { type: 'string' },
  },
  allowPositionals: true,
});

const defaultLog = `${process.env['JOBHELP_HOME'] ?? os.homedir() + '/jobhelp'}/autoapply-gaps.jsonl`;
const logPath = positionals[0] ?? defaultLog;

let raw: string;
try {
  raw = readFileSync(logPath, 'utf8');
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`error: cannot read gaps log at ${logPath}: ${msg}`);
  process.exit(1);
}

const entries = parseGapLines(raw);
const clusters = clusterGaps(entries);
const md = renderMarkdown(clusters);

process.stdout.write(md || '(no gaps logged)\n');

if (values.json !== undefined) {
  writeFileSync(values.json, JSON.stringify(clusters, null, 2) + '\n', 'utf8');
  console.error(`wrote ${clusters.length} clusters to ${values.json}`);
}
