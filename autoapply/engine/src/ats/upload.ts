import type { AtsConfig, Surface } from './form-config.ts';
import type { StandingProfile } from '../types.ts';
import { fileInputKey, formScope } from './form-dom.ts';

export interface UploadOutcome {
  readonly resumeUploaded: boolean;
  /** Keys (fileInputKey, shared with fileInputsMissingUpload) whose upload was
   * verified on the live handle, so validate can trust them even after the
   * SPA clears input.files on its post-upload re-render. */
  readonly verifiedKeys: readonly string[];
}

/** Upload resume/cover into every file input under the form scope, enumerated
 * DIRECTLY rather than via cfg.detect: SPA forms (Ashby) hide the real input
 * behind an Upload button with no label[for] wiring, so label-driven detection
 * never sees it — and setInputFiles works fine on hidden inputs. Each upload is
 * verified on the SAME handle: the upload triggers a re-render that detaches the
 * node, and re-resolving the locator would wait out its full timeout. */
export async function uploadFiles(i: {
  surface: Surface;
  cfg: AtsConfig;
  resumeFilePath: string;
  profile: StandingProfile;
  isCover: (key: string, label: string) => boolean;
}): Promise<UploadOutcome> {
  const form = await formScope(i.surface, i.cfg);
  const handles = await form.locator('input[type=file]').elementHandles().catch(() => []);
  let resumeUploaded = false;
  const verifiedKeys: string[] = [];
  for (const handle of handles) {
    const info = await handle
      .evaluate((node) => {
        const el = node as Element;
        const id = el.getAttribute('id') ?? '';
        const name = el.getAttribute('name') ?? '';
        const label = [
          id !== '' ? el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? '' : '',
          el.closest('label')?.textContent ?? '',
          el.getAttribute('aria-label') ?? '',
        ]
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { id, name, label };
      })
      .catch(() => null);
    if (info === null) continue;
    const key = fileInputKey(info.id, info.name);
    const cover = i.isCover(key, info.label);
    const path = cover ? i.profile.coverLetterPath : resumeUploaded ? undefined : i.resumeFilePath;
    if (path === undefined) continue;
    await handle.setInputFiles(path, { timeout: 8000 }).catch(() => undefined);
    const landed = await handle
      .evaluate((el) => (((el as HTMLInputElement).files?.length ?? 0) > 0 ? true : false))
      .catch(() => false);
    if (!landed) continue;
    verifiedKeys.push(key);
    if (!cover) resumeUploaded = true;
  }
  return { resumeUploaded, verifiedKeys };
}
