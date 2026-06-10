import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './paths.ts';

export function docxPathForJob(dir: string): string {
  return join(dir, 'resume.autoapply.docx');
}

export function renderScriptPath(): string {
  return join(repoRoot(), 'scripts', 'render-jakestyle.mts');
}

export interface ResumeConverter {
  convert(mdPath: string, outDocxPath: string): Promise<void>;
}

export function makeRenderConverter(scriptPath: string): ResumeConverter {
  return {
    convert(mdPath, outDocxPath) {
      return new Promise<void>((resolve, reject) => {
        if (!existsSync(scriptPath)) {
          reject(new Error(`resume renderer not found at ${scriptPath} (scripts/render-jakestyle.mts)`));
          return;
        }
        const child = spawn(process.execPath, [scriptPath, mdPath, outDocxPath], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`render-jakestyle exited ${code ?? 'null'}`)),
        );
      });
    },
  };
}

export const renderJakestyleConverter: ResumeConverter = makeRenderConverter(renderScriptPath());
