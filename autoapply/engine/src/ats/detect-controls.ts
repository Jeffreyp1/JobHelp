import { formScope } from './form-dom.ts';
import type { AtsConfig, DetectedField, Surface } from './form-config.ts';

/** Control-first field detection for forms that don't reliably use `label[for]`
 * (Lever, Ashby, Workable, SmartRecruiters, Recruitee). It walks every fillable
 * control and resolves a human label from, in order: an explicit label[for], a
 * wrapping <label>, aria-labelledby / aria-label, the nearest question/field
 * container's label-ish element, the placeholder, then the control name.
 *
 * Radio/checkbox inputs are intentionally skipped here — auto-picking them is
 * unsafe, so they are left for `requiredUncheckedGroups` to flag for the human. */
export async function detectControls(surface: Surface, cfg: AtsConfig): Promise<DetectedField[]> {
  const form = await formScope(surface, cfg);
  const raw = await form.locator('input, select, textarea').evaluateAll((els) => {
    // `search` excluded too: it's a filter box (e.g. the country search inside an
    // intl-tel-input phone widget), never an application answer field.
    const skip = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'radio', 'checkbox', 'search']);
    const captchaRe = /g-recaptcha|recaptcha|h-captcha|cf-turnstile|hcaptcha/i;
    const labelText = (el: Element): string => {
      const id = el.getAttribute('id');
      if (id) {
        const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l?.textContent) return l.textContent;
      }
      const wrap = el.closest('label');
      if (wrap?.textContent) return wrap.textContent;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const t = labelledBy
          .split(/\s+/)
          .map((x) => el.ownerDocument.getElementById(x)?.textContent ?? '')
          .join(' ')
          .trim();
        if (t) return t;
      }
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const container = el.closest('[class*="question"], [class*="field"], [data-qa], li, fieldset');
      if (container) {
        const cl = container.querySelector('label, legend, [class*="label"]');
        if (cl && !cl.contains(el) && cl.textContent) return cl.textContent;
      }
      const ph = (el as HTMLInputElement).placeholder;
      if (ph) return ph;
      return el.getAttribute('name') ?? '';
    };
    const out: Array<{ id: string; label: string; tag: string; type: string; required: boolean; combo: boolean }> = [];
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type ?? tag;
      if (tag === 'input' && skip.has(type)) continue;
      const id = el.getAttribute('id') ?? '';
      const name = el.getAttribute('name') ?? '';
      if (captchaRe.test(id) || captchaRe.test(name)) continue;
      // A control with neither id nor name gets a stamped key so fill/validate
      // can still address it; an empty key marks the (pathological) unstampable
      // case, which validate surfaces as a fail-closed blocker.
      let key = id || name;
      if (!key) {
        try {
          key = el.getAttribute('data-jobhelp-key') ?? '';
          if (!key) {
            const stamp = `jobhelp-${Math.random().toString(36).slice(2, 10)}`;
            el.setAttribute('data-jobhelp-key', stamp);
            key = el.getAttribute('data-jobhelp-key') === stamp ? stamp : '';
          }
        } catch {
          key = '';
        }
      }
      const label = labelText(el).replace(/\s+/g, ' ').trim();
      const required =
        (el as HTMLInputElement).required === true ||
        el.getAttribute('aria-required') === 'true' ||
        label.includes('*') ||
        label.includes('✱'); // heavy asterisk used by Lever
      out.push({ id: key, label, tag, type: tag === 'input' ? type : tag, required, combo: el.getAttribute('role') === 'combobox' });
    }
    return out;
  });

  const seen = new Set<string>();
  const fields: DetectedField[] = [];
  for (const r of raw) {
    if (r.id !== '' && seen.has(r.id)) continue;
    if (r.tag !== 'input' && r.tag !== 'textarea' && r.tag !== 'select') continue;
    if (r.id !== '') seen.add(r.id);
    fields.push({ id: r.id, label: r.label, tag: r.tag, type: r.type, required: r.required, reactSelect: r.combo });
  }
  return fields;
}
