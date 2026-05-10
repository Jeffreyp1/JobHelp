/**
 * Minimal Google Apps Script type declarations.
 * Covers only the subset used by this project.
 * For full types, install @types/google-apps-script.
 */

declare namespace GoogleAppsScript {
  namespace Events {
    interface DoPost {
      postData: {
        contents: string;
        length: number;
        name: string;
        type: string;
      };
      parameter: Record<string, string>;
      parameters: Record<string, string[]>;
      contextPath: string;
      contentLength: number;
      queryString: string;
    }
  }

  namespace Content {
    interface TextOutput {
      getContent(): string;
      getMimeType(): string;
      setContent(content: string): TextOutput;
      setMimeType(mimeType: MimeType): TextOutput;
      downloadAsFile(filename: string): TextOutput;
    }
  }

  enum MimeType {
    JSON = 'application/json',
    TEXT = 'text/plain',
    HTML = 'text/html',
  }
}

declare var SpreadsheetApp: {
  openById(id: string): GoogleAppsScript.Spreadsheet.Spreadsheet;
};

declare var ContentService: {
  createTextOutput(content: string): GoogleAppsScript.Content.TextOutput;
  MimeType: {
    JSON: string;
    TEXT: string;
    HTML: string;
  };
};

declare namespace GoogleAppsScript {
  namespace Spreadsheet {
    interface Spreadsheet {
      getSheetByName(name: string): Sheet | null;
      insertSheet(name: string): Sheet;
      getUrl(): string;
      getSheets(): Sheet[];
    }
    interface Sheet {
      getName(): string;
      getLastRow(): number;
      appendRow(row: unknown[]): void;
      getRange(row: number, col: number, numRows?: number, numCols?: number): Range;
      getSheetId(): number;
    }
    interface Range {
      getValues(): unknown[][];
    }
  }
}
