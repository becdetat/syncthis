import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const TASK_FOLDER = '\\SyncThis';
const LOCK_FILENAME = '.syncthis.lock';
const STOP_REQUEST_PATH = ['.syncthis', 'stop-request'];

/** Squirrel allows the uninstall hook roughly 15 s (unverified); stay well inside it. */
export const UNINSTALL_BUDGET_MS = 10_000;
const COOPERATIVE_WAIT_MS = 4_000;
const POLL_MS = 250;
const SUBPROCESS_TIMEOUT_MS = 3_000;

export interface UninstallDeps {
  /** Full names (`\SyncThis\<service>`) of every task in the SyncThis folder. */
  listTasks: () => Promise<string[]>;
  /** The synced folder a task runs for, or undefined when it cannot be determined. */
  taskDirPath: (taskName: string) => Promise<string | undefined>;
  deleteTask: (taskName: string) => Promise<void>;
  /** PID recorded in the folder's lock file, if any. */
  readLockPid: (dirPath: string) => Promise<number | undefined>;
  isAlive: (pid: number) => boolean;
  writeStopRequest: (dirPath: string) => Promise<void>;
  killTree: (pid: number) => Promise<void>;
  removePath: (path: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => Promise<void>;
  /** `%USERPROFILE%\.syncthis` */
  syncthisHome: string;
}

export interface UninstallOptions {
  budgetMs?: number;
  cooperativeWaitMs?: number;
  pollMs?: number;
}

/**
 * Cleans up what the app registered outside its own directory. Idempotent and never
 * throws: every step is isolated so one failure cannot block the rest or the uninstall.
 * Synced folders, the registry and Electron userData are deliberately left alone.
 */
export async function runUninstallCleanup(
  deps: UninstallDeps,
  options: UninstallOptions = {},
): Promise<void> {
  const budgetMs = options.budgetMs ?? UNINSTALL_BUDGET_MS;
  const cooperativeWaitMs = options.cooperativeWaitMs ?? COOPERATIVE_WAIT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const deadline = deps.now() + budgetMs;

  const step = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      await safeLog(deps, `ok: ${label}`);
    } catch (err) {
      await safeLog(deps, `failed: ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  let tasks: string[] = [];
  await step('list tasks', async () => {
    tasks = await deps.listTasks();
  });

  const dirPaths = new Set<string>();
  for (const task of tasks) {
    await step(`read folder of ${task}`, async () => {
      const dirPath = await deps.taskDirPath(task);
      if (dirPath) dirPaths.add(dirPath);
    });
  }

  // Stop all services concurrently so one slow service cannot eat the whole budget.
  await Promise.all(
    [...dirPaths].map((dirPath) =>
      step(`stop service in ${dirPath}`, () =>
        stopService(deps, dirPath, deadline, cooperativeWaitMs, pollMs),
      ),
    ),
  );

  for (const task of tasks) {
    await step(`delete task ${task}`, () => deps.deleteTask(task));
  }

  await step('remove shim', () => deps.removePath(join(deps.syncthisHome, 'bin', 'syncthis.cmd')));
  await step('remove credentials', () => deps.removePath(join(deps.syncthisHome, 'credentials')));
}

async function stopService(
  deps: UninstallDeps,
  dirPath: string,
  deadline: number,
  cooperativeWaitMs: number,
  pollMs: number,
): Promise<void> {
  const pid = await deps.readLockPid(dirPath);
  if (pid === undefined || !deps.isAlive(pid)) return;

  await deps.writeStopRequest(dirPath);
  const waitUntil = Math.min(deps.now() + cooperativeWaitMs, deadline);
  while (deps.isAlive(pid) && deps.now() < waitUntil) {
    await deps.sleep(pollMs);
  }
  if (deps.isAlive(pid)) await deps.killTree(pid);
}

async function safeLog(deps: UninstallDeps, line: string): Promise<void> {
  try {
    await deps.log(line);
  } catch {
    // logging must never break the uninstall
  }
}

function run(file: string, args: string[], options: { windowsVerbatimArguments?: boolean } = {}) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: SUBPROCESS_TIMEOUT_MS, windowsHide: true, ...options },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extracts the `--path` argument of the service command from `schtasks /query /xml` output. */
export function parseTaskDirPath(xml: string): string | undefined {
  const args = xml.match(/<Arguments>([\s\S]*?)<\/Arguments>/)?.[1];
  if (args === undefined) return undefined;
  const match = unescapeXml(args).match(/--path\s+(?:"([^"]*)"|(\S+))/);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** Task names (`\SyncThis\<service>`) from `schtasks /query /fo csv /nh` output. */
export function parseTaskNames(csv: string): string[] {
  const names = new Set<string>();
  const prefix = `${TASK_FOLDER}\\`.toLowerCase();
  for (const line of csv.split(/\r?\n/)) {
    const name = line.match(/^"([^"]*)"/)?.[1];
    if (name?.toLowerCase().startsWith(prefix)) names.add(name);
  }
  return [...names];
}

export function createDefaultUninstallDeps(): UninstallDeps {
  const logPath = join(tmpdir(), 'syncthis-uninstall.log');
  return {
    listTasks: async () => {
      try {
        return parseTaskNames(
          await run('schtasks', ['/query', '/tn', `${TASK_FOLDER}\\`, '/fo', 'csv', '/nh']),
        );
      } catch {
        return []; // no SyncThis folder: nothing registered
      }
    },
    taskDirPath: async (taskName) => {
      // schtasks writes the console codepage, which garbles non-ASCII paths; switch to UTF-8 first.
      const xml = await run(
        'cmd',
        ['/d', '/s', '/c', `chcp 65001>nul && schtasks /query /tn "${taskName}" /xml`],
        { windowsVerbatimArguments: true },
      );
      return parseTaskDirPath(xml);
    },
    deleteTask: async (taskName) => {
      await run('schtasks', ['/delete', '/tn', taskName, '/f']);
    },
    readLockPid: async (dirPath) => {
      try {
        const lock = JSON.parse(await readFile(join(dirPath, LOCK_FILENAME), 'utf8')) as {
          pid?: unknown;
        };
        return typeof lock.pid === 'number' ? lock.pid : undefined;
      } catch {
        return undefined;
      }
    },
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    writeStopRequest: async (dirPath) => {
      await mkdir(join(dirPath, STOP_REQUEST_PATH[0]), { recursive: true });
      await writeFile(join(dirPath, ...STOP_REQUEST_PATH), `${new Date().toISOString()}\n`);
    },
    killTree: async (pid) => {
      await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    },
    removePath: (path) => rm(path, { recursive: true, force: true }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => appendFile(logPath, `${new Date().toISOString()} ${line}\n`),
    syncthisHome: join(homedir(), '.syncthis'),
  };
}

/** The `--squirrel-uninstall` cleanup hook. Never rejects. */
export async function windowsUninstallCleanup(): Promise<void> {
  try {
    await runUninstallCleanup(createDefaultUninstallDeps());
  } catch (err) {
    console.error('[squirrel] uninstall cleanup failed:', err);
  }
}
