import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script without type declarations
import { stageGit, stripManagerHelper } from '../../scripts/stage-git.mjs';

describe('stripManagerHelper', () => {
  it('removes the manager helper and its empty section but keeps other sections', () => {
    const input =
      '[core]\n\tsymlinks = false\n[credential]\n\thelper = manager\n[http]\n\tsslBackend = schannel\n[credential "https://dev.azure.com"]\n\tuseHttpPath = true\n';
    const out = stripManagerHelper(input);
    expect(out).not.toContain('manager');
    expect(out).not.toMatch(/^\[credential\]/m);
    expect(out).toContain('sslBackend = schannel');
    expect(out).toContain('[credential "https://dev.azure.com"]');
  });

  it('keeps other credential settings in the section', () => {
    const out = stripManagerHelper('[credential]\n\thelper = manager\n\tuseHttpPath = true\n');
    expect(out).toContain('[credential]');
    expect(out).toContain('useHttpPath = true');
    expect(out).not.toContain('manager');
  });
});

describe('stageGit', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stage-git-test-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('drops the credential manager and its libraries and keeps the rest', () => {
    const src = join(root, 'src');
    const bin = join(src, 'mingw64', 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(src, 'etc'));
    mkdirSync(join(src, 'usr', 'bin'), { recursive: true });
    const drop = [
      'git-credential-manager.exe',
      'git-credential-manager.exe.config',
      'git-credential-helper-selector.exe',
      'Avalonia.Base.dll',
      'Avalonia.dll',
      'Microsoft.Identity.Client.dll',
      'System.Text.Json.dll',
      'SkiaSharp.dll',
      'libSkiaSharp.dll',
      'msalruntime.dll',
      'gcmcore.dll',
    ];
    const keep = [
      'git.exe',
      'git-remote-https.exe',
      'libcurl-4.dll',
      'libssl-3-x64.dll',
      'zlib1.dll',
    ];
    for (const name of [...drop, ...keep]) writeFileSync(join(bin, name), 'x');
    writeFileSync(join(src, 'usr', 'bin', 'sh.exe'), 'x');
    writeFileSync(join(src, 'etc', 'gitconfig'), '[credential]\n\thelper = manager\n');

    const dest = join(root, 'out', 'git');
    const removed: string[] = stageGit(src, dest);

    expect([...removed].sort()).toEqual([...drop].sort());
    for (const name of drop) expect(existsSync(join(dest, 'mingw64', 'bin', name))).toBe(false);
    for (const name of keep) expect(existsSync(join(dest, 'mingw64', 'bin', name))).toBe(true);
    expect(existsSync(join(dest, 'usr', 'bin', 'sh.exe'))).toBe(true);
    expect(readFileSync(join(dest, 'etc', 'gitconfig'), 'utf8')).not.toContain('manager');
    expect(existsSync(join(src, 'mingw64', 'bin', 'Avalonia.dll'))).toBe(true);
  });
});
