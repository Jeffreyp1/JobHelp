import { describe, it, expect } from 'vitest';
import { makeAts } from '../src/ats/make-ats.ts';
import { fileInputKey } from '../src/ats/form-dom.ts';
import { decideGate } from '../src/apply.ts';
import { fakePage, fileInput, testCfg } from './fixtures/fake-form.ts';

describe('makeAts fill — direct file-input enumeration', () => {
  it('uploads the resume into a hidden keyless file input that detect never returns', async () => {
    const resume = fileInput();
    const page = fakePage({ files: [resume] });
    const ats = makeAts(testCfg([]));
    const outcome = await ats.fill(page, {}, '/tmp/resume.pdf');
    expect(resume.uploads).toEqual(['/tmp/resume.pdf']);
    expect(outcome.resumeUploaded).toBe(true);
  });

  it('routes the cover letter to the cover input and the resume to the other input', async () => {
    const cover = fileInput({ name: 'cover_letter' });
    const resume = fileInput({ name: 'resume_upload' });
    const page = fakePage({ files: [cover, resume] });
    const ats = makeAts(testCfg([]));
    const outcome = await ats.fill(page, { coverLetterPath: '/tmp/cl.pdf' }, '/tmp/resume.pdf');
    expect(cover.uploads).toEqual(['/tmp/cl.pdf']);
    expect(resume.uploads).toEqual(['/tmp/resume.pdf']);
    expect(outcome.resumeUploaded).toBe(true);
  });
});

describe('makeAts validate — fill-time verified upload is authoritative', () => {
  it('reports no file blocker after the SPA clears input.files on its post-upload re-render', async () => {
    const resume = fileInput();
    const page = fakePage({ files: [resume] });
    const ats = makeAts(testCfg([]));
    const outcome = await ats.fill(page, {}, '/tmp/resume.pdf');
    resume.files = [];
    const validation = await ats.validate(page);
    expect(validation.blockers).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(decideGate({ autoSubmit: true, uploaded: outcome.resumeUploaded, validation, repaired: false })).toBe('submit');
  });

  it('still reports the file blocker when no verified upload happened on this page', async () => {
    const resume = fileInput();
    const page = fakePage({ files: [resume] });
    const ats = makeAts(testCfg([]));
    const validation = await ats.validate(page);
    expect(validation.blockers).toEqual(['file']);
    expect(validation.ok).toBe(false);
  });
});

describe('file-input keys — upload verification and validate derive the same key', () => {
  it('keys an id="" file input by its name on both sides, so a verified upload cannot false-block', async () => {
    const resume = fileInput({ id: '', name: 'resume_upload' });
    const page = fakePage({ files: [resume] });
    const ats = makeAts(testCfg([]));
    const outcome = await ats.fill(page, {}, '/tmp/resume.pdf');
    expect(outcome.resumeUploaded).toBe(true);
    resume.files = [];
    const validation = await ats.validate(page);
    expect(validation.blockers).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('fileInputKey prefers id, then name, then the shared fallback', () => {
    expect(fileInputKey('resume', 'upload')).toBe('resume');
    expect(fileInputKey('', 'upload')).toBe('upload');
    expect(fileInputKey('', '')).toBe('file');
  });
});
