import { describe, expect, it, vi } from 'vitest';
import {
  handleSquirrelEvent,
  loginItemPath,
  loginItemSettings,
  parseSquirrelEvent,
  SQUIRREL_APP_USER_MODEL_ID,
  shouldDelayUpdateCheck,
} from '../../src/main/squirrel.js';

describe('parseSquirrelEvent', () => {
  it.each([
    ['--squirrel-install', 'install'],
    ['--squirrel-updated', 'updated'],
    ['--squirrel-obsolete', 'obsolete'],
    ['--squirrel-uninstall', 'uninstall'],
    ['--squirrel-firstrun', 'firstrun'],
  ])('maps %s to %s', (arg, event) => {
    expect(parseSquirrelEvent(['C:\\app\\SyncThis.exe', arg, '1.2.3'])).toBe(event);
  });

  it('returns null without a Squirrel argument', () => {
    expect(parseSquirrelEvent(['C:\\app\\SyncThis.exe', '--other'])).toBeNull();
    expect(parseSquirrelEvent([])).toBeNull();
  });

  it('returns null for unknown Squirrel arguments', () => {
    expect(parseSquirrelEvent(['x', '--squirrel-bogus'])).toBeNull();
  });
});

describe('loginItemPath', () => {
  it('points at the stub exe one directory above the versioned exe', () => {
    expect(loginItemPath('C:\\Users\\me\\AppData\\Local\\SyncThis\\app-1.2.3\\SyncThis.exe')).toBe(
      'C:\\Users\\me\\AppData\\Local\\SyncThis\\SyncThis.exe',
    );
  });
});

describe('loginItemSettings', () => {
  const exe = 'C:\\L\\SyncThis\\app-1.0.0\\SyncThis.exe';

  it('uses the stub path on packaged win32', () => {
    expect(loginItemSettings(true, 'win32', true, exe)).toEqual({
      openAtLogin: true,
      path: 'C:\\L\\SyncThis\\SyncThis.exe',
    });
  });

  it('uses defaults elsewhere', () => {
    expect(loginItemSettings(false, 'win32', false, exe)).toEqual({ openAtLogin: false });
    expect(loginItemSettings(true, 'darwin', true, exe)).toEqual({ openAtLogin: true });
  });
});

describe('AppUserModelID', () => {
  it('matches the Squirrel maker name and exe', () => {
    expect(SQUIRREL_APP_USER_MODEL_ID).toBe('com.squirrel.SyncThis.SyncThis');
  });
});

describe('handleSquirrelEvent', () => {
  const execPath = 'C:\\L\\SyncThis\\app-1.0.0\\SyncThis.exe';
  const makeDeps = () => ({
    runUpdate: vi.fn().mockResolvedValue(undefined),
    onUninstall: vi.fn().mockResolvedValue(undefined),
  });

  it('does nothing and keeps running when there is no Squirrel event', async () => {
    const deps = makeDeps();
    expect(await handleSquirrelEvent(['x'], execPath, deps)).toBe(false);
    expect(deps.runUpdate).not.toHaveBeenCalled();
  });

  it('keeps running on --squirrel-firstrun without touching shortcuts', async () => {
    const deps = makeDeps();
    expect(await handleSquirrelEvent(['x', '--squirrel-firstrun'], execPath, deps)).toBe(false);
    expect(deps.runUpdate).not.toHaveBeenCalled();
  });

  it.each([
    '--squirrel-install',
    '--squirrel-updated',
  ])('creates shortcuts on %s and quits', async (arg) => {
    const deps = makeDeps();
    expect(await handleSquirrelEvent(['x', arg], execPath, deps)).toBe(true);
    expect(deps.runUpdate).toHaveBeenCalledWith(
      'C:\\L\\SyncThis\\Update.exe',
      '--createShortcut=SyncThis.exe',
    );
  });

  it('removes shortcuts and runs the cleanup hook on uninstall', async () => {
    const deps = makeDeps();
    expect(await handleSquirrelEvent(['x', '--squirrel-uninstall'], execPath, deps)).toBe(true);
    expect(deps.runUpdate).toHaveBeenCalledWith(
      'C:\\L\\SyncThis\\Update.exe',
      '--removeShortcut=SyncThis.exe',
    );
    expect(deps.onUninstall).toHaveBeenCalledOnce();
  });

  it('quits on --squirrel-obsolete without side effects', async () => {
    const deps = makeDeps();
    expect(await handleSquirrelEvent(['x', '--squirrel-obsolete'], execPath, deps)).toBe(true);
    expect(deps.runUpdate).not.toHaveBeenCalled();
  });

  it('still quits when shortcut creation fails', async () => {
    const deps = makeDeps();
    deps.runUpdate.mockRejectedValue(new Error('boom'));
    expect(await handleSquirrelEvent(['x', '--squirrel-install'], execPath, deps)).toBe(true);
  });
});

describe('shouldDelayUpdateCheck', () => {
  it('delays only after a firstrun launch', () => {
    expect(shouldDelayUpdateCheck(['x', '--squirrel-firstrun'])).toBe(true);
    expect(shouldDelayUpdateCheck(['x'])).toBe(false);
  });
});
