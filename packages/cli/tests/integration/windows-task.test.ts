import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DaemonConfig } from '../../src/daemon/platform.js';
import { WindowsTaskPlatform } from '../../src/daemon/windows-task.js';
import { readLockFile } from '../../src/lock.js';

const TASK_FOLDER = '\\SyncThisTest';

// Stand-in for the syncthis CLI: records a lock file like `start --foreground` and stays alive.
const WORKER = `
const fs = require('fs'), path = require('path');
const i = process.argv.indexOf('--path');
const dir = process.argv[i + 1];
fs.writeFileSync(path.join(dir, '.syncthis.lock'),
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
setInterval(() => {}, 1000);
`;

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 20000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return undefined;
}

function killTree(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
}

describe.skipIf(process.platform !== 'win32')('WindowsTaskPlatform (Task Scheduler)', () => {
  const platform = new WindowsTaskPlatform(TASK_FOLDER);
  const created: string[] = [];
  let root: string;
  let binDir: string;
  let workerJs: string;
  let shim: string;

  async function cleanup(serviceName: string, dirPath: string): Promise<void> {
    const lock = await readLockFile(dirPath);
    if (lock) killTree(lock.pid);
    try {
      await platform.uninstall(serviceName);
    } catch {
      // not installed
    }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'syncthis-wt-'));
    binDir = join(root, 'bin dir');
    await mkdir(binDir, { recursive: true });
    workerJs = join(binDir, 'worker.js');
    await writeFile(workerJs, WORKER, 'utf8');
    shim = join(binDir, 'syncthis.cmd');
    await writeFile(shim, `@echo off\r\n"${process.execPath}" "${workerJs}" %*\r\n`, 'ascii');
  });

  afterAll(async () => {
    for (const [serviceName, dirPath] of created.map((c) => c.split('|'))) {
      await cleanup(serviceName, dirPath);
    }
    await new Promise((r) => setTimeout(r, 500));
    await rm(root, { recursive: true, force: true });
  });

  const variants = [
    { name: 'npm-installed CLI (direct node form)', launcher: false },
    { name: 'GUI launcher shim (cmd form)', launcher: true },
  ];

  it.each(variants)('full lifecycle: $name', async ({ launcher }) => {
    const suffix = launcher ? 'launcher' : 'npm';
    const dirPath = join(root, 'Zoë Smith', `My Notes ${suffix}`);
    await mkdir(dirPath, { recursive: true });
    const serviceName = `com.syncthis.test-${suffix}`;
    created.push(`${serviceName}|${dirPath}`);

    const config: DaemonConfig = {
      serviceName,
      dirPath,
      nodeBinDir: dirname(process.execPath),
      syncthisBinary: launcher ? shim : workerJs,
      cron: '*/5 * * * *',
    };

    expect(await platform.status(serviceName)).toEqual({ state: 'not-installed' });

    await platform.install(config);
    expect(await platform.status(serviceName)).toEqual({ state: 'stopped' });
    expect(await platform.isAutostartEnabled(serviceName)).toBe(false);

    const listed = (await platform.listAll()).find((d) => d.serviceName === serviceName);
    expect(listed).toMatchObject({
      label: `test-${suffix}`,
      dirPath,
      schedule: '*/5 * * * *',
      autostart: false,
      state: 'stopped',
    });

    await platform.start(serviceName);
    const running = await waitFor(async () => {
      const s = await platform.status(serviceName);
      return s.state === 'running' ? s : undefined;
    });
    expect(running?.pid).toBeGreaterThan(0);

    await platform.enableAutostart(serviceName);
    expect(await platform.isAutostartEnabled(serviceName)).toBe(true);
    expect((await platform.listAll()).find((d) => d.serviceName === serviceName)).toMatchObject({
      dirPath,
      schedule: '*/5 * * * *',
      autostart: true,
    });

    await platform.disableAutostart(serviceName);
    expect(await platform.isAutostartEnabled(serviceName)).toBe(false);

    await cleanup(serviceName, dirPath);
    expect(await platform.status(serviceName)).toEqual({ state: 'not-installed' });
  }, 90000);
});
