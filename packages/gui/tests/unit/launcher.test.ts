import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildUnixWrapper,
  buildWindowsShim,
  createLauncher,
  type LauncherContext,
  prependToPath,
} from '../../src/main/launcher';

const win: LauncherContext = {
  platform: 'win32',
  isPackaged: true,
  home: 'C:\\Users\\me',
  resourcesPath: 'C:\\Users\\me\\AppData\\Local\\SyncThis\\app-1.0.0\\resources',
  devCliPath: 'D:\\repo\\packages\\cli\\dist\\cli.js',
};

describe('buildWindowsShim', () => {
  it('matches the golden shim with CRLF line endings', () => {
    const shim = buildWindowsShim('C:\\res\\node.exe', 'C:\\res\\dist\\cli.js');
    expect(shim).toBe(
      [
        '@echo off',
        'set "SYNCTHIS_LAUNCHER=%~f0"',
        '"C:\\res\\node.exe" "C:\\res\\dist\\cli.js" %*',
        'exit /b %ERRORLEVEL%',
        '',
      ].join('\r\n'),
    );
  });

  it('emits env and PATH prefix lines before the launch line', () => {
    const shim = buildWindowsShim('n.exe', 'c.js', {
      env: { GIT_TERMINAL_PROMPT: '0' },
      pathPrefix: ['C:\\git\\cmd'],
    });
    const lines = shim.split('\r\n');
    expect(lines[2]).toBe('set "GIT_TERMINAL_PROMPT=0"');
    expect(lines[3]).toBe('set "PATH=C:\\git\\cmd;%PATH%"');
    expect(lines[4]).toBe('"n.exe" "c.js" %*');
  });

  it('quotes paths with spaces', () => {
    const shim = buildWindowsShim('C:\\Program Files\\My App\\node.exe', 'C:\\a b\\cli.js');
    expect(shim).toContain('"C:\\Program Files\\My App\\node.exe" "C:\\a b\\cli.js" %*');
  });

  it('doubles percent signs in paths', () => {
    expect(buildWindowsShim('C:\\100%\\node.exe', 'c.js')).toContain('"C:\\100%%\\node.exe"');
  });

  it('switches to the UTF-8 code page for non-ASCII paths only', () => {
    expect(buildWindowsShim('C:\\Üser\\node.exe', 'c.js').startsWith('@chcp 65001 >nul\r\n')).toBe(
      true,
    );
    expect(buildWindowsShim('C:\\user\\node.exe', 'c.js')).not.toContain('chcp');
  });
});

describe('createLauncher', () => {
  it('win32 packaged runs resources node.exe directly with --json', () => {
    const l = createLauncher(win);
    expect(l.shimPath).toBe('C:\\Users\\me\\.syncthis\\bin\\syncthis.cmd');
    expect(l.invocation(['status'])).toEqual({
      file: `${win.resourcesPath}\\node.exe`,
      args: [`${win.resourcesPath}\\dist\\cli.js`, 'status', '--json'],
    });
  });

  it('win32 never invokes the .cmd shim from the GUI', () => {
    expect(createLauncher(win).invocation(['x']).file).not.toMatch(/\.cmd$/);
  });

  it('win32 unpackaged uses node from PATH and the repo cli.js', () => {
    const l = createLauncher({ ...win, isPackaged: false });
    expect(l.invocation([])).toEqual({ file: 'node', args: [win.devCliPath, '--json'] });
  });

  it('win32 passes the shim path to the CLI as SYNCTHIS_LAUNCHER', () => {
    const l = createLauncher(win);
    expect(l.extraEnv).toMatchObject({
      SYNCTHIS_LAUNCHER: l.shimPath,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    });
  });

  it.each(['darwin', 'linux'] as const)('%s keeps the shebang wrapper behaviour', (platform) => {
    const l = createLauncher({ ...win, platform, home: '/home/me' });
    expect(l.shimPath).toBe(join('/home/me', '.syncthis', 'bin', 'syncthis'));
    expect(l.invocation(['status'])).toEqual({ file: l.shimPath, args: ['status', '--json'] });
    expect(l.extraEnv).toEqual({});
  });

  it('unix wrapper is byte-identical to the previous format', () => {
    expect(buildUnixWrapper("/a/it's/cli.js")).toBe(
      "#!/usr/bin/env node\nimport('/a/it\\'s/cli.js');\n",
    );
  });

  it.runIf(process.platform === 'win32')(
    'writes the win32 shim atomically, leaving no temp files',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'launcher-'));
      const l = createLauncher({ ...win, home });
      await l.writeShim({ env: { A: '1' } });
      const first = await readFile(l.shimPath, 'utf8');
      expect(first).toContain('set "A=1"');
      await l.writeShim();
      const second = await readFile(l.shimPath, 'utf8');
      expect(second).not.toContain('set "A=1"');
      expect(second).toContain('@echo off\r\n');
      expect(await readdir(join(home, '.syncthis', 'bin'))).toEqual(['syncthis.cmd']);
    },
  );
});

describe('prependToPath', () => {
  it('handles PATH', () => {
    expect(prependToPath({ PATH: '/a' }, '/g').PATH).toBe(`/g${delimiter}/a`);
  });

  it('handles Path and preserves the key', () => {
    const env = prependToPath({ Path: 'C:\\a' }, 'C:\\g');
    expect(env.Path).toBe(`C:\\g${delimiter}C:\\a`);
    expect('PATH' in env).toBe(false);
  });
});
