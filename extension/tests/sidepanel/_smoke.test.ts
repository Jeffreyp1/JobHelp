/** @vitest-environment jsdom */
/**
 * Smoke test for the side-panel UI graph. Imports each component, renders it,
 * and checks the resulting DOM has the expected top-level classes. NOT part of
 * the 20 specified tests — but a quick guardrail against runtime errors when
 * any component file is edited. (The spec exempts UI from automated TDD; this
 * test only verifies the modules don't throw on import + render.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToggleRow } from '../../src/sidepanel/components/toggleRow';
import { renderCostEstimator } from '../../src/sidepanel/components/costEstimator';
import { renderResumeEditor } from '../../src/sidepanel/components/resumeEditor';
import { renderGenerateTab } from '../../src/sidepanel/tabs/generate';
import { renderFilesTab } from '../../src/sidepanel/tabs/files';
import { renderSettingsTab } from '../../src/sidepanel/tabs/settings';
import { installChromeMock } from '../helpers/chrome-mocks';

describe('side-panel UI smoke', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('toggle row renders', () => {
    const node = renderToggleRow({ label: 'Critique', enabled: false, disabled: true, comingIn: 'v2' });
    expect(node.classList.contains('toggle-row')).toBe(true);
    expect(node.querySelector('.toggle-row__badge')?.textContent).toContain('v2');
  });

  it('cost estimator renders zero values cleanly', () => {
    const node = renderCostEstimator({
      generate: 0.01,
      research: 0,
      critique: 0,
      autoRevise: 0,
      multiVersion: 0,
      coverLetter: 0,
      verifyHooks: 0,
      total: 0.01,
    });
    expect(node.classList.contains('cost-estimator')).toBe(true);
    expect(node.textContent).toContain('Total');
  });

  it('resume editor renders with markdown preview', () => {
    const node = renderResumeEditor({
      initialMarkdown: '# Hello\n- item one',
      onSave: () => {},
    });
    const preview = node.querySelector('.resume-editor__preview');
    expect(preview).not.toBeNull();
    expect(preview?.innerHTML).toContain('Hello');
  });

  it('generate tab renders', () => {
    const ctrl = renderGenerateTab({
      onGenerate: () => {},
      onSaveResume: () => {},
      onFinalize: async () => ({ ok: false, message: 'stub' }),
    });
    expect(ctrl.root.classList.contains('tab-pane--generate')).toBe(true);
    expect(ctrl.root.querySelector('.generate__toggles')).not.toBeNull();
    expect(ctrl.root.querySelector('.cost-estimator')).not.toBeNull();
  });

  it('files tab renders two sections', () => {
    const ctrl = renderFilesTab({ fetchFiles: async () => [] });
    expect(ctrl.root.querySelectorAll('.files-section').length).toBe(2);
  });

  it('settings tab renders form rows', () => {
    const node = renderSettingsTab({});
    expect(node.querySelectorAll('.settings-row').length).toBeGreaterThan(0);
    expect(node.querySelector('input[type="password"]')).not.toBeNull();
  });
});
