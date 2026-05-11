/**
 * Toggle row component used in the Generate tab.
 *
 * One row = checkbox + label + (optional) model dropdown + (optional)
 * "coming vX" badge for features not yet implemented.
 *
 * Pure DOM. Calls back via onToggle / onModelChange.
 */

export interface ToggleRowProps {
  label: string;
  enabled: boolean;
  /** When true, checkbox + dropdown are non-interactive. */
  disabled?: boolean;
  /** Shown as "coming vX" badge when disabled. */
  comingIn?: 'v2' | 'v3' | 'v4' | 'v5';
  /** Optional model dropdown options (Anthropic model ids). */
  models?: string[];
  /** Currently selected model. Must be in `models` if provided. */
  selectedModel?: string;
  /**
   * Optional feature key — rendered as `data-feature="<key>"` on the row
   * element so feature modules can locate their toggle via querySelector.
   */
  featureKey?: string;
  /**
   * Optional secondary numeric selector (e.g. variant count for multi-version).
   * If provided, renders a small `<select class="count-select">` between the
   * model dropdown and the badge.
   */
  counts?: number[];
  selectedCount?: number;
  onCountChange?: (count: number) => void;
  /**
   * Optional tone selector (e.g. cover-letter voice presets).
   * If provided, renders a small `<select class="tone-select toggle-row__tone">`
   * AFTER the model dropdown.
   */
  tones?: string[];
  selectedTone?: string;
  onToneChange?: (tone: string) => void;
  onToggle?: (enabled: boolean) => void;
  onModelChange?: (model: string) => void;
}

const MODEL_DISPLAY: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-7': 'Opus 4.7',
};

function modelLabel(id: string): string {
  return MODEL_DISPLAY[id] ?? id;
}

export function renderToggleRow(props: ToggleRowProps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'toggle-row';
  if (props.disabled) row.classList.add('toggle-row--disabled');
  if (props.featureKey) row.setAttribute('data-feature', props.featureKey);

  // Checkbox + label as a clickable label-wrapped pair
  const labelEl = document.createElement('label');
  labelEl.className = 'toggle-row__label';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'toggle-row__checkbox';
  cb.checked = props.enabled;
  cb.disabled = !!props.disabled;
  cb.addEventListener('change', () => {
    props.onToggle?.(cb.checked);
  });

  const text = document.createElement('span');
  text.className = 'toggle-row__text';
  text.textContent = props.label;

  labelEl.appendChild(cb);
  labelEl.appendChild(text);
  row.appendChild(labelEl);

  // Count selector (only when counts provided) — used by multi-version
  if (props.counts && props.counts.length > 0) {
    const csel = document.createElement('select');
    csel.className = 'count-select toggle-row__count';
    csel.disabled = !!props.disabled;
    for (const n of props.counts) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      if (n === props.selectedCount) opt.selected = true;
      csel.appendChild(opt);
    }
    csel.addEventListener('change', () => {
      const parsed = parseInt(csel.value, 10);
      if (!isNaN(parsed)) props.onCountChange?.(parsed);
    });
    row.appendChild(csel);
  }

  // Model dropdown (only when models provided)
  if (props.models && props.models.length > 0) {
    const sel = document.createElement('select');
    sel.className = 'toggle-row__model model-select';
    sel.setAttribute('data-role', 'model');
    sel.disabled = !!props.disabled;
    for (const m of props.models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = modelLabel(m);
      if (m === props.selectedModel) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      props.onModelChange?.(sel.value);
    });
    row.appendChild(sel);
  }

  // Tone selector (only when tones provided) — rendered AFTER the model select.
  if (props.tones && props.tones.length > 0) {
    const tsel = document.createElement('select');
    tsel.className = 'tone-select toggle-row__tone';
    tsel.setAttribute('data-role', 'tone');
    tsel.disabled = !!props.disabled;
    for (const t of props.tones) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === props.selectedTone) opt.selected = true;
      tsel.appendChild(opt);
    }
    tsel.addEventListener('change', () => {
      props.onToneChange?.(tsel.value);
    });
    row.appendChild(tsel);
  }

  // Coming-soon badge
  if (props.comingIn && props.disabled) {
    const badge = document.createElement('span');
    badge.className = 'toggle-row__badge';
    badge.textContent = `coming ${props.comingIn}`;
    badge.title = `This feature is planned for ${props.comingIn}.`;
    row.appendChild(badge);
  }

  return row;
}
