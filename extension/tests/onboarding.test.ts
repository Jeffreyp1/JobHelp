import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from './helpers/chrome-mocks';
import { OnboardingState } from '../src/lib/onboardingState';

describe('OnboardingState', () => {
  beforeEach(() => {
    installChromeMock();
  });

  // T1: initial state is 'noConfig' when storage is empty
  it('T1: initial state is noConfig when storage is empty', async () => {
    const state = await OnboardingState.fromStorage();
    expect(state.state).toBe('noConfig');
  });

  // T2: setting apiKey advances to 'needsFolders' if folders not set
  it('T2: setting apiKey advances to needsFolders when folders not set', async () => {
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const state = await OnboardingState.fromStorage();
    expect(state.state).toBe('needsFolders');
  });

  // T3: setting all folder ids advances to 'seeding' if rules folder is empty
  it('T3: setting all folder ids advances to seeding', async () => {
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
      driveSourceFolderId: 'source-folder-id',
      driveRulesFolderId: 'rules-folder-id',
      driveOutputFolderId: 'output-folder-id',
      sheetId: 'sheet-id',
      onboardingState: 'seeding',
    });
    const state = await OnboardingState.fromStorage();
    expect(state.state).toBe('seeding');
  });

  // T4: after seedDefaults completes successfully, state advances to 'ready'
  it('T4: after seedDefaults completes, state advances to ready', async () => {
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
      driveSourceFolderId: 'source-folder-id',
      driveRulesFolderId: 'rules-folder-id',
      driveOutputFolderId: 'output-folder-id',
      sheetId: 'sheet-id',
      onboardingState: 'seeding',
    });
    const state = await OnboardingState.fromStorage();
    await state.markSeedComplete();
    await state.refresh();
    expect(state.state).toBe('ready');
  });

  // T5: state.canGenerate() returns true only when state === 'ready'
  it('T5: canGenerate() returns true only when state is ready', async () => {
    const mock = (globalThis as any).chrome;

    // noConfig
    const stateNoConfig = await OnboardingState.fromStorage();
    expect(await stateNoConfig.canGenerate()).toBe(false);

    // needsFolders
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const stateNeedsFolders = await OnboardingState.fromStorage();
    expect(await stateNeedsFolders.canGenerate()).toBe(false);

    // ready
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
      driveSourceFolderId: 'source-folder-id',
      driveRulesFolderId: 'rules-folder-id',
      driveOutputFolderId: 'output-folder-id',
      sheetId: 'sheet-id',
      onboardingState: 'ready',
    });
    const stateReady = await OnboardingState.fromStorage();
    expect(await stateReady.canGenerate()).toBe(true);
  });

  // T6: reset() clears all storage and returns state to 'noConfig'
  it('T6: reset() clears config and returns state to noConfig', async () => {
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
      driveSourceFolderId: 'source-folder-id',
      driveRulesFolderId: 'rules-folder-id',
      driveOutputFolderId: 'output-folder-id',
      sheetId: 'sheet-id',
      onboardingState: 'ready',
    });
    const state = await OnboardingState.fromStorage();
    expect(state.state).toBe('ready');
    await state.reset();
    expect(state.state).toBe('noConfig');

    // Verify storage was cleared
    const stored = await mock.storage.local.get('onboardingState');
    expect(stored.onboardingState).toBeUndefined();
  });

  // T7: state.next() advances through states without skipping
  it('T7: next() advances states in order without skipping', async () => {
    const mock = (globalThis as any).chrome;

    // Start from noConfig -> should move to needsApiKey or needsFolders
    const stateNoConfig = await OnboardingState.fromStorage();
    expect(stateNoConfig.state).toBe('noConfig');

    // Set appsScriptUrl + apiKey to advance to needsFolders
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const stateNeedsFolders = await OnboardingState.fromStorage();
    expect(stateNeedsFolders.state).toBe('needsFolders');

    // Set all folders -> seeding
    await mock.storage.local.set({
      driveSourceFolderId: 'source-folder-id',
      driveRulesFolderId: 'rules-folder-id',
      driveOutputFolderId: 'output-folder-id',
      sheetId: 'sheet-id',
      onboardingState: 'seeding',
    });
    const stateSeeding = await OnboardingState.fromStorage();
    expect(stateSeeding.state).toBe('seeding');

    // After markSeedComplete -> ready
    await stateSeeding.markSeedComplete();
    await stateSeeding.refresh();
    expect(stateSeeding.state).toBe('ready');
  });

  // T8: state.requiredFields() returns labels of what's missing
  it('T8: requiredFields() returns labels of missing fields', async () => {
    // Empty storage: all fields missing
    const stateEmpty = await OnboardingState.fromStorage();
    const missingAll = await stateEmpty.requiredFields();
    expect(missingAll).toContain('Apps Script URL');
    expect(missingAll).toContain('Anthropic API key');

    // Has api key + url but no folders
    const mock = (globalThis as any).chrome;
    await mock.storage.local.set({
      anthropicApiKey: 'sk-ant-test123',
      appsScriptUrl: 'https://script.google.com/macros/s/abc/exec',
    });
    const stateNeedsFolders = await OnboardingState.fromStorage();
    const missingFolders = await stateNeedsFolders.requiredFields();
    expect(missingFolders).toContain('Drive source folder ID');
    expect(missingFolders).toContain('Drive rules folder ID');
    expect(missingFolders).toContain('Drive output folder ID');
    expect(missingFolders).toContain('Tracking sheet ID');

    // All set -> empty
    await mock.storage.local.set({
      driveSourceFolderId: 'source-folder-id',
      driveRulesFolderId: 'rules-folder-id',
      driveOutputFolderId: 'output-folder-id',
      sheetId: 'sheet-id',
      onboardingState: 'ready',
    });
    const stateReady = await OnboardingState.fromStorage();
    const missingNone = await stateReady.requiredFields();
    expect(missingNone).toHaveLength(0);
  });
});
