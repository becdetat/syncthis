> [!CAUTION]
> **Disclaimer:** This is a personal project, built primarily for my own use.
> I share it in the spirit of open source software, but I am not responsible for any lost data.
> Please review the [Security Policy](SECURITY.md) before use.
> LLM tools were involved in creating this project.

[![GitHub Release](https://img.shields.io/github/v/release/mischah/syncthis)](https://github.com/mischah/syncthis/releases)
[![CI](https://github.com/mischah/syncthis/actions/workflows/ci.yml/badge.svg)](https://github.com/mischah/syncthis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/mischah)

# <img src="packages/gui/resources/icons/icon-64.png" width="32" height="32" valign="middle" alt="syncthis icon" /> syncthis

> Automatic directory synchronization via Git.

Keep your files in sync across devices — no manual Git needed. Primary use case: [Obsidian](https://obsidian.md) vault synchronization.

## Desktop App

syncthis runs as a tray app that sits in your menu bar (macOS), system tray (Linux) or notification area (Windows). Connect your GitHub account, pick a repository, choose a local folder, and your files stay in sync automatically.

![syncthis Tray Popover](docs/images/tray-icon-with-popover.png)

### Features

**Visual conflict resolution** — When the same file is edited on two devices, resolve conflicts with a side-by-side diff view:

![Conflict Resolution](docs/images/conflict-text-diff.png)
![Conflict Resolution](docs/images/conflict-image-diff.png)

**Dashboard** — Monitor sync health, view activity, and manage settings:

![Detail View](docs/images/detail-view-healthy-status.png)

**Setup wizard** — Connect GitHub, pick a repo, choose a folder — done:

![Setup Wizard](docs/images/wizard-choose-repo.png)

### Prerequisites

- A [GitHub](https://github.com) account (free)
- [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org) ≥ 20 installed (CLI only — the desktop app bundles both)

New to Git? Follow the [Obsidian Setup Guide](docs/obsidian-setup-guide.md) for a step-by-step walkthrough.

### Download

Download the latest release from [GitHub Releases](https://github.com/mischah/syncthis/releases).

| Platform | Format |
|----------|--------|
| macOS | DMG (arm64 + x64) |
| Linux | deb |
| Windows 11 (x64) | Setup `.exe` (per-user, no admin rights needed) |

#### Windows: unsigned releases

Windows releases are currently **not code-signed**. When you run the installer:

- **SmartScreen** may show a "Windows protected your PC" dialog. Click **More info**, then **Run anyway**.
- **Windows 11 Smart App Control** in enforcement mode may block unsigned installers outright, with no "Run anyway" option. Workaround: turn Smart App Control off (Windows Security → App & browser control → Smart App Control settings; it can't be turned back on without resetting Windows), or wait for a signed release.

Windows 10 and Windows on ARM64 are not supported yet.

---

## Command Line

syncthis is also available as a CLI tool:

```bash
npm install -g syncthis
syncthis init --remote git@github.com:yourname/vault.git
syncthis start
```

See the [CLI documentation](packages/cli/README.md) or the [npm page](https://www.npmjs.com/package/syncthis) for full details.

---

## How It Works

On a configurable schedule (default: every 5 minutes), syncthis commits local changes, pulls remote changes via rebase, and pushes — fully automatic. Conflicts are detected and resolved based on your chosen [strategy](docs/Conflict-Strategies.md). See [How It Works](docs/How-It-Works.md) for the full sync cycle.

---

## Documentation

- [Obsidian Setup Guide](docs/obsidian-setup-guide.md) — Step-by-step for new users
- [CLI Reference](docs/CLI-Reference.md) — All commands and flags
- [Conflict Strategies](docs/Conflict-Strategies.md) — How conflicts are handled
- [How It Works](docs/How-It-Works.md) — Sync cycle and service lifecycle (launchd, systemd, Task Scheduler)
- [Development](docs/Development.md) — Dev setup and project structure

---

## Support

If you find syncthis useful, consider supporting its development:

- [GitHub Sponsors](https://github.com/sponsors/mischah)
- [PayPal](https://paypal.me/dazzlingtone)

---

## License

[MIT](LICENSE)
