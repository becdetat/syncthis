import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { getGitBinDir, getGitEnv, getGitSource } from './git-provider.js';
import { createLauncher, type Launcher } from './launcher.js';

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

/** Call after initGitProvider() so a bundled git is baked into the shim. */
export async function ensureCliBundled(): Promise<void> {
  // If git init failed, still write the shim so the CLI remains reachable.
  let bundled = false;
  try {
    bundled = getGitSource() === 'bundled';
  } catch {
    // git provider not initialized
  }
  const gitBinDir = bundled ? getGitBinDir() : '';
  await getLauncher().writeShim({
    env: bundled ? { ...getGitEnv(), SYNCTHIS_GIT_DIR: gitBinDir } : {},
    pathPrefix: bundled ? [gitBinDir] : [],
  });
}
