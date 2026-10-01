import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, win32 } from 'node:path';

export interface LauncherContext {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  home: string;
  resourcesPath: string;
  /** Where the CLI bundle lives when running unpackaged. */
  devCliPath: string;
}

export interface ShimOptions {
  /** Extra variables the shim sets before launching the CLI. */
  env?: Record<string, string>;
  /** Directories placed in front of the existing PATH. */
  pathPrefix?: string[];
}

export interface CliInvocation {
  file: string;
  args: string[];
}

export interface Launcher {
  /** Stable shim location that services and terminals call. */
  shimPath: string;
  /** Environment the GUI adds when it runs the CLI itself. */
  extraEnv: Record<string, string>;
  /** How the GUI runs the CLI with the given arguments. */
  invocation(args: string[]): CliInvocation;
  /** Writes the shim (and makes it runnable) on every GUI launch. */
  writeShim(options?: ShimOptions): Promise<void>;
}

// cmd.exe expands %VAR% inside quotes, so literal percent signs must be doubled.
const cmdEscape = (value: string): string => value.replace(/%/g, '%%');

export function buildWindowsShim(
  nodeExe: string,
  cliJs: string,
  options: ShimOptions = {},
): string {
  const lines = ['@echo off', 'set "SYNCTHIS_LAUNCHER=%~f0"'];
  for (const [key, value] of Object.entries(options.env ?? {})) {
    lines.push(`set "${key}=${cmdEscape(value)}"`);
  }
  if (options.pathPrefix?.length) {
    const prefix = options.pathPrefix.map(cmdEscape).join(';');
    lines.push(`set "PATH=${prefix};%PATH%"`);
  }
  lines.push(`"${cmdEscape(nodeExe)}" "${cmdEscape(cliJs)}" %*`, 'exit /b %ERRORLEVEL%');
  const body = lines.join('\r\n');
  // The file is UTF-8; cmd.exe needs the UTF-8 code page to read non-ASCII paths.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII range check
  const nonAscii = /[^\x00-\x7f]/.test(body);
  return `${nonAscii ? '@chcp 65001 >nul\r\n' : ''}${body}\r\n`;
}

export function buildUnixWrapper(cliJs: string): string {
  const escaped = cliJs.replace(/'/g, "\\'");
  return `#!/usr/bin/env node\nimport('${escaped}');\n`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

const WINDOWS_GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

function windowsLauncher(ctx: LauncherContext): Launcher {
  const shimPath = win32.join(ctx.home, '.syncthis', 'bin', 'syncthis.cmd');
  const nodeExe = ctx.isPackaged ? win32.join(ctx.resourcesPath, 'node.exe') : 'node';
  const cliJs = ctx.isPackaged ? win32.join(ctx.resourcesPath, 'dist', 'cli.js') : ctx.devCliPath;
  return {
    shimPath,
    // The GUI runs node directly, so services it registers must still get the shim.
    extraEnv: {
      SYNCTHIS_LAUNCHER: shimPath,
      ...WINDOWS_GIT_ENV,
    },
    invocation: (args) => ({ file: nodeExe, args: [cliJs, ...args, '--json'] }),
    async writeShim(options = {}) {
      await mkdir(dirname(shimPath), { recursive: true });
      const env = { ...WINDOWS_GIT_ENV, ...options.env };
      await atomicWrite(shimPath, buildWindowsShim(nodeExe, cliJs, { ...options, env }));
    },
  };
}

function unixLauncher(ctx: LauncherContext): Launcher {
  const shimPath = join(ctx.home, '.syncthis', 'bin', 'syncthis');
  const cliJs = ctx.isPackaged ? join(ctx.resourcesPath, 'dist', 'cli.js') : ctx.devCliPath;
  return {
    shimPath,
    extraEnv: {},
    invocation: (args) => ({ file: shimPath, args: [...args, '--json'] }),
    async writeShim() {
      await mkdir(dirname(shimPath), { recursive: true });
      await writeFile(shimPath, buildUnixWrapper(cliJs), 'utf8');
      await chmod(shimPath, 0o755);
    },
  };
}

export function createLauncher(ctx: LauncherContext): Launcher {
  return ctx.platform === 'win32' ? windowsLauncher(ctx) : unixLauncher(ctx);
}

/**
 * Prepends `dir` to PATH, finding the key case-insensitively (Windows uses `Path`).
 * Mirrors packages/cli/src/path-env.ts, which the GUI cannot import at runtime.
 */
export function prependToPath(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const existing = env[key];
  return { ...env, [key]: existing ? `${dir}${delimiter}${existing}` : dir };
}
