import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function stateRoot(): string {
  return process.env['JOBHELP_HOME'] ?? join(homedir(), 'jobhelp');
}

export function stateFilePath(): string {
  return join(stateRoot(), 'state.json');
}

export function statusSidecarPath(): string {
  return join(stateRoot(), 'autoapply-status.json');
}

export function answerBankPath(): string {
  return join(stateRoot(), 'answer-bank.json');
}

export function configRoot(): string {
  return process.env['JOBHELP_CONFIG_DIR'] ?? join(homedir(), '.config', 'jobhelp');
}

export function profilePath(): string {
  return join(configRoot(), 'autoapply-profile.json');
}

/** The engine lives at <repo>/autoapply/engine/src — three levels below the repo. */
export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}
