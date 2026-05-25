import { describe, expect, it } from 'vitest';
import type { ToolError } from '../../mcp/src/tools.js';
import { createTools } from '../../mcp/src/tools.js';
import { fail, getTool, makeDeps, ok, parseResponseBody } from './_fixtures.js';

describe('createTools — surface', () => {
  it('exposes all local Claude/Cursor workflow tools', () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const names = tools.map((t) => t.definition.name).sort();
    expect(names).toEqual(
      [
        'apply_config_answers',
        'find_matching_jobs',
        'get_job',
        'get_latest_digest',
        'get_resume_outline',
        'init_config',
        'apply_scoped_resume_edits',
        'list_application_versions',
        'list_recent_applications',
        'read_resume',
        'read_rules',
        'register_resume',
        'rerank_top_jobs',
        'score_keyword_match',
        'set_active_resume',
        'start_application',
        'validate_sources',
        'write_application_output',
      ].sort(),
    );
  });

  it('every tool has a JSON-schema input description', () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    for (const t of tools) {
      expect(t.definition.inputSchema.type).toBe('object');
      expect(typeof t.definition.description).toBe('string');
      expect(t.definition.description.length).toBeGreaterThan(0);
    }
  });
});

describe('init_config', () => {
  it('passes through to deps.initConfig with empty args', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'init_config');
    const res = await tool.invoke({});
    expect(res.isError).toBeUndefined();
    expect(calls.initConfig).toEqual([{}]);
  });

  it('forwards interactive=true', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'init_config');
    await tool.invoke({ interactive: true });
    expect(calls.initConfig).toEqual([{ interactive: true }]);
  });

  it('drops a non-boolean interactive field', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'init_config');
    await tool.invoke({ interactive: 'yes' });
    expect(calls.initConfig).toEqual([{}]);
  });
});

describe('register_resume', () => {
  it('requires either path or content', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'register_resume');
    const res = await tool.invoke({ name: 'backend' });
    expect(res.isError).toBe(true);
    expect(calls.registerResume).toEqual([]);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
  });

  it('forwards name + content', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'register_resume');
    const res = await tool.invoke({ name: 'backend', content: '# resume' });
    expect(res.isError).toBeUndefined();
    expect(calls.registerResume).toEqual([{ name: 'backend', content: '# resume' }]);
  });

  it('rejects empty name', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'register_resume');
    const res = await tool.invoke({ name: '', path: '/x.md' });
    expect(res.isError).toBe(true);
  });
});

describe('set_active_resume', () => {
  it('accepts no args (list mode)', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'set_active_resume');
    await tool.invoke({});
    expect(calls.setActiveResume).toEqual([{}]);
  });

  it('forwards name', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'set_active_resume');
    await tool.invoke({ name: 'ml' });
    expect(calls.setActiveResume).toEqual([{ name: 'ml' }]);
  });
});

describe('find_matching_jobs', () => {
  it('requires queries', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'find_matching_jobs');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
  });

  it('forwards all optional fields', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'find_matching_jobs');
    await tool.invoke({
      queries: ['swe', 'backend'],
      resumeName: 'backend',
      useAllResumes: false,
      instructions: 'emphasize Go',
      count: 5,
    });
    expect(calls.findMatchingJobs).toEqual([
      {
        queries: ['swe', 'backend'],
        resumeName: 'backend',
        useAllResumes: false,
        instructions: 'emphasize Go',
        count: 5,
      },
    ]);
  });

  it('rejects non-array queries', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'find_matching_jobs');
    const res = await tool.invoke({ queries: 'swe' });
    expect(res.isError).toBe(true);
  });
});

describe('get_latest_digest', () => {
  it('passes through with no args', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'get_latest_digest');
    const res = await tool.invoke({});
    expect(res.isError).toBeUndefined();
    expect(calls.getLatestDigest).toHaveLength(1);
  });
});

describe('get_job', () => {
  it('rejects missing id', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'get_job');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
  });

  it('forwards id as JobId', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'get_job');
    await tool.invoke({ id: 'adzuna:abc' });
    expect(calls.getJob).toEqual(['adzuna:abc']);
  });
});

describe('read_rules', () => {
  it('defaults mode to merged', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'read_rules');
    await tool.invoke({});
    expect(calls.readRules).toEqual(['merged']);
  });

  it('forwards mode when valid', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'read_rules');
    await tool.invoke({ mode: 'defaults' });
    expect(calls.readRules).toEqual(['defaults']);
  });

  it('rejects unknown mode', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'read_rules');
    const res = await tool.invoke({ mode: 'bogus' });
    expect(res.isError).toBe(true);
  });
});

describe('score_keyword_match', () => {
  it('requires resumeMarkdown and jobId', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'score_keyword_match');
    const r1 = await tool.invoke({ jobId: 'a:1' });
    const r2 = await tool.invoke({ resumeMarkdown: 'x' });
    expect(r1.isError).toBe(true);
    expect(r2.isError).toBe(true);
  });

  it('forwards both fields', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'score_keyword_match');
    await tool.invoke({ resumeMarkdown: '# r', jobId: 'a:1' });
    expect(calls.scoreKeywordMatch).toEqual([{ resumeMarkdown: '# r', jobId: 'a:1' }]);
  });
});

describe('get_resume_outline', () => {
  it('uses the active resume and returns selectable sections and bullets', async () => {
    const resumeMarkdown = '# R\n\n## Experience\n- Built APIs.\n';
    const { deps, calls } = makeDeps({
      readResume: async () => {
        calls.readResume.push({});
        return ok({ name: 'backend', content: resumeMarkdown });
      },
    });
    const tool = getTool(createTools(deps), 'get_resume_outline');
    const res = await tool.invoke({});
    expect(res.isError).toBeUndefined();
    expect(calls.readResume).toEqual([{}]);
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: { resumeName: string; sections: Array<{ id: string; bullets: Array<{ id: string }> }> };
    };
    expect(body.value.resumeName).toBe('backend');
    expect(body.value.sections[0]?.id).toBe('section-1-experience');
    expect(body.value.sections[0]?.bullets[0]?.id).toBe('section-1-experience-bullet-1');
  });
});

describe('apply_scoped_resume_edits', () => {
  it('applies selected bullet replacements without calling deps', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n- Wrote tests.\n',
      replacements: [
        {
          selectionId: 'section-1-experience-bullet-2',
          replacementMarkdown: '- Wrote Vitest coverage.',
        },
      ],
    });
    expect(res.isError).toBeUndefined();
    expect(calls.writeApplicationOutput).toEqual([]);
    const body = parseResponseBody(res.content) as {
      ok: true;
      value: { content: string; changedSelections: Array<{ id: string; type: string }> };
    };
    expect(body.value.content).toBe('# R\n\n## Experience\n- Built APIs.\n- Wrote Vitest coverage.\n');
    expect(body.value.changedSelections).toEqual([
      { id: 'section-1-experience-bullet-2', type: 'bullet', startLine: 4, endLine: 4 },
    ]);
  });

  it('rejects missing replacements', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({ resumeMarkdown: '# R' });
    expect(res.isError).toBe(true);
  });

  it('rejects duplicate replacement ids', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n',
      replacements: [
        { selectionId: 'section-1-experience-bullet-1', replacementMarkdown: '- Built APIs.' },
        { selectionId: 'section-1-experience-bullet-1', replacementMarkdown: '- Built services.' },
      ],
    });
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
    expect(body.error.message).toContain('duplicate selectionId');
  });

  it('rejects overlapping section and bullet replacements', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'apply_scoped_resume_edits');
    const res = await tool.invoke({
      resumeMarkdown: '# R\n\n## Experience\n- Built APIs.\n',
      replacements: [
        { selectionId: 'section-1-experience', replacementMarkdown: '## Experience\n- Built APIs.' },
        { selectionId: 'section-1-experience-bullet-1', replacementMarkdown: '- Built services.' },
      ],
    });
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
    expect(body.error.message).toContain('overlapping selections');
  });
});

describe('start_application', () => {
  it('requires jobId', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'start_application');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
  });

  it('forwards jobId and basedOnResumeName', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'start_application');
    await tool.invoke({ jobId: 'a:1', basedOnResumeName: 'backend' });
    expect(calls.startApplication).toEqual([{ jobId: 'a:1', basedOnResumeName: 'backend' }]);
  });
});

describe('write_application_output', () => {
  it('validates kind enum', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'write_application_output');
    const res = await tool.invoke({ jobId: 'a:1', kind: 'bogus', content: 'x' });
    expect(res.isError).toBe(true);
  });

  it('forwards all required fields', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'write_application_output');
    await tool.invoke({ jobId: 'a:1', kind: 'resume', content: '# r' });
    expect(calls.writeApplicationOutput).toEqual([
      { jobId: 'a:1', kind: 'resume', content: '# r' },
    ]);
  });

  it('rejects missing content', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'write_application_output');
    const res = await tool.invoke({ jobId: 'a:1', kind: 'notes' });
    expect(res.isError).toBe(true);
  });
});

describe('list_application_versions', () => {
  it('requires jobId and kind', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'list_application_versions');
    const r1 = await tool.invoke({ kind: 'resume' });
    const r2 = await tool.invoke({ jobId: 'a:1' });
    expect(r1.isError).toBe(true);
    expect(r2.isError).toBe(true);
  });

  it('forwards both', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'list_application_versions');
    await tool.invoke({ jobId: 'a:1', kind: 'cover-letter' });
    expect(calls.listApplicationVersions).toEqual([{ jobId: 'a:1', kind: 'cover-letter' }]);
  });
});

describe('list_recent_applications', () => {
  it('passes through with no args', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'list_recent_applications');
    const res = await tool.invoke({});
    expect(res.isError).toBeUndefined();
    expect(calls.listRecentApplications).toHaveLength(1);
  });
});

describe('error wrapping', () => {
  it('wraps a CoreDeps failure as isError=true', async () => {
    const { deps } = makeDeps({
      getLatestDigest: async () =>
        fail({ type: 'not_configured', message: 'config missing' }),
    });
    const tool = getTool(createTools(deps), 'get_latest_digest');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { ok: false; error: ToolError };
    expect(body.ok).toBe(false);
    expect(body.error.type).toBe('not_configured');
  });

  it('catches thrown CoreDeps errors and converts to internal', async () => {
    const { deps } = makeDeps({
      readResume: async () => {
        throw new Error('boom');
      },
    });
    const tool = getTool(createTools(deps), 'read_resume');
    const res = await tool.invoke({});
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { ok: false; error: ToolError };
    expect(body.error.type).toBe('internal');
    expect(body.error.message).toBe('boom');
  });

  it('rejects non-object arguments', async () => {
    const { deps } = makeDeps();
    const tool = getTool(createTools(deps), 'init_config');
    const res = await tool.invoke('not an object');
    expect(res.isError).toBe(true);
    const body = parseResponseBody(res.content) as { error: ToolError };
    expect(body.error.type).toBe('invalid_input');
  });

  it('accepts undefined args (treated as empty object)', async () => {
    const { deps, calls } = makeDeps();
    const tool = getTool(createTools(deps), 'list_recent_applications');
    const res = await tool.invoke(undefined);
    expect(res.isError).toBeUndefined();
    expect(calls.listRecentApplications).toHaveLength(1);
  });
});
