import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { getGitBinDir, getGitDir, getGitEnv, getGitSource } from './git-provider.js';
import { createLauncher, type Launcher, type ShimOptions } from './launcher.js';

let launcher: Launcher | null = null;

export function getLauncher(): Launcher {
  launcher ??= createLauncher({
    platform: process.platform,
    isPackaged: app.isPackaged,
    home: homedir(),
    resourcesPath: process.resourcesPath,
    devCliPath: join(__dirname, '..', '..', '..', 'cli', 'dist', 'cli.js'),
  });
  return launcher;
}

/**
 * Shim settings for a bundled git: only git's own variables and PATH entries, never the
 * GUI's whole environment. The shim is rewritten on every launch, so a Squirrel
 * `app-<ver>\resources\git` path is never stale.
 */
export function bundledGitShimOptions(
  gitDir: string,
  gitBinDir: string,
  gitEnv: Record<string, string>,
  delimiter = ';',
): ShimOptions {
  const pathKey = Object.keys(gitEnv).find((k) => k.toLowerCase() === 'path');
  const gitPaths = (pathKey ? gitEnv[pathKey].split(delimiter) : []).filter(
    (entry) => entry && gitDir && entry.toLowerCase().startsWith(gitDir.toLowerCase()),
  );
  const env: Record<string, string> = { SYNCTHIS_GIT_DIR: gitBinDir };
  if (gitEnv.GIT_EXEC_PATH) env.GIT_EXEC_PATH = gitEnv.GIT_EXEC_PATH;
  return { env, pathPrefix: [...new Set([gitBinDir, ...gitPaths])] };
}

/** Call after initGitProvider() so a bundled git is baked into the shim. */
export async function ensureCliBundled(): Promise<void> {
  // If git init failed, still write the shim so the CLI remains reachable.
  let bundled = false;
  try {
    bundled = getGitSource() === 'bundled';
  } catch {
    // git provider not initialized
  }
  await getLauncher().writeShim(
    bundled ? bundledGitShimOptions(getGitDir(), getGitBinDir(), getGitEnv()) : {},
  );
}
