import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import simpleGit, { type SimpleGit } from 'simple-git';

const execFileAsync = promisify(execFile);

interface GitProviderState {
  binaryPath: string;
  env: Record<string, string>;
  source: 'system' | 'bundled';
}

let state: GitProviderState | null = null;

/**
 * Locates the git directory dugite should use. A packaged build ships a trimmed copy
 * as `resources/git`; unpackaged runs fall back to dugite's own download in node_modules.
 * Returns null when neither exists (dugite's bundled-JS default would then be wrong).
 */
export function findBundledGitDir(
  resourcesPath: string,
  appPath: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const packaged = join(resourcesPath, 'git');
  if (exists(packaged)) return packaged;
  for (let dir = appPath; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', 'dugite', 'git');
    if (exists(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

export async function initGitProvider(
  bundledGitDir: string | null = process.env.LOCAL_GIT_DIRECTORY ?? null,
): Promise<void> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000 });
    state = { binaryPath: 'git', env: {}, source: 'system' };
    console.log('[git-provider] Using system git');
    return;
  } catch {
    // System git not available — fall back to dugite
  }

  if (bundledGitDir) process.env.LOCAL_GIT_DIRECTORY = bundledGitDir;
  const { setupEnvironment } = await import('dugite');
  const result = setupEnvironment({});
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  state = { binaryPath: result.gitLocation, env, source: 'bundled' };
  console.log(`[git-provider] Using bundled git at ${result.gitLocation}`);
}

export function getGitSource(): 'system' | 'bundled' {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.source;
}

export function getGitBinaryPath(): string {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.binaryPath;
}

export function getGitBinDir(): string {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.source === 'bundled' ? dirname(state.binaryPath) : '';
}

/** Root of the bundled git (the dir holding `cmd`, `mingw64`, ...), or '' for system git. */
export function getGitDir(): string {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.source === 'bundled' ? (state.env.LOCAL_GIT_DIRECTORY ?? '') : '';
}

export function getGitEnv(): Record<string, string> {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.env;
}

export function getSimpleGit(dirPath: string): SimpleGit {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  const git = simpleGit(dirPath, { binary: state.binaryPath });
  if (state.source === 'bundled') {
    git.env(state.env);
  }
  return git;
}
