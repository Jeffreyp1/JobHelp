import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { ResumeData } from './templateFiller-types.js';

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function fillResumeTemplate(
  templateBlob: ArrayBuffer,
  data: ResumeData,
): Promise<Blob> {
  const bytes = new Uint8Array(templateBlob.slice(0));

  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch (err) {
    throw new Error(
      `templateFiller: failed to read template zip: ${(err as Error).message}`,
    );
  }

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });
  } catch (err) {
    throw new Error(
      `templateFiller: failed to compile template: ${(err as Error).message}`,
    );
  }

  try {
    doc.render(data as unknown as Record<string, unknown>);
  } catch (err) {
    const e = err as Error & {
      properties?: { errors?: Array<{ message?: string }> };
    };
    const inner = e.properties?.errors?.[0]?.message ?? '';
    throw new Error(
      `templateFiller: render failed: ${e.message}${inner ? ` — ${inner}` : ''}`,
    );
  }

  const out = doc.getZip().generate({
    type: 'uint8array',
    compression: 'DEFLATE',
  });
  return new Blob([out], {
    type: DOCX_MIME_TYPE,
  });
}
