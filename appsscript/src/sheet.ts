/**
 * Google Sheets integration for tracking resume generation history.
 * Appends a row to the "JobHelp Log" sheet in the specified spreadsheet,
 * creating the sheet + header row if they don't exist.
 */

import type { SheetRow } from './types/drive-ops.js';

const SHEET_NAME = 'JobHelp Log';

const HEADER_ROW = [
  'Date',
  'Company',
  'Role',
  'Job URL',
  'Doc URL',
  'Model Used',
  'Cost (USD)',
  'Keyword Match Rate',
  'Notes',
];

/**
 * Append a row to the tracking sheet.
 * Creates the sheet and header row if they don't exist.
 *
 * @param sheetId  Google Spreadsheet ID
 * @param row      Row data to append
 * @returns        rowIndex (1-based row number of the new data row) and rowUrl
 */
export function appendSheetRow(
  sheetId: string,
  row: SheetRow,
): { rowIndex: number; rowUrl: string } {
  const ss = SpreadsheetApp.openById(sheetId);

  // Get existing sheet or create it
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Create header row if the sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER_ROW);
  }

  // Build and append the data row
  const dataRow = [
    row.date,
    row.company ?? '',
    row.role ?? '',
    row.url,
    row.docUrl,
    row.modelUsed,
    row.costUsd,
    row.keywordMatchRate,
    row.notes ?? '',
  ];

  sheet.appendRow(dataRow);

  // Row index is 1-based; header is row 1, so data starts at row 2
  const rowIndex = sheet.getLastRow();
  const gid = sheet.getSheetId();

  const rowUrl =
    `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}&range=A${rowIndex}`;

  return { rowIndex, rowUrl };
}
