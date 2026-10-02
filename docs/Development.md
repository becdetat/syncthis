# Development

## Setup

```bash
git clone git@github.com:mischah/syncthis.git
cd syncthis
npm install
```

## Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run dev -w packages/cli -- -- --help` | Run CLI in dev mode |
| `npm test` | Run all tests |
| `npm run build` | Build `dist/cli.js` |
| `npm run lint` | Lint and check formatting |
| `npm run lint:fix` | Auto-fix lint and formatting issues |
| `npm run typecheck -w packages/cli` | Type-check without building |
| `npm run dev:gui` | Run GUI in development mode |
| `npm run make:gui` | Build GUI distributables |

Before finishing work on a feature or fix, all three must pass:

```bash
npm run typecheck
npm run test
npm run lint:fix
```

## Windows development

- Install **Node 24** (the Windows build and the bundled `node.exe` use it) and Git for Windows.
- Renormalise line endings once on existing clones, see [Line endings](#line-endings-windows).
- To check the Task Scheduler design on a real machine (non-elevated, about 2 minutes, cleans up after itself):

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File docs/research/task-scheduler-validate.ps1
  ```

### Building the Windows installer

Windows installers must be built on Windows; cross-compilation is not supported.

```powershell
npm install
npm run make:gui
```

The output in `packages/gui/out/make/` is `SyncThis-<version>-win32-x64-setup.exe`, `RELEASES` and `SyncThis-<version>-full.nupkg` (don't rename the nupkg; `RELEASES` references it). The `premake` step stages a trimmed copy of dugite's Git into `resources\git`.

### Signing

Signing is optional. When `WINDOWS_CERTIFICATE_FILE` is set (with `WINDOWS_CERTIFICATE_PASSWORD`), the build signs SyncThis's own binaries after packaging; `node.exe` and the bundled Git keep their vendor signatures and are never re-signed. Without these variables the build logs "Windows signing disabled" and produces an **unsigned** installer, which triggers SmartScreen and may be blocked by Smart App Control (see the [README](../README.md#windows-unsigned-releases)). In CI, set the same names as repository secrets.

Releases are built by the `windows-latest` job in `.github/workflows/gui-release.yml`. Use [.github/release-notes-template.md](../.github/release-notes-template.md) for the release notes.

## Line endings (Windows)

The repo enforces LF via `.gitattributes`. On a Windows clone made before that file existed (or with `core.autocrlf=true`), renormalise once so the working tree matches the index and Biome stops reporting formatter errors:

```sh
git stash            # keep local changes safe
git add --renormalize .
git commit           # only if git reports renormalised files; otherwise skip
git stash pop
```

Or, on a clean tree, discard and re-checkout everything:

```sh
git rm --cached -r . && git reset --hard
```

Verify with `git ls-files --eol` (text files should report `w/lf`). Tests that `git init` temp repos set `core.autocrlf=false` locally, so they do not depend on your git config. Product code takes no line-ending stance: synced folders are user data.

## Project Structure

```
syncthis/
├── packages/
│   ├── gui/
│   │   ├── src/
│   │   │   ├── main/             # Electron main process + IPC
│   │   │   ├── renderer/         # React UI (views, components, hooks)
│   │   │   └── preload/          # Preload scripts (context bridge)
│   │   ├── forge.config.ts       # Electron Forge config (makers, plugins)
│   │   └── tailwind.config.js
│   └── cli/
│       ├── src/
│       │   ├── cli.ts           # Entry point, command routing
│       │   ├── commands/
│       │   │   ├── init.ts
│       │   │   ├── resolve.ts   # Interactive conflict resolution
│       │   │   ├── start.ts     # Dual-mode: service (default) + foreground
│       │   │   ├── status.ts
│       │   │   ├── health.ts    # Health check command
│       │   │   └── daemon.ts    # Service management functions
│       │   ├── conflict/
│       │   │   ├── resolver.ts          # Conflict detection & strategy dispatch
│       │   │   ├── interactive.ts       # Interactive prompts & resolution logic
│       │   │   ├── hunk-resolver.ts     # Chunk-by-chunk per-hunk resolution
│       │   │   ├── diff-renderer.ts     # Word-level diff rendering
│       │   │   ├── conflict-filename.ts # Conflict copy filename generation
│       │   └── notify/
│       │       └── desktop.ts           # OS-native desktop notifications (macOS/Linux)
│       │   ├── daemon/
│       │   │   ├── platform.ts  # DaemonPlatform interface + factory
│       │   │   ├── launchd.ts   # macOS launchd implementation
│       │   │   ├── systemd.ts   # Linux systemd implementation
│       │   │   ├── windows-task.ts  # Windows Task Scheduler implementation
│       │   │   ├── service-name.ts  # Service naming + slugify
│       │   │   └── templates.ts # Plist / unit file generation
│       │   ├── json-output.ts   # JSON response types and output helpers
│       │   ├── config.ts        # Config loading & validation
│       │   ├── sync.ts          # Git sync cycle
│       │   ├── scheduler.ts     # Cron / interval scheduler
│       │   ├── lock.ts          # Process lock management
│       │   ├── health.ts        # Health file read/write
│       │   ├── health-check.ts  # Health status determination
│       │   └── logger.ts        # stdout + file logging
│       └── tests/
│           ├── unit/
│           └── integration/
├── biome.json                   # Linting & formatting
└── tsconfig.base.json
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript 5 (ESM) |
| CLI framework | [meow](https://github.com/sindresorhus/meow) |
| Git operations | [simple-git](https://github.com/steveukx/git-js) |
| Scheduler | [croner](https://github.com/Hexagon/croner) |
| Bundler | [tsdown](https://github.com/sxzz/tsdown) |
| Tests | [Vitest](https://vitest.dev) + [execa](https://github.com/sindresorhus/execa) |
| Linting | [Biome](https://biomejs.dev) |
| Desktop framework | [Electron](https://www.electronjs.org) 33 |
| Desktop UI | [React](https://react.dev) 18 + [shadcn/ui](https://ui.shadcn.com) |
| Desktop bundler | [Vite](https://vite.dev) 7 |
| Desktop styling | [Tailwind CSS](https://tailwindcss.com) 3 |
