/**
 * Tests for the Job Pipeline sheet ops on driveOps:
 *   ensureJobPipelineSheet / upsertJobPipelineRows / updateJobPipelineStatus /
 *   readJobPipelineRows
 *
 * Uses a minimal in-memory SpreadsheetApp mock — only the surface the four
 * methods actually call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { driveOps } from '../../src/drive.js';
import type { JobPipelineRow } from '../../src/types/job-discovery.js';

const HEADER = [
  'Job ID', 'Discovered', 'Posted', 'Source', 'Company', 'Title', 'Location',
  'URL', 'Score', 'Matched Skills', 'Missing Skills', 'Status', 'Tailored Doc', 'Notes',
];

interface FakeSheet {
  name: string;
  rows: unknown[][]; // 0-based; row 0 = header (once written)
  frozenRows: number;
  gid: number;
}

function makeWorkbook(opts: { sheets?: Record<string, unknown[][]> } = {}) {
  const sheets: Record<string, FakeSheet> = {};
  let nextGid = 100;
  for (const [name, rows] of Object.entries(opts.sheets ?? {})) {
    sheets[name] = { name, rows: rows.map((r) => r.slice()), frozenRows: 0, gid: nextGid++ };
  }

  const ensureRow = (sh: FakeSheet, idx: number) => {
    while (sh.rows.length <= idx) sh.rows.push([]);
  };

  const makeRange = (sh: FakeSheet, r: number, c: number, nr = 1, nc = 1) => ({
    getValues: () => {
      const out: unknown[][] = [];
      for (let i = 0; i < nr; i++) {
        const srcRow = sh.rows[r - 1 + i] ?? [];
        const row: unknown[] = [];
        for (let j = 0; j < nc; j++) row.push(srcRow[c - 1 + j] ?? '');
        out.push(row);
      }
      return out;
    },
    setValues: (values: unknown[][]) => {
      for (let i = 0; i < values.length; i++) {
        const rowIdx = r - 1 + i;
        ensureRow(sh, rowIdx);
        const target = sh.rows[rowIdx];
        for (let j = 0; j < values[i].length; j++) {
          while (target.length < c + j) target.push('');
          target[c - 1 + j] = values[i][j];
        }
      }
    },
    getValue: () => {
      const srcRow = sh.rows[r - 1] ?? [];
      return srcRow[c - 1] ?? '';
    },
    setValue: (value: unknown) => {
      const rowIdx = r - 1;
      ensureRow(sh, rowIdx);
      const target = sh.rows[rowIdx];
      while (target.length < c) target.push('');
      target[c - 1] = value;
    },
    setFontWeight: vi.fn(),
  });

  const makeSheetObj = (sh: FakeSheet) => ({
    getName: () => sh.name,
    getLastRow: () => {
      // last row index with any content (1-based); 0 if empty
      let last = 0;
      for (let i = 0; i < sh.rows.length; i++) {
        if (sh.rows[i] && sh.rows[i].some((v) => v !== '' && v !== undefined && v !== null)) last = i + 1;
        else if (sh.rows[i] && sh.rows[i].length > 0) last = i + 1; // still counts a written-but-blank row
      }
      return last;
    },
    getLastColumn: () => sh.rows.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r: number, c: number, nr?: number, nc?: number) => makeRange(sh, r, c, nr, nc),
    getSheetId: () => sh.gid,
    setFrozenRows: (n: number) => { sh.frozenRows = n; },
  });

  const ss = {
    getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEET_XYZ/edit',
    getSheetByName: (name: string) => (sheets[name] ? makeSheetObj(sheets[name]) : null),
    getSheets: () => Object.values(sheets).map(makeSheetObj),
    insertSheet: (name: string) => {
      sheets[name] = { name, rows: [], frozenRows: 0, gid: nextGid++ };
      return makeSheetObj(sheets[name]);
    },
  };

  return {
    SpreadsheetApp: { openById: (_id: string) => ss },
    _sheets: sheets,
  };
}

function row(overrides: Partial<JobPipelineRow> = {}): JobPipelineRow {
  return {
    jobId: 'j1',
    discoveredAt: Date.parse('2026-05-01T00:00:00.000Z'),
    postedAt: Date.parse('2026-04-28T00:00:00.000Z'),
    source: 'greenhouse',
    company: 'Acme',
    title: 'Senior Engineer',
    location: 'Remote',
    url: 'https://example.com/jobs/1',
    finalScore: 0.8765432,
    matchedSkills: ['typescript', 'gas'],
    missingSkills: ['rust'],
    status: 'new',
    tailoredDocUrl: null,
    notes: '',
    ...overrides,
  };
}

const SHEET_ID = 'wb-1';

describe('driveOps Job Pipeline sheet ops', () => {
  let wb: ReturnType<typeof makeWorkbook>;

  const install = (w: ReturnType<typeof makeWorkbook>) => {
    wb = w;
    vi.stubGlobal('SpreadsheetApp', w.SpreadsheetApp);
  };

  beforeEach(() => {
    install(makeWorkbook());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ---- ensureJobPipelineSheet ----

  it('ensure creates the tab and header when absent', () => {
    expect(wb._sheets['Job Pipeline']).toBeUndefined();
    const { sheetUrl } = driveOps.ensureJobPipelineSheet!(SHEET_ID);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh).toBeDefined();
    expect(sh.rows[0]).toEqual(HEADER);
    expect(sh.frozenRows).toBe(1);
    expect(sheetUrl).toMatch(/#gid=\d+$/);
    expect(sheetUrl).toContain('SHEET_XYZ');
  });

  it('ensure on an existing well-formed sheet leaves data untouched', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [HEADER, ['j1', '', '', 'manual', 'Co', 'T', '', 'u', 0, '', '', 'applied', '', 'keep me'] ] } }));
    driveOps.ensureJobPipelineSheet!(SHEET_ID);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows.length).toBe(2);
    expect(sh.rows[1][11]).toBe('applied');
    expect(sh.rows[1][13]).toBe('keep me');
  });

  it('ensure rewrites a bad header without clobbering data rows', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [
      ['WRONG', 'HEADER', 'X', 'Y', 'Z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
      ['j7', '', '', 'lever', 'Beta', 'Eng', '', 'http://x', 0.5, 'a', 'b', 'tailored', 'doc-url', 'mynote'],
    ] } }));
    driveOps.ensureJobPipelineSheet!(SHEET_ID);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[0]).toEqual(HEADER);
    expect(sh.rows[1][0]).toBe('j7');
    expect(sh.rows[1][11]).toBe('tailored');
    expect(sh.rows[1][13]).toBe('mynote');
  });

  it('ensure rewrites a header-only-too-short sheet', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [['Job ID', 'Discovered']] } }));
    driveOps.ensureJobPipelineSheet!(SHEET_ID);
    expect(wb._sheets['Job Pipeline'].rows[0]).toEqual(HEADER);
  });

  // ---- upsertJobPipelineRows ----

  it('upsert appends new rows with status=new and notes empty', () => {
    const res = driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a' }), row({ jobId: 'b', status: 'applied' as const, notes: 'should be ignored on insert' })]);
    expect(res.inserted).toBe(2);
    expect(res.updated).toBe(0);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[0]).toEqual(HEADER);
    expect(sh.rows[1][0]).toBe('a');
    expect(sh.rows[1][11]).toBe('new'); // status forced to 'new' on insert
    expect(sh.rows[1][13]).toBe('');    // notes forced to '' on insert
    // even though row b carried status 'applied' / notes text, insert ignores them
    expect(sh.rows[2][0]).toBe('b');
    expect(sh.rows[2][11]).toBe('new');
    expect(sh.rows[2][13]).toBe('');
  });

  it('upsert rounds Score to 3dp and comma-joins skills', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a', finalScore: 0.123456 })]);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[1][8]).toBe(0.123);
    expect(sh.rows[1][9]).toBe('typescript, gas');
    expect(sh.rows[1][10]).toBe('rust');
  });

  it('upsert writes ISO dates and empty for null postedAt', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a', postedAt: null })]);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[1][1]).toBe(new Date(Date.parse('2026-05-01T00:00:00.000Z')).toISOString());
    expect(sh.rows[1][2]).toBe('');
  });

  it('upsert updates an existing row data cells but preserves Status and Notes', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a', company: 'Acme', title: 'Old Title' })]);
    // user edits status + notes
    const sh = wb._sheets['Job Pipeline'];
    sh.rows[1][11] = 'applied';
    sh.rows[1][13] = 'phone screen tue';
    // re-discover with new data
    const res = driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a', company: 'Acme Corp', title: 'New Title', finalScore: 0.5 })]);
    expect(res.inserted).toBe(0);
    expect(res.updated).toBe(1);
    expect(sh.rows.length).toBe(2); // no new row
    expect(sh.rows[1][4]).toBe('Acme Corp'); // company updated
    expect(sh.rows[1][5]).toBe('New Title'); // title updated
    expect(sh.rows[1][8]).toBe(0.5);         // score updated
    expect(sh.rows[1][11]).toBe('applied');  // status PRESERVED
    expect(sh.rows[1][13]).toBe('phone screen tue'); // notes PRESERVED
  });

  it('upsert returns correct inserted/updated counts for a mixed batch', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a' }), row({ jobId: 'b' })]);
    const res = driveOps.upsertJobPipelineRows!(SHEET_ID, [
      row({ jobId: 'b', title: 'Updated' }),
      row({ jobId: 'c' }),
      row({ jobId: 'd' }),
    ]);
    expect(res.inserted).toBe(2);
    expect(res.updated).toBe(1);
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows.map((r) => r[0])).toEqual(['Job ID', 'a', 'b', 'c', 'd']);
  });

  it('upsert ensures the sheet first when it does not exist', () => {
    expect(wb._sheets['Job Pipeline']).toBeUndefined();
    const res = driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'z' })]);
    expect(wb._sheets['Job Pipeline']).toBeDefined();
    expect(res.sheetUrl).toMatch(/#gid=\d+$/);
  });

  // ---- updateJobPipelineStatus ----

  it('updateStatus changes the right cell', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a' }), row({ jobId: 'b' })]);
    const res = driveOps.updateJobPipelineStatus!(SHEET_ID, 'b', 'tailored');
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[2][0]).toBe('b');
    expect(sh.rows[2][11]).toBe('tailored');
    expect(sh.rows[1][11]).toBe('new'); // row a untouched
    expect(typeof res.updatedAt).toBe('number');
  });

  it('updateStatus also sets Tailored Doc when given', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a' })]);
    driveOps.updateJobPipelineStatus!(SHEET_ID, 'a', 'tailored', 'https://docs.google.com/document/d/DOC1/edit');
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[1][11]).toBe('tailored');
    expect(sh.rows[1][12]).toBe('https://docs.google.com/document/d/DOC1/edit');
  });

  it('updateStatus does not touch Tailored Doc when omitted', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [HEADER, ['a', '', '', 'manual', 'C', 'T', '', 'u', 0, '', '', 'new', 'preexisting-doc', '']] } }));
    driveOps.updateJobPipelineStatus!(SHEET_ID, 'a', 'applied');
    const sh = wb._sheets['Job Pipeline'];
    expect(sh.rows[1][11]).toBe('applied');
    expect(sh.rows[1][12]).toBe('preexisting-doc');
  });

  it('updateStatus throws on unknown jobId', () => {
    driveOps.upsertJobPipelineRows!(SHEET_ID, [row({ jobId: 'a' })]);
    expect(() => driveOps.updateJobPipelineStatus!(SHEET_ID, 'nope', 'applied')).toThrow(/No Job Pipeline row with jobId nope/);
  });

  // ---- readJobPipelineRows ----

  it('readRows on a header-only sheet returns []', () => {
    driveOps.ensureJobPipelineSheet!(SHEET_ID);
    expect(driveOps.readJobPipelineRows!(SHEET_ID)).toEqual([]);
  });

  it('readRows on an absent sheet creates it and returns []', () => {
    expect(driveOps.readJobPipelineRows!(SHEET_ID)).toEqual([]);
    expect(wb._sheets['Job Pipeline']).toBeDefined();
  });

  it('readRows round-trips a set of upserted rows', () => {
    const a = row({ jobId: 'a', company: 'Acme', title: 'Eng', matchedSkills: ['ts', 'gas'], missingSkills: [], postedAt: null });
    const b = row({ jobId: 'b', company: 'Beta', title: 'Staff', location: null, finalScore: 0.42, missingSkills: ['rust', 'go'] });
    driveOps.upsertJobPipelineRows!(SHEET_ID, [a, b]);
    // simulate the user setting a status
    wb._sheets['Job Pipeline'].rows[2][11] = 'applied';
    const read = driveOps.readJobPipelineRows!(SHEET_ID);
    expect(read.length).toBe(2);
    expect(read[0].jobId).toBe('a');
    expect(read[0].company).toBe('Acme');
    expect(read[0].matchedSkills).toEqual(['ts', 'gas']);
    expect(read[0].missingSkills).toEqual([]);
    expect(read[0].postedAt).toBeNull();
    expect(read[0].status).toBe('new');
    expect(read[1].jobId).toBe('b');
    expect(read[1].location).toBeNull();
    expect(read[1].finalScore).toBeCloseTo(0.42, 6);
    expect(read[1].missingSkills).toEqual(['rust', 'go']);
    expect(read[1].status).toBe('applied');
  });

  it('readRows parses date columns and falls back to null for unparseable postedAt', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [HEADER,
      ['a', '2026-05-01T00:00:00.000Z', 'not a date', 'manual', 'C', 'T', '', 'u', 1, '', '', 'new', '', ''],
    ] } }));
    const read = driveOps.readJobPipelineRows!(SHEET_ID);
    expect(read.length).toBe(1);
    expect(read[0].discoveredAt).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
    expect(read[0].postedAt).toBeNull();
  });

  it('readRows skips a malformed (empty Job ID) row with a warn', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [HEADER,
      ['a', '2026-05-01T00:00:00.000Z', '', 'manual', 'C', 'T', '', 'u', 1, '', '', 'new', '', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], // malformed: no Job ID
      ['c', '2026-05-02T00:00:00.000Z', '', 'lever', 'D', 'T2', '', 'u2', 2, '', '', 'new', '', ''],
    ] } }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const read = driveOps.readJobPipelineRows!(SHEET_ID);
    expect(read.map((r) => r.jobId)).toEqual(['a', 'c']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('readRows trims and filters empty entries when splitting skill columns', () => {
    install(makeWorkbook({ sheets: { 'Job Pipeline': [HEADER,
      ['a', '2026-05-01T00:00:00.000Z', '', 'manual', 'C', 'T', 'NYC', 'u', 0.5, ' ts , gas , ', ' , ', 'new', '', 'hi'],
    ] } }));
    const read = driveOps.readJobPipelineRows!(SHEET_ID);
    expect(read[0].matchedSkills).toEqual(['ts', 'gas']);
    expect(read[0].missingSkills).toEqual([]);
    expect(read[0].location).toBe('NYC');
    expect(read[0].notes).toBe('hi');
  });
});
