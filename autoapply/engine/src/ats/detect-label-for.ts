import { formScope } from './form-dom.ts';
import type { AtsConfig, DetectedField, Surface } from './form-config.ts';

/** Field detection for forms that wire labels to controls with `label[for]` — the
 * standard accessible pattern used by Greenhouse, SmartRecruiters and Recruitee.
 * Each label resolves its target control; the control's tag/type/role classify it. */
export async function detectByLabelFor(surface: Surface, cfg: AtsConfig): Promise<DetectedField[]> {
  const form = await formScope(surface, cfg);
  const labels = form.locator('label[for]');
  const count = await labels.count();
  const captchaRe = /g-recaptcha|recaptcha|h-captcha|cf-turnstile|hcaptcha/i;
  const out: DetectedField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const lbl = labels.nth(i);
    const forId = await lbl.getAttribute('for');
    if (!forId || seen.has(forId)) continue;
    if (captchaRe.test(forId)) continue;
    const field = surface.locator(`[id="${forId}"]`);
    if ((await field.count()) === 0) continue;
    const info = await field.first().evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      type: (el as HTMLInputElement).type ?? '',
      name: el.getAttribute('name') ?? '',
      required: (el as HTMLInputElement).required === true,
      ariaRequired: el.getAttribute('aria-required') === 'true',
      role: el.getAttribute('role') ?? '',
    }));
    if (info.tag !== 'input' && info.tag !== 'textarea' && info.tag !== 'select') continue;
    if (captchaRe.test(info.name)) continue;
    const text = ((await lbl.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    seen.add(forId);
    out.push({
      id: forId,
      label: text,
      tag: info.tag,
      type: info.tag === 'input' ? info.type : info.tag,
      // The required marker on modern forms is an asterisk in the label or
      // `aria-required` on the control, not always the HTML `required` attribute.
      // Honor the plain and heavy asterisk and both required attributes.
      required: info.required || info.ariaRequired || text.includes('*') || text.includes('✱'),
      reactSelect: info.role === 'combobox',
    });
  }
  return out;
}
