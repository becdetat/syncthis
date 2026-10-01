import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFile,
  }),
}));

const mockMkdir = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockChmod = vi.hoisted(() => vi.fn());
const mockReaddir = vi.hoisted(() => vi.fn());
const mockUnlink = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  chmod: mockChmod,
  readdir: mockReaddir,
  unlink: mockUnlink,
}));

vi.mock('node:os', () => ({
  homedir: () => 'C:/Users/Jo Bloggs',
  userInfo: () => ({ username: 'Jo Bloggs' }),
}));

vi.mock('../../src/main/git-provider.js', () => ({
  getGitBinaryPath: () => 'git',
  getGitEnv: () => ({}),
}));

import {
  getCredentialScriptPath,
  removeCredentialHelper,
  setupCredentials,
  updateAllCredentialHelpers,
} from '../../src/main/credentials';

const realPlatform = process.platform;
function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

const gitCalls = () =>
  mockExecFile.mock.calls.filter(([file]) => file === 'git').map(([, args]) => args as string[]);
const icaclsCalls = () => mockExecFile.mock.calls.filter(([file]) => file === 'icacls');

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
  mockMkdir.mockResolvedValue('C:/Users/Jo Bloggs/.syncthis');
  setPlatform(realPlatform);
});

describe('setupCredentials on win32', () => {
  beforeEach(() => setPlatform('win32'));

  it('resets inherited helpers then registers a quoted forward-slash helper', async () => {
    await setupCredentials('D:/vault', 'tok');
    const script = getCredentialScriptPath('D:/vault').split(String.fromCharCode(92)).join('/');
    expect(script).toMatch(/^C:\/Users\/Jo Bloggs\/\.syncthis\/credentials\/[0-9a-f]{12}\.sh$/);
    expect(gitCalls()).toEqual([
      ['-C', 'D:/vault', 'config', '--unset-all', 'credential.helper'],
      ['-C', 'D:/vault', 'config', '--add', 'credential.helper', ''],
      ['-C', 'D:/vault', 'config', '--add', 'credential.helper', `!'${script}'`],
    ]);
  });

  it('writes the script with LF line endings only', async () => {
    await setupCredentials('D:/vault', 'tok');
    const content = mockWriteFile.mock.calls[0][1] as string;
    expect(content).toBe('#!/bin/sh\necho "username=x-access-token"\necho "password=tok"\n');
    expect(content).not.toContain('\r');
  });

  it('restricts the credentials directory with icacls once, when it is created', async () => {
    await setupCredentials('D:/vault', 'tok');
    expect(icaclsCalls()).toHaveLength(1);
    const [, args] = icaclsCalls()[0];
    expect(args[0]).toMatch(/credentials$/);
    expect(args.slice(1)).toEqual(['/inheritance:r', '/grant:r', 'Jo Bloggs:(OI)(CI)F']);
  });

  it('does not run icacls when the directory already existed', async () => {
    mockMkdir.mockResolvedValue(undefined);
    await setupCredentials('D:/vault', 'tok');
    expect(icaclsCalls()).toHaveLength(0);
  });

  it('tolerates an unset-all failure when no helper was configured', async () => {
    mockExecFile.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'git' && args.includes('--unset-all')) throw new Error('exit 5');
      return { stdout: '', stderr: '' };
    });
    await expect(setupCredentials('D:/vault', 'tok')).resolves.toBeUndefined();
    expect(gitCalls()).toHaveLength(3);
  });

  it('removes every helper entry when credentials are removed', async () => {
    await removeCredentialHelper('D:/vault');
    expect(gitCalls()).toEqual([['-C', 'D:/vault', 'config', '--unset-all', 'credential.helper']]);
  });

  it('rotates tokens in existing scripts with LF endings', async () => {
    mockReaddir.mockResolvedValue(['abc.sh', 'notes.txt']);
    await updateAllCredentialHelpers('new');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile.mock.calls[0][1]).toBe(
      '#!/bin/sh\necho "username=x-access-token"\necho "password=new"\n',
    );
  });
});

describe('setupCredentials on other platforms', () => {
  beforeEach(() => setPlatform('darwin'));

  it('keeps the single unquoted helper and never calls icacls', async () => {
    await setupCredentials('/v', 'tok');
    const script = getCredentialScriptPath('/v');
    expect(gitCalls()).toEqual([['-C', '/v', 'config', 'credential.helper', `!${script}`]]);
    expect(icaclsCalls()).toHaveLength(0);
  });

  it('unsets with plain --unset', async () => {
    await removeCredentialHelper('/v');
    expect(gitCalls()).toEqual([['-C', '/v', 'config', '--unset', 'credential.helper']]);
  });
});
