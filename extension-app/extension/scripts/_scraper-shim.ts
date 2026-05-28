
// Auto-generated entry shim for the scraper bundle.
// DO NOT import this file directly — it is only used by the build script.
import { scrapePage } from '../src/scraper.js';

declare global {
  interface Window {
    __jobhelpScrape: () => Promise<unknown>;
  }
}

window.__jobhelpScrape = () =>
  scrapePage({ document, url: location.href });
