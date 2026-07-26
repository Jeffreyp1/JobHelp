import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jaketexScriptPath } from '../src/convert-pdf.ts';

const script = jaketexScriptPath();
let dir: string;
let n = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jaketex-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function render(md: string): { status: number | null; stderr: string; tex: string } {
  n++;
  const mdPath = join(dir, `r${n}.md`);
  const texPath = join(dir, `r${n}.tex`);
  writeFileSync(mdPath, md);
  const res = spawnSync(process.execPath, [script, mdPath, texPath], { encoding: 'utf8' });
  return {
    status: res.status,
    stderr: res.stderr,
    tex: existsSync(texPath) ? readFileSync(texPath, 'utf8') : '',
  };
}

const HEADER = '# Jane Doe\n\njane@doe.dev | github.com/janedoe | Austin, TX\n\n';
const EXPERIENCE = '**Engineer** Acme | *- Austin, TX* | 2022 - 2024\n- Built the widget pipeline\n- Cut latency by half\n';

describe('render-jaketex section aliases', () => {
  it('renders "## Work Experience" as the Experience section', () => {
    const r = render(`${HEADER}## Work Experience\n${EXPERIENCE}`);
    expect(r.status).toBe(0);
    expect(r.tex).toContain('\\section{Experience}');
    expect(r.tex).toContain('Built the widget pipeline');
  });

  it('renders "## Technical Skills" and "## Professional Experience" aliases', () => {
    const md = `${HEADER}## Technical Skills\n**Languages:** TypeScript, Python\n\n## Professional Experience\n${EXPERIENCE}`;
    const r = render(md);
    expect(r.status).toBe(0);
    expect(r.tex).toContain('\\section{Technical Skills}');
    expect(r.tex).toContain('TypeScript, Python');
    expect(r.tex).toContain('\\section{Experience}');
  });

  it('renders "## Personal Projects" as the Projects section', () => {
    const md = `${HEADER}## Personal Projects\n**Widget** | *TypeScript*\n- Shipped it\n\n## Experience\n${EXPERIENCE}`;
    const r = render(md);
    expect(r.status).toBe(0);
    expect(r.tex).toContain('\\section{Projects}');
    expect(r.tex).toContain('Shipped it');
  });
});

describe('render-jaketex summary', () => {
  it('renders "## Summary" as a paragraph block', () => {
    const md = `${HEADER}## Summary\nBackend engineer with five years of platform work.\n\n## Experience\n${EXPERIENCE}`;
    const r = render(md);
    expect(r.status).toBe(0);
    expect(r.tex).toContain('\\section{Summary}');
    expect(r.tex).toContain('Backend engineer with five years of platform work.');
  });
});

describe('render-jaketex refuses to render a gutted resume', () => {
  it('exits nonzero when a non-empty section is unrecognized, naming the heading', () => {
    const md = `${HEADER}## Certifications\n- AWS Solutions Architect\n\n## Experience\n${EXPERIENCE}`;
    const r = render(md);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Certifications');
    expect(r.tex).toBe('');
  });

  it('exits nonzero when the contact line is missing', () => {
    const r = render(`# Jane Doe\n\n## Experience\n${EXPERIENCE}`);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('contact');
  });

  it('exits nonzero when the name heading is missing', () => {
    const r = render(`jane@doe.dev\n\n## Experience\n${EXPERIENCE}`);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('name');
  });

  it('exits nonzero when the experience section exists but is empty', () => {
    const r = render(`${HEADER}## Experience\n\n## Education\n**State U** - BS CS | 2020\n`);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('experience');
  });
});

describe('render-jaketex happy path', () => {
  it('renders all four canonical sections unchanged', () => {
    const md = `${HEADER}## Skills\n**Languages:** Go\n\n## Experience\n${EXPERIENCE}\n## Projects\n**Widget** | *Go*\n- Made it\n\n## Education\n**State U** - BS CS | 2020\n`;
    const r = render(md);
    expect(r.status).toBe(0);
    for (const s of ['Technical Skills', 'Experience', 'Projects', 'Education']) {
      expect(r.tex).toContain(`\\section{${s}}`);
    }
    expect(r.tex).toContain('Jane Doe');
  });

  it('ignores an unknown heading that has no content', () => {
    const md = `${HEADER}## Certifications\n\n## Experience\n${EXPERIENCE}`;
    const r = render(md);
    expect(r.status).toBe(0);
    expect(r.tex).toContain('\\section{Experience}');
  });
});
