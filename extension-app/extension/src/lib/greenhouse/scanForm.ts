/**
 * Reads a Greenhouse application form's DOM into a flat, serializable list of
 * fields. Pure: takes any DOM root, returns plain data, mutates nothing. The
 * new `job-boards.greenhouse.io` embed renders every control — including
 * dropdowns — as an `<input>` with a stable `id` and an associated
 * `<label for=id>`; dropdowns are combobox inputs (`autocomplete="list"`).
 */

export interface FormField {
  /** The element's `id` — Greenhouse's stable field key (e.g. `first_name`, `question_123`). */
  id: string;
  /** Human label text, entity-decoded, asterisks and extra whitespace stripped. */
  label: string;
  /** The control type (`text`, `tel`, `file`, …) or the tag name for select/textarea. */
  type: string;
  /** True only when the `required` attribute's value is the string `"true"`. */
  required: boolean;
  /** True when the input is a Greenhouse react-select combobox (`role="combobox"`). */
  combobox: boolean;
}

function normalizeLabel(text: string): string {
  return text.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
}

function labelText(root: ParentNode, id: string): string {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const label = root.querySelector(`label[for="${escaped}"]`);
  return label ? normalizeLabel(label.textContent ?? '') : '';
}

export function scanForm(root: Document | HTMLElement): FormField[] {
  const controls = Array.from(
    root.querySelectorAll('input[id], select[id], textarea[id]'),
  );
  const fields: FormField[] = [];
  for (const el of controls) {
    const id = el.getAttribute('id');
    if (!id) continue;
    const type = el.getAttribute('type') ?? el.tagName.toLowerCase();
    fields.push({
      id,
      label: labelText(root, id) || el.getAttribute('aria-label') || '',
      type,
      required:
        el.getAttribute('required') === 'true' ||
        el.getAttribute('aria-required') === 'true',
      combobox:
        el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-autocomplete') === 'list',
    });
  }
  return fields;
}
