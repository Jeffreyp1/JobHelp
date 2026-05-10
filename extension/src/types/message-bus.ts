/**
 * Message types for chrome.runtime.sendMessage between background, content script, and side panel.
 * All messages flow through src/lib/messageBus.ts which provides typed send/on wrappers.
 */

import type { ScraperOutput } from "./scraper-output.js";
import type { GenerateRequest, GenerateResponse, ApiError } from "./api-contract.js";
import type { StorageSchema } from "./storage-schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Background → Side panel
// ─────────────────────────────────────────────────────────────────────────────

export interface TabChangedMessage {
  type: "tab_changed";
  tabId: number;
  url: string;
}

export interface ScrapeResultMessage {
  type: "scrape_result";
  payload: ScraperOutput;
}

export interface ScrapeFailureMessage {
  type: "scrape_failure";
  reason: string;
  url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Side panel → Background
// ─────────────────────────────────────────────────────────────────────────────

export interface RescanRequestMessage {
  type: "rescan_request";
}

export interface GenerateRequestMessage {
  type: "generate_request";
  payload: GenerateRequest;
}

export interface SettingsUpdateMessage {
  type: "settings_update";
  payload: Partial<StorageSchema>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Background → Side panel (replies)
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateResultMessage {
  type: "generate_result";
  payload: GenerateResponse;
}

export interface GenerateProgressMessage {
  type: "generate_progress";
  /** Free-form short status string for the panel to render */
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Union
// ─────────────────────────────────────────────────────────────────────────────

export type Message =
  | TabChangedMessage
  | ScrapeResultMessage
  | ScrapeFailureMessage
  | RescanRequestMessage
  | GenerateRequestMessage
  | GenerateResultMessage
  | GenerateProgressMessage
  | SettingsUpdateMessage;

export type MessageType = Message["type"];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;
