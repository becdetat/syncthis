import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getGitBinaryPath, getGitEnv } from './git-provider.js';

const execFileAsync = promisify(execFile);

const CREDENTIALS_DIR = join(homedir(), '.syncthis', 'credentials');

const isWindows = (): boolean => process.platform === 'win32';

// LF only: dash fails to run a script with CRLF line endings, so never use os.EOL here.
function credentialScript(token: string): string {
  return `#!/bin/sh\necho "username=x-access-token"\necho "password=${token}"\n`;
}

// Git runs a `!` helper through sh, which needs a quoted forward-slash path
// (the profile path may contain spaces).
function windowsHelperValue(scriptPath: string): string {
  return `!'${scriptPath.split('\\').join('/')}'`;
}

async function restrictToCurrentUser(dir: string): Promise<void> {
  await execFileAsync('icacls', [
    dir,
    '/inheritance:r',
    '/grant:r',
    `${userInfo().username}:(OI)(CI)F`,
  ]);
}

async function gitConfig(dirPath: string, args: string[]): Promise<void> {
  await execFileAsync(getGitBinaryPath(), ['-C', dirPath, 'config', ...args], {
    env: { ...process.env, ...getGitEnv() },
  });
}

export function folderHash(dirPath: string): string {
  return createHash('sha256').update(dirPath).digest('hex').slice(0, 12);
}

export function getCredentialScriptPath(dirPath: string): string {
  return join(CREDENTIALS_DIR, `${folderHash(dirPath)}.sh`);
}

export async function writeCredentialHelper(dirPath: string, token: string): Promise<string> {
  const created = await mkdir(CREDENTIALS_DIR, { recursive: true });
  if (created !== undefined && isWindows()) await restrictToCurrentUser(CREDENTIALS_DIR);
  const scriptPath = join(CREDENTIALS_DIR, `${folderHash(dirPath)}.sh`);
  await writeFile(scriptPath, credentialScript(token), 'utf8');
  await chmod(scriptPath, 0o700);
  return scriptPath;
}

export async function configureRepoCredentialHelper(
  dirPath: string,
  scriptPath: string,
): Promise<void> {
  if (!isWindows()) {
    await gitConfig(dirPath, ['credential.helper', `!${scriptPath}`]);
    return;
  }
  // Git Credential Manager is configured system-wide and is consulted first (it may
  // prompt). Clear repo-level entries, then an empty value resets the inherited list.
  try {
    await gitConfig(dirPath, ['--unset-all', 'credential.helper']);
  } catch {
    // nothing configured yet
  }
  await gitConfig(dirPath, ['--add', 'credential.helper', '']);
  await gitConfig(dirPath, ['--add', 'credential.helper', windowsHelperValue(scriptPath)]);
}

export async function setupCredentials(dirPath: string, token: string): Promise<void> {
  const scriptPath = await writeCredentialHelper(dirPath, token);
  await configureRepoCredentialHelper(dirPath, scriptPath);
}

export async function removeCredentialHelper(dirPath: string): Promise<void> {
  const scriptPath = join(CREDENTIALS_DIR, `${folderHash(dirPath)}.sh`);
  try {
    await unlink(scriptPath);
  } catch {
    // file may not exist
  }
  try {
    await gitConfig(dirPath, [isWindows() ? '--unset-all' : '--unset', 'credential.helper']);
  } catch {
    // config may not be set
  }
}

export async function updateAllCredentialHelpers(newToken: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(CREDENTIALS_DIR);
  } catch {
    return; // directory doesn't exist yet
  }
  await Promise.all(
    files
      .filter((f) => f.endsWith('.sh'))
      .map(async (f) => {
        const scriptPath = join(CREDENTIALS_DIR, f);
        await writeFile(scriptPath, credentialScript(newToken), 'utf8');
        await chmod(scriptPath, 0o700);
      }),
  );
}
