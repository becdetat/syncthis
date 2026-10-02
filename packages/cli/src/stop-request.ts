import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { isLocked, releaseLock } from './lock.js';

const STOP_REQUEST_FILENAME = 'stop-request';
const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 12000;

export function stopRequestPath(dirPath: string): string {
  return join(dirPath, '.syncthis', STOP_REQUEST_FILENAME);
}

export async function writeStopRequest(dirPath: string): Promise<void> {
  await mkdir(join(dirPath, '.syncthis'), { recursive: true });
  await writeFile(stopRequestPath(dirPath), `${new Date().toISOString()}\n`, 'utf8');
}

export async function clearStopRequest(dirPath: string): Promise<void> {
  try {
    await unlink(stopRequestPath(dirPath));
  } catch {
    // already gone – ignore
  }
}

/**
 * Poll for a stop request written by `syncthis stop` and run `onRequest` once when it appears.
 * Windows has no catchable SIGTERM, so this is the cooperative stop channel. Returns a disposer.
 */
export function watchStopRequest(
  dirPath: string,
  onRequest: () => void,
  pollMs: number = DEFAULT_POLL_MS,
  exists: (path: string) => Promise<boolean> = defaultExists,
): () => void {
  const path = stopRequestPath(dirPath);
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    void exists(path).then(async (found) => {
      if (!found || fired) return;
      fired = true;
      clearInterval(timer);
      await clearStopRequest(dirPath);
      onRequest();
    });
  }, pollMs);
  timer.unref();
  return () => clearInterval(timer);
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface StopOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export type StopOutcome = 'not-running' | 'graceful' | 'killed';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stop the process holding the directory lock: cooperative stop-request first, then
 * `taskkill /T /F` on the lock PID (the process tree) if it has not exited in time.
 * Always leaves no lock or stop-request behind.
 */
export async function stopLockedProcess(
  dirPath: string,
  options: StopOptions = {},
): Promise<StopOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  const initial = await isLocked(dirPath);
  if (!initial.locked) {
    await clearStopRequest(dirPath);
    return 'not-running';
  }

  await writeStopRequest(dirPath);
  const deadline = Date.now() + timeoutMs;
  let lock = initial;
  while (lock.locked && Date.now() < deadline) {
    await sleep(pollMs);
    lock = await isLocked(dirPath);
  }

  let outcome: StopOutcome = 'graceful';
  if (lock.locked) {
    outcome = 'killed';
    if (lock.pid !== undefined) {
      try {
        await execa('taskkill', ['/PID', String(lock.pid), '/T', '/F']);
      } catch {
        // process may have exited between the poll and the kill
      }
    }
  }

  await clearStopRequest(dirPath);
  await releaseLock(dirPath);
  return outcome;
}
