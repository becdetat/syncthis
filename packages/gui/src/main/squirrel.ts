import { execFile } from 'node:child_process';
import path from 'node:path';

/** Must match the Squirrel maker `name: 'SyncThis'` and the exe name `SyncThis`. */
export const SQUIRREL_APP_USER_MODEL_ID = 'com.squirrel.SyncThis.SyncThis';

/** Squirrel holds a lock on its files shortly after first run; skip update checks until it clears. */
export const FIRSTRUN_UPDATE_DELAY_MS = 10_000;

export type SquirrelEvent = 'install' | 'updated' | 'obsolete' | 'uninstall' | 'firstrun';

const EVENTS: Record<string, SquirrelEvent> = {
  '--squirrel-install': 'install',
  '--squirrel-updated': 'updated',
  '--squirrel-obsolete': 'obsolete',
  '--squirrel-uninstall': 'uninstall',
  '--squirrel-firstrun': 'firstrun',
};

export function parseSquirrelEvent(argv: string[]): SquirrelEvent | null {
  for (const arg of argv) {
    const event = EVENTS[arg];
    if (event) return event;
  }
  return null;
}

export function shouldDelayUpdateCheck(argv: string[]): boolean {
  return parseSquirrelEvent(argv) === 'firstrun';
}

/**
 * The Squirrel stub exe, one directory above the versioned `app-<ver>` exe.
 * The login item must point here, as the versioned exe is deleted on update.
 */
export function loginItemPath(execPath: string): string {
  return path.win32.resolve(path.win32.dirname(execPath), '..', path.win32.basename(execPath));
}

/** Options for `app.setLoginItemSettings`; packaged Windows builds target the Squirrel stub. */
export function loginItemSettings(
  openAtLogin: boolean,
  platform: string,
  isPackaged: boolean,
  execPath: string,
): { openAtLogin: boolean; path?: string } {
  if (platform === 'win32' && isPackaged) return { openAtLogin, path: loginItemPath(execPath) };
  return { openAtLogin };
}

let uninstallHook: () => Promise<void> = async () => {};

/** Register cleanup work to run during `--squirrel-uninstall`. */
export function setSquirrelUninstallHook(hook: () => Promise<void>): void {
  uninstallHook = hook;
}

export interface SquirrelDeps {
  runUpdate: (updateExe: string, arg: string) => Promise<void>;
  onUninstall: () => Promise<void>;
}

export const defaultSquirrelDeps: SquirrelDeps = {
  runUpdate: (updateExe, arg) =>
    new Promise((resolve, reject) => {
      execFile(updateExe, [arg], (err) => (err ? reject(err) : resolve()));
    }),
  onUninstall: () => uninstallHook(),
};

/**
 * Handles Squirrel lifecycle arguments. Returns true when the app should exit
 * immediately; false for a normal launch (no event, or `--squirrel-firstrun`).
 */
export async function handleSquirrelEvent(
  argv: string[],
  execPath: string,
  deps: SquirrelDeps = defaultSquirrelDeps,
): Promise<boolean> {
  const event = parseSquirrelEvent(argv);
  if (event === null || event === 'firstrun') return false;

  const updateExe = path.win32.resolve(path.win32.dirname(execPath), '..', 'Update.exe');
  const exeName = path.win32.basename(execPath);

  try {
    if (event === 'install' || event === 'updated') {
      await deps.runUpdate(updateExe, `--createShortcut=${exeName}`);
    } else if (event === 'uninstall') {
      await deps.runUpdate(updateExe, `--removeShortcut=${exeName}`);
      await deps.onUninstall();
    }
  } catch (err) {
    console.error(`[squirrel] ${event} handler failed:`, err);
  }
  return true;
}
