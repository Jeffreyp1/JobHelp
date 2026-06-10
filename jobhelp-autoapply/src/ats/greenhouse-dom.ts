import type { Page } from 'playwright';
import type { DetectedField, Surface } from './form-config.ts';
import * as dom from './form-dom.ts';
import { detectControls } from './detect-controls.ts';
import { greenhouseConfig } from './greenhouse.ts';

/** Back-compat shim: the Greenhouse DOM helpers are now the generic engine bound
 * to the Greenhouse config. Existing imports keep their original signatures. */
export function surfaceOf(page: Page): Promise<Surface> {
  return dom.surfaceOf(page, greenhouseConfig);
}

export function detectFields(surface: Surface): Promise<DetectedField[]> {
  return detectControls(surface, greenhouseConfig);
}

export function fillReactSelect(surface: Surface, id: string, value: string): Promise<dom.ReactSelectResult> {
  return dom.fillReactSelect(surface, id, value, greenhouseConfig.reactSelect);
}
