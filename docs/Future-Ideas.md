# Future Ideas

These features are intentionally out of scope for now but may be explored later:

- **File watcher** — Trigger a sync immediately on file changes via `fs.watch`, instead of waiting for the next scheduled cycle.
- **Log rotation** — Automatically rotate or clean up log files by size or age.
- **Conflict cleanup** — A `syncthis cleanup` command to remove `.conflict-*` files from the directory (conflict copies are intentionally committed and synced to all devices so you can review them anywhere).
- **Conflict history** — Persistent log of which conflicts occurred, when, and how they were resolved, stored in `.syncthis/conflict-log.json`.
- **Dry-run mode** — `syncthis start --dry-run` to preview what would happen without making any changes.
- **Custom commit messages** — A template system for auto-commit message formatting.
- **Config migration** — Automatically update `.syncthis.json` on schema changes.
- **Standalone distribution** — Ship without requiring Node.js:
  - *Stage 1:* Homebrew formula with Node as a dependency (`brew install syncthis`).
  - *Stage 2:* Self-contained binaries via `bun build --compile` or Node SEA, built by GitHub Actions for macOS (arm64 + x64), Linux (x64), and Windows (x64).
- **CLI desktop toasts on Windows** — CLI desktop notifications currently cover macOS and Linux only.
- **Windows on ARM64** — Windows builds are x64 only.
- **winget / Microsoft Store** — Distribute the Windows app through a package manager or the Store.
- **Windows 10 support** — Windows 11 is the baseline; the headless Task Scheduler launch is unverified on Windows 10.
- **Auto-restart of crashed Windows services** — Task Scheduler's restart-on-failure doesn't work with the hidden launch, so crashed services show as unhealthy instead.
- **Service restart after update** — Restart running services automatically after the app updates.
- **Signing upgrades** — Ship signed Windows releases (removing the SmartScreen / Smart App Control caveat) and sign more of the bundle.
- **Service updates** — When syncthis is updated, existing service definitions may still point to the old binary path. A `syncthis update` command or automatic detection in `syncthis status` could handle this.
- **Automated releases** — Conventional Commits + `commit-and-tag-version` (or `release-it`) for SemVer tagging, auto-generated `CHANGELOG.md`, and a GitHub Actions workflow that publishes to npm on tag push.
