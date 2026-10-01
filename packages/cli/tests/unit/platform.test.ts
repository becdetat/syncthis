import { isAbsolute, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/daemon/launchd.js', () => ({
  LaunchdPlatform: vi.fn(),
}));

vi.mock('../../src/daemon/systemd.js', () => ({
  SystemdPlatform: vi.fn(),
}));

vi.mock('../../src/daemon/windows-task.js', () => ({
  WindowsTaskPlatform: vi.fn(),
}));

import { LaunchdPlatform } from '../../src/daemon/launchd.js';
import { getNodeBinDir, getPlatform, getSyncthisBinary } from '../../src/daemon/platform.js';
import { SystemdPlatform } from '../../src/daemon/systemd.js';
import { WindowsTaskPlatform } from '../../src/daemon/windows-task.js';

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.clearAllMocks();
});

describe('getPlatform', () => {
  it('returns a LaunchdPlatform instance on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    getPlatform();
    expect(LaunchdPlatform).toHaveBeenCalledOnce();
  });

  it('returns a SystemdPlatform instance on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    getPlatform();
    expect(SystemdPlatform).toHaveBeenCalledOnce();
  });

  it('returns a WindowsTaskPlatform instance on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    getPlatform();
    expect(WindowsTaskPlatform).toHaveBeenCalledOnce();
  });

  it('throws an error on an unsupported platform', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    expect(() => getPlatform()).toThrow(
      "Daemon mode is not supported on freebsd. Use 'syncthis start' instead.",
    );
  });
});

describe('getSyncthisBinary', () => {
  it('returns an absolute path', () => {
    const binary = getSyncthisBinary();
    expect(isAbsolute(binary)).toBe(true);
  });
});

describe('getNodeBinDir', () => {
  it('returns the directory containing the node binary', () => {
    const binDir = getNodeBinDir();
    expect(isAbsolute(binDir)).toBe(true);
    expect(process.execPath.startsWith(binDir)).toBe(true);
  });
});

describe('SYNCTHIS_LAUNCHER', () => {
  afterEach(() => {
    delete process.env.SYNCTHIS_LAUNCHER;
  });

  it('getSyncthisBinary returns the launcher when set', () => {
    const launcher = String.raw`C:\Users\me\.syncthis\bin\syncthis.cmd`;
    process.env.SYNCTHIS_LAUNCHER = launcher;
    expect(getSyncthisBinary()).toBe(launcher);
  });

  it('getSyncthisBinary falls back to argv[1] when unset', () => {
    delete process.env.SYNCTHIS_LAUNCHER;
    expect(getSyncthisBinary()).toBe(resolve(process.argv[1]));
  });

  it('getNodeBinDir returns the launcher folder when set', () => {
    process.env.SYNCTHIS_LAUNCHER = join('/x', 'bin', 'syncthis.cmd');
    expect(getNodeBinDir()).toBe(join('/x', 'bin'));
  });
});
