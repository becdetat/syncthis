// Stages a trimmed copy of dugite's bundled git for the Windows package (resources/git).
// Run from the GUI `premake`. Third-party binaries are copied as-is, never re-signed.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Git Credential Manager and the .NET/Avalonia/Skia/MSAL libraries it drags in.
const CREDENTIAL_MANAGER_FILES =
  /^(git-credential-manager\.exe(\.config)?|git-credential-helper-selector\.exe|gcmcore\.dll|av_libglesv2\.dll|msalruntime(_x86)?\.dll|(lib)?(SkiaSharp|HarfBuzzSharp)\.dll|(Atlassian|Avalonia|GitHub|GitLab|MicroCom|Microsoft|System)(\..*)?\.dll)$/i;

export function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
}

/** Removes the `helper = manager` credential line (and its section if left empty). */
export function stripManagerHelper(gitconfig) {
  const lines = gitconfig.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*helper\s*=\s*manager(-core)?\s*$/.test(lines[i])) {
      const next = lines[i + 1];
      if (out.at(-1) === '[credential]' && (next === undefined || /^\s*\[/.test(next))) out.pop();
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\r\n');
}

/** Copies `source` to `dest` and removes the credential manager. Returns removed file names. */
export function stageGit(source, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true });

  const removed = [];
  for (const sub of readdirSync(dest)) {
    const bin = join(dest, sub, 'bin');
    if (!existsSync(bin)) continue;
    for (const name of readdirSync(bin)) {
      if (CREDENTIAL_MANAGER_FILES.test(name)) {
        rmSync(join(bin, name), { force: true });
        removed.push(name);
      }
    }
  }

  const gitconfig = join(dest, 'etc', 'gitconfig');
  if (existsSync(gitconfig)) {
    writeFileSync(gitconfig, stripManagerHelper(readFileSync(gitconfig, 'utf8')));
  }
  return removed;
}

/** Proves the staged git runs without git installed: --version plus a local init/commit. */
export function smokeTest(gitDir) {
  const exe = join(gitDir, 'cmd', 'git.exe');
  const sub =
    process.arch === 'arm64' ? 'clangarm64' : process.arch === 'x64' ? 'mingw64' : 'mingw32';
  const env = {
    ...process.env,
    PATH: `${join(gitDir, sub, 'bin')};${join(gitDir, 'usr', 'bin')};${process.env.PATH ?? ''}`,
    GIT_EXEC_PATH: join(gitDir, sub, 'libexec', 'git-core'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: 'NUL',
  };
  const repo = mkdtempSync(join(tmpdir(), 'syncthis-git-smoke-'));
  try {
    const run = (...args) => execFileSync(exe, args, { cwd: repo, env, encoding: 'utf8' });
    console.log(`[stage-git] ${run('--version').trim()}`);
    run('init');
    writeFileSync(join(repo, 'a.txt'), 'hello');
    run('add', 'a.txt');
    run('-c', 'user.name=smoke', '-c', 'user.email=smoke@example.com', 'commit', '-m', 'smoke');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function findDugiteGit(root) {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', 'dugite', 'git');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('node_modules/dugite/git not found');
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32') {
    console.log('[stage-git] skipped: bundled git is only shipped on Windows');
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const source = findDugiteGit(root);
    const dest = join(root, '.staging', 'git');
    const before = dirSize(source);
    const removed = stageGit(source, dest);
    smokeTest(dest);
    console.log(
      `[stage-git] removed ${removed.length} credential-manager files; ${mb(before)} -> ${mb(dirSize(dest))}`,
    );
  }
}
