/**
 * Content script entry: on a Greenhouse application page, injects the JobHelp
 * autofill panel and keeps it mounted. The panel UI is in autofill-panel.ts;
 * the scan/classify/fill logic is in lib/greenhouse/* (unit-tested). This file
 * is the thin browser shell — page detection, mount, diagnostics — verified
 * manually in a real browser, not by unit tests.
 */
import { get } from './lib/storage.js';
import type { ApplicationProfile } from './lib/greenhouse/autofill.js';
import { remountIfDetached } from './lib/greenhouse/mount.js';
import { buildPanel, PANEL_ID } from './autofill-panel.js';

const TAG = '[JobHelp autofill]';

function isApplicationPage(): boolean {
  return document.querySelector('#application-form, #first_name, input#email') !== null;
}

async function loadProfile(): Promise<ApplicationProfile> {
  return (await get('autofillProfile')) ?? {};
}

async function loadResumeDump(): Promise<string> {
  return (await get('autofillResumeDump')) ?? '';
}

async function init(): Promise<void> {
  console.log(TAG, 'content script loaded on', location.href, '| top frame:', window.top === window);
  if (!isApplicationPage()) {
    console.log(TAG, 'no application form detected on this page/frame — panel NOT injected');
    return;
  }
  if (document.getElementById(PANEL_ID)) return;
  const storageOk = !!(globalThis as { chrome?: { storage?: { local?: unknown } } }).chrome
    ?.storage?.local;
  const [profile, resumeDump] = await Promise.all([loadProfile(), loadResumeDump()]);
  console.log(TAG, 'storage available:', storageOk, '| loaded profile keys:', Object.keys(profile),
    '| resumeDump chars:', resumeDump.length);
  const panel = buildPanel(profile, resumeDump);
  // Attach to <html>, not <body>: the React/Remix app manages <body>'s subtree
  // and removes foreign nodes on hydration. The observer re-appends if anything
  // (hydration, SPA route change) detaches it.
  document.documentElement.appendChild(panel);
  const observer = new MutationObserver(() => {
    remountIfDetached(panel, document.documentElement);
  });
  observer.observe(document.documentElement, { childList: true });
  console.log(TAG, 'panel injected (bottom-right)');
}

void init();
