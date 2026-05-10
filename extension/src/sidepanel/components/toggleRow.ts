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

  // Model dropdown (only when models provided)
  if (props.models && props.models.length > 0) {
    const sel = document.createElement('select');
    sel.className = 'toggle-row__model';
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
