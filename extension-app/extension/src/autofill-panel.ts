/**
 * Builds the on-page JobHelp autofill panel: scalar standing-answer fields, a
 * dynamic Schools list, the resume-dump box, and the Save / Autofill actions.
 * DOM-only browser shell (verified manually); the logic it calls lives in
 * lib/greenhouse/*. Kept separate from autofill-content.ts to stay within the
 * file-size budget.
 */
import { set } from './lib/storage.js';
import {
  runAutofill,
  reviewSummary,
  type ApplicationProfile,
  type ProfileScalars,
  type ReviewItem,
} from './lib/greenhouse/autofill.js';
import { resolveScalars, type SchoolEntry } from './lib/greenhouse/profile.js';
import { fillCombobox } from './lib/greenhouse/combobox.js';

type ScalarKey = keyof ProfileScalars;

const PROFILE_FIELDS: ReadonlyArray<{ key: ScalarKey; label: string }> = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Street address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / Province' },
  { key: 'zip', label: 'ZIP / Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'currentCompany', label: 'Current company' },
  { key: 'currentTitle', label: 'Current title' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'github', label: 'GitHub URL' },
  { key: 'portfolio', label: 'Portfolio URL' },
  { key: 'website', label: 'Website' },
];

const SCHOOL_FIELDS: ReadonlyArray<{ key: keyof SchoolEntry; ph: string }> = [
  { key: 'school', ph: 'School' },
  { key: 'degree', ph: 'Degree' },
  { key: 'field', ph: 'Field' },
  { key: 'endYear', ph: 'Year' },
];

const REASON_TEXT: Record<ReviewItem['reason'], string> = {
  file: 'attach manually',
  combobox: 'pick from the dropdown',
  unknown: 'needs your answer',
  'no-value': 'not in your profile',
};

const PANEL_ID = 'jobhelp-autofill-panel';

function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el.style, css);
  if (text !== undefined) el.textContent = text;
  return el;
}

function debounced(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

const SAVE_TAG = '[JobHelp autofill]';

/** Persist a storage value, logging success/failure loudly (storage.set
 * otherwise no-ops silently when chrome.storage is unavailable). */
function persist<T>(key: 'autofillProfile' | 'autofillResumeDump', value: T): void {
  void (async (): Promise<void> => {
    try {
      await set(key, value as never);
      console.log(SAVE_TAG, 'saved', key);
    } catch (err) {
      console.error(SAVE_TAG, 'SAVE FAILED for', key, err);
    }
  })();
}

function renderReview(container: HTMLElement, applied: number, review: ReviewItem[]): void {
  container.replaceChildren();
  container.appendChild(
    styled('div', { fontWeight: '600', margin: '8px 0 4px' }, reviewSummary(applied, review)),
  );
  for (const item of review) {
    const label = item.label || item.id;
    container.appendChild(
      styled('div', { fontSize: '12px', color: '#444', padding: '2px 0' },
        `• ${label} — ${REASON_TEXT[item.reason]}`),
    );
  }
}

function fieldLabel(labelText: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = styled('label', { display: 'block', marginBottom: '6px' });
  wrap.appendChild(styled('span', { display: 'block', fontSize: '11px', color: '#666' }, labelText));
  const input = styled('input', {
    width: '100%', boxSizing: 'border-box', padding: '4px 6px',
    border: '1px solid #ddd', borderRadius: '4px',
  });
  input.type = 'text';
  wrap.appendChild(input);
  return { wrap, input };
}

function buildSchoolsSection(draft: ApplicationProfile, autosave: () => void): HTMLElement {
  const section = styled('div', { margin: '8px 0' });
  section.appendChild(
    styled('div', { fontSize: '11px', color: '#666', marginBottom: '4px' }, 'Schools'),
  );
  const rows = styled('div', {});
  section.appendChild(rows);

  const schools: SchoolEntry[] = draft.schools ? draft.schools.map((s) => ({ ...s })) : [];
  draft.schools = schools;

  function renderRow(entry: SchoolEntry, index: number): HTMLElement {
    const row = styled('div', { display: 'flex', gap: '4px', marginBottom: '4px' });
    for (const { key, ph } of SCHOOL_FIELDS) {
      const inp = styled('input', {
        flex: key === 'school' ? '2' : '1', minWidth: '0', boxSizing: 'border-box',
        padding: '3px 5px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px',
      });
      inp.type = 'text';
      inp.placeholder = ph;
      inp.value = entry[key] ?? '';
      inp.addEventListener('input', () => {
        entry[key] = inp.value;
        autosave();
      });
      row.appendChild(inp);
    }
    const del = styled('button', {
      flex: '0 0 auto', padding: '0 6px', border: '1px solid #ccc', borderRadius: '4px',
      cursor: 'pointer', background: '#f6f6f6',
    }, '×');
    del.type = 'button';
    del.addEventListener('click', () => {
      schools.splice(index, 1);
      autosave();
      redraw();
    });
    row.appendChild(del);
    return row;
  }

  function redraw(): void {
    rows.replaceChildren();
    schools.forEach((entry, i) => rows.appendChild(renderRow(entry, i)));
  }

  const addBtn = styled('button', {
    padding: '4px 8px', border: '1px solid #888', borderRadius: '4px', cursor: 'pointer',
    background: '#f6f6f6', fontSize: '12px',
  }, '+ Add school');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    schools.push({ school: '' });
    autosave();
    redraw();
  });
  section.appendChild(addBtn);

  redraw();
  return section;
}

async function driveComboFills(comboFills: ReadonlyArray<{ id: string; value: string }>): Promise<number> {
  let picked = 0;
  for (const c of comboFills) {
    const el = document.getElementById(c.id);
    if (!(el instanceof HTMLInputElement)) continue;
    try {
      if (await fillCombobox(el, c.value, document)) picked += 1;
    } catch {
      // A single combobox failing to auto-select is non-fatal; it stays for the
      // user to pick manually.
    }
  }
  return picked;
}

export function buildPanel(profile: ApplicationProfile, resumeDump: string): HTMLElement {
  const draft: ApplicationProfile = { ...profile };
  const autosave = debounced(() => persist('autofillProfile', { ...draft }), 400);

  const panel = styled('div', {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647',
    width: '320px', maxHeight: '80vh', overflowY: 'auto', padding: '12px',
    background: '#fff', border: '1px solid #ccc', borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)', font: '13px system-ui, sans-serif', color: '#111',
  });
  panel.id = PANEL_ID;
  panel.appendChild(styled('div', { fontWeight: '700', marginBottom: '8px' }, 'JobHelp autofill'));

  for (const { key, label } of PROFILE_FIELDS) {
    const { wrap, input } = fieldLabel(label);
    input.value = draft[key] ?? '';
    input.addEventListener('input', () => {
      draft[key] = input.value;
      autosave();
    });
    panel.appendChild(wrap);
  }

  panel.appendChild(buildSchoolsSection(draft, autosave));

  const dumpWrap = styled('label', { display: 'block', margin: '8px 0' });
  dumpWrap.appendChild(
    styled('span', { display: 'block', fontSize: '11px', color: '#666' },
      'Resume dump (grounds AI answers)'),
  );
  const dumpArea = styled('textarea', {
    width: '100%', boxSizing: 'border-box', minHeight: '56px', resize: 'vertical',
    padding: '4px 6px', border: '1px solid #ddd', borderRadius: '4px',
  });
  dumpArea.value = resumeDump;
  dumpArea.addEventListener('input', debounced(() => persist('autofillResumeDump', dumpArea.value), 400));
  dumpWrap.appendChild(dumpArea);
  panel.appendChild(dumpWrap);

  const btnRow = styled('div', { display: 'flex', gap: '8px', margin: '10px 0' });
  const btnCss: Partial<CSSStyleDeclaration> = {
    flex: '1', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #888',
  };
  const saveBtn = styled('button', btnCss, 'Save profile');
  saveBtn.type = 'button';
  const fillBtn = styled('button',
    { ...btnCss, background: '#2557d6', color: '#fff', borderColor: '#2557d6' },
    'Autofill this page');
  fillBtn.type = 'button';
  btnRow.append(saveBtn, fillBtn);
  panel.appendChild(btnRow);

  const reviewEl = styled('div', {});
  panel.appendChild(reviewEl);

  saveBtn.addEventListener('click', () => {
    persist('autofillProfile', { ...draft });
    saveBtn.textContent = 'Saved';
    window.setTimeout(() => { saveBtn.textContent = 'Save profile'; }, 1200);
  });

  fillBtn.addEventListener('click', () => {
    persist('autofillProfile', { ...draft });
    const scalars = resolveScalars({ ...draft });
    const run = runAutofill(document, scalars);
    renderReview(reviewEl, run.applied, run.review);
    void driveComboFills(run.comboFills);
  });

  return panel;
}

export { PANEL_ID };
