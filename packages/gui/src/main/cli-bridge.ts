import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JsonOutput } from '@syncthis/shared';
import { getLauncher } from './cli-bundler.js';
import { getGitBinDir, getGitEnv, getGitSource } from './git-provider.js';
import { prependToPath } from './launcher.js';

const execFileAsync = promisify(execFile);

function buildCliEnv(): NodeJS.ProcessEnv | undefined {
  const { extraEnv } = getLauncher();
  if (getGitSource() !== 'bundled') {
    return Object.keys(extraEnv).length ? { ...process.env, ...extraEnv } : undefined;
  }
  const gitBinDir = getGitBinDir();
  return prependToPath(
    { ...process.env, ...extraEnv, ...getGitEnv(), SYNCTHIS_GIT_DIR: gitBinDir },
    gitBinDir,
  );
}

export async function runCli(args: string[]): Promise<JsonOutput> {
  try {
    const { file, args: argv } = getLauncher().invocation(args);
    const { stdout } = await execFileAsync(file, argv, { env: buildCliEnv() });
    return JSON.parse(stdout) as JsonOutput;
  } catch (err: unknown) {
    const error = err as { stdout?: string; message?: string };
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout) as JsonOutput;
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      command: args[0] ?? 'unknown',
      error: { message: error.message ?? String(err) },
    };
  }
}

export async function startService(dirPath: string): Promise<JsonOutput> {
  return runCli(['start', '--path', dirPath]);
}

export async function stopService(dirPath: string): Promise<JsonOutput> {
  return runCli(['stop', '--path', dirPath]);
}
