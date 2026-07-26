import { formScope } from './form-dom.ts';
import type { AtsConfig, DetectedField, Surface } from './form-config.ts';

/** Field detection for forms that wire labels to controls with `label[for]` — the
 * standard accessible pattern; Ashby is the adapter that relies on it (the other
 * ATSs use control-first detection). Runs as ONE evaluate over the form's labels,
 * mirroring detect-controls, instead of paying several locator roundtrips per
 * label. */
export async function detectByLabelFor(surface: Surface, cfg: AtsConfig): Promise<DetectedField[]> {
  const form = await formScope(surface, cfg);
  const raw = await form.locator('label[for]').evaluateAll((els) => {
    const captchaRe = /g-recaptcha|recaptcha|h-captcha|cf-turnstile|hcaptcha/i;
    const out: Array<{ id: string; label: string; tag: string; type: string; required: boolean; combo: boolean }> = [];
    for (const lbl of els) {
      const forId = lbl.getAttribute('for') ?? '';
      if (forId === '' || captchaRe.test(forId)) continue;
      const el = lbl.ownerDocument.getElementById(forId);
      if (el === null) continue;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') continue;
      if (captchaRe.test(el.getAttribute('name') ?? '')) continue;
      const label = (lbl.textContent ?? '').replace(/\s+/g, ' ').trim();
      // The required marker on modern forms is an asterisk in the label or
      // `aria-required` on the control, not always the HTML `required` attribute.
      // Honor the plain and heavy asterisk and both required attributes.
      const required =
        (el as HTMLInputElement).required === true ||
        el.getAttribute('aria-required') === 'true' ||
        label.includes('*') ||
        label.includes('✱');
      out.push({
        id: forId,
        label,
        tag,
        type: tag === 'input' ? ((el as HTMLInputElement).type ?? '') : tag,
        required,
        combo: el.getAttribute('role') === 'combobox',
      });
    }
    return out;
  });

  const seen = new Set<string>();
  const fields: DetectedField[] = [];
  for (const r of raw) {
    if (seen.has(r.id)) continue;
    if (r.tag !== 'input' && r.tag !== 'textarea' && r.tag !== 'select') continue;
    seen.add(r.id);
    fields.push({ id: r.id, label: r.label, tag: r.tag, type: r.type, required: r.required, reactSelect: r.combo });
  }
  return fields;
}
