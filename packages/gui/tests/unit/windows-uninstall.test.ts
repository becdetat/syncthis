import { describe, expect, it, vi } from 'vitest';
import {
  parseTaskDirPath,
  parseTaskNames,
  runUninstallCleanup,
  type UninstallDeps,
} from '../../src/main/windows-uninstall.js';

function makeDeps(overrides: Partial<UninstallDeps> = {}) {
  const calls: string[] = [];
  let clock = 0;
  const alive = new Set<number>();
  const deps: UninstallDeps = {
    listTasks: async () => ['\\SyncThis\\com.syncthis.a', '\\SyncThis\\com.syncthis.b'],
    taskDirPath: async (task) => (task.endsWith('.a') ? 'D:\\a' : 'D:\\b'),
    deleteTask: async (task) => {
      calls.push(`delete ${task}`);
    },
    readLockPid: async () => undefined,
    isAlive: (pid) => alive.has(pid),
    writeStopRequest: async (dir) => {
      calls.push(`stop-request ${dir}`);
    },
    killTree: async (pid) => {
      calls.push(`kill ${pid}`);
      alive.delete(pid);
    },
    removePath: async (path) => {
      calls.push(`remove ${path}`);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: async () => {},
    syncthisHome: 'C:\\Users\\me\\.syncthis',
    ...overrides,
  };
  return { deps, calls, alive };
}

describe('runUninstallCleanup', () => {
  it('deletes every task, the shim and the credentials, and nothing else', async () => {
    const { deps, calls } = makeDeps();
    await runUninstallCleanup(deps);
    expect(calls).toEqual([
      'delete \\SyncThis\\com.syncthis.a',
      'delete \\SyncThis\\com.syncthis.b',
      'remove C:\\Users\\me\\.syncthis\\bin\\syncthis.cmd',
      'remove C:\\Users\\me\\.syncthis\\credentials',
    ]);
  });

  it('stops a running service cooperatively before deleting its task', async () => {
    const { deps, calls, alive } = makeDeps({
      listTasks: async () => ['\\SyncThis\\com.syncthis.a'],
      readLockPid: async () => 42,
    });
    alive.add(42);
    let polls = 0;
    deps.sleep = async () => {
      if (++polls === 2) alive.delete(42); // service honours the stop request
    };
    await runUninstallCleanup(deps);
    expect(calls).toEqual([
      'stop-request D:\\a',
      'delete \\SyncThis\\com.syncthis.a',
      'remove C:\\Users\\me\\.syncthis\\bin\\syncthis.cmd',
      'remove C:\\Users\\me\\.syncthis\\credentials',
    ]);
  });

  it('kills the process tree when the cooperative stop times out', async () => {
    const { deps, calls, alive } = makeDeps({
      listTasks: async () => ['\\SyncThis\\com.syncthis.a'],
      readLockPid: async () => 42,
    });
    alive.add(42);
    await runUninstallCleanup(deps, { cooperativeWaitMs: 1000, pollMs: 250 });
    expect(calls.slice(0, 3)).toEqual([
      'stop-request D:\\a',
      'kill 42',
      'delete \\SyncThis\\com.syncthis.a',
    ]);
  });

  it('never waits past the overall budget', async () => {
    const { deps, alive } = makeDeps({
      listTasks: async () => ['\\SyncThis\\com.syncthis.a'],
      readLockPid: async () => 42,
      killTree: async () => {},
    });
    alive.add(42);
    const start = deps.now();
    await runUninstallCleanup(deps, { budgetMs: 2000, cooperativeWaitMs: 60_000, pollMs: 500 });
    expect(deps.now() - start).toBeLessThanOrEqual(2000);
  });

  it('skips services whose lock is stale or missing', async () => {
    const { deps, calls } = makeDeps({
      listTasks: async () => ['\\SyncThis\\com.syncthis.a'],
      readLockPid: async () => 999, // not alive
    });
    await runUninstallCleanup(deps);
    expect(calls.some((c) => c.startsWith('kill') || c.startsWith('stop-request'))).toBe(false);
  });

  it('keeps going when individual steps fail and never throws', async () => {
    const { deps, calls } = makeDeps({
      listTasks: async () => ['\\SyncThis\\com.syncthis.a', '\\SyncThis\\com.syncthis.b'],
      taskDirPath: async () => {
        throw new Error('xml unreadable');
      },
      deleteTask: async (task) => {
        if (task.endsWith('.a')) throw new Error('access denied');
        calls.push(`delete ${task}`);
      },
      removePath: async (path) => {
        if (path.endsWith('syncthis.cmd')) throw new Error('locked');
        calls.push(`remove ${path}`);
      },
      log: async () => {
        throw new Error('disk full');
      },
    });
    await expect(runUninstallCleanup(deps)).resolves.toBeUndefined();
    expect(calls).toEqual([
      'delete \\SyncThis\\com.syncthis.b',
      'remove C:\\Users\\me\\.syncthis\\credentials',
    ]);
  });

  it('still removes the shim and credentials when listing tasks fails', async () => {
    const listTasks = vi.fn().mockRejectedValue(new Error('schtasks missing'));
    const { deps, calls } = makeDeps({ listTasks });
    await runUninstallCleanup(deps);
    expect(calls).toEqual([
      'remove C:\\Users\\me\\.syncthis\\bin\\syncthis.cmd',
      'remove C:\\Users\\me\\.syncthis\\credentials',
    ]);
  });

  it('is idempotent when there is nothing left to clean', async () => {
    const { deps, calls } = makeDeps({ listTasks: async () => [] });
    await runUninstallCleanup(deps);
    await runUninstallCleanup(deps);
    expect(calls.filter((c) => c.startsWith('delete'))).toEqual([]);
  });
});

describe('parseTaskNames', () => {
  it('keeps only tasks in the SyncThis folder, once each', () => {
    const csv =
      '"\\SyncThis\\com.syncthis.notes","N/A","Ready"\r\n' +
      '"\\SyncThis\\com.syncthis.notes","N/A","Ready"\r\n' +
      '"\\SyncThisOther\\x","N/A","Ready"\r\n' +
      '"\\Other\\y","N/A","Ready"\r\n';
    expect(parseTaskNames(csv)).toEqual(['\\SyncThis\\com.syncthis.notes']);
  });
});

describe('parseTaskDirPath', () => {
  it('reads a quoted, XML-escaped --path', () => {
    const xml =
      '<Arguments>--headless cmd.exe /d /c syncthis.cmd start --foreground --path &quot;D:\\My Notes&quot; --cron &quot;*/5 * * * *&quot;</Arguments>';
    expect(parseTaskDirPath(xml)).toBe('D:\\My Notes');
  });

  it('reads an unquoted --path', () => {
    expect(parseTaskDirPath('<Arguments>start --path D:\\notes --interval 60</Arguments>')).toBe(
      'D:\\notes',
    );
  });

  it('returns undefined without arguments or path', () => {
    expect(parseTaskDirPath('<Task/>')).toBeUndefined();
    expect(parseTaskDirPath('<Arguments>start</Arguments>')).toBeUndefined();
  });
});
