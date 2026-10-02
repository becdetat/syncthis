import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bundledGitShimOptions } from '../../src/main/cli-bundler.js';
import { findBundledGitDir } from '../../src/main/git-provider.js';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

describe('findBundledGitDir', () => {
  it('prefers resources/git', () => {
    const res = join('r', 'resources');
    expect(findBundledGitDir(res, join('a', 'b'), (p) => p === join(res, 'git'))).toBe(
      join(res, 'git'),
    );
  });

  it('falls back to a hoisted node_modules/dugite/git above the app path', () => {
    const hoisted = join('repo', 'node_modules', 'dugite', 'git');
    expect(findBundledGitDir('res', join('repo', 'packages', 'gui'), (p) => p === hoisted)).toBe(
      hoisted,
    );
  });

  it('returns null when nothing exists', () => {
    expect(findBundledGitDir('res', join('repo', 'gui'), () => false)).toBeNull();
  });
});

describe('bundledGitShimOptions', () => {
  it('exports only git variables and git PATH entries', () => {
    const gitDir = 'C:\\app-1.0.0\\resources\\git';
    const opts = bundledGitShimOptions(gitDir, `${gitDir}\\cmd`, {
      Path: `${gitDir}\\mingw64\\bin;${gitDir}\\mingw64\\usr\\bin;C:\\Windows`,
      GIT_EXEC_PATH: `${gitDir}\\mingw64\\libexec\\git-core`,
      SECRET_TOKEN: 'nope',
    });
    expect(opts.env).toEqual({
      SYNCTHIS_GIT_DIR: `${gitDir}\\cmd`,
      GIT_EXEC_PATH: `${gitDir}\\mingw64\\libexec\\git-core`,
    });
    expect(opts.pathPrefix).toEqual([
      `${gitDir}\\cmd`,
      `${gitDir}\\mingw64\\bin`,
      `${gitDir}\\mingw64\\usr\\bin`,
    ]);
  });
});
