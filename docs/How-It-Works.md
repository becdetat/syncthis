# How It Works

This describes the sync engine used by both the CLI and the desktop app.

## Sync cycle

Every sync cycle follows these steps:

```
                Scheduled trigger
                      │
                      ▼
          ┌───────────────────────┐          ┌────────────────────────┐
          │  Rebase in progress?  ├── Yes ──►│      Sync skipped;     │
          └───────────┬───────────┘          │ run `syncthis resolve` │
                     Nope                    └────────────────────────┘
                      │
                      ▼
              ┌───────────────────┐
              │    git status     │
              └───┬───────────┬───┘
                  │           │
               Changes     No changes
                  │           │
                  │           ▼
                  │  ┌───────────────────┐      ┌──────────────────┐
                  │  │ git pull --rebase ├─────►│   Sync paused /  │
                  │  └─────────┬─────────┘ Err  │ retry next cycle │
                  │           OK                └──────────────────┘
                  │            │
                  │            ▼
                  │    ┌───────────────────┐
                  │    │   HEAD changed?   │
                  │    └────┬─────────┬────┘
                  │        Yes       Nope
                  │         │         │
                  │         ▼         ▼
                  │    ┌────────┐  ┌───────┐
                  │    │ Pulled │  │ No-op │
                  │    └────────┘  └───────┘
                  ▼
          ┌───────────────┐
          │  git add -A   │
          └───────┬───────┘
                  │
                  ▼
          ┌───────────────────┐
          │  git commit       │
          └───────┬───────────┘
                  │
                  ▼
          ┌───────────────────┐               ┌──────────────────┐
          │ git pull --rebase ├──── Err ─────►│   Sync paused /  │
          └───────┬───────────┘               │ retry next cycle │
                 OK                           └──────────────────┘
                  │
                  ▼
          ┌──────────────────┐               ┌──────────────────┐
          │  git push        ├─ Net error ──►│   Log warning,   │
          └───────┬──────────┘               │ retry next cycle │
                 OK                          └──────────────────┘
                  │
                  ▼
            ┌──────────┐
            │   Done   │
            └──────────┘
```

**Conflict handling:** When a rebase conflict occurs, syncthis handles it according to the `onConflict` setting. See [Conflict Strategies](./Conflict-Strategies.md).

**Offline support:** If the network is unavailable, the local commit succeeds. Pull and push failures are logged as warnings and retried on the next cycle.

**Single instance:** A `.syncthis.lock` file prevents multiple instances from running against the same directory. Stale locks (left by a crash) are detected automatically by checking the recorded PID.

---

## Service lifecycle

When using `syncthis start`, the OS manages the sync process:

- **macOS:** Registered as a launchd LaunchAgent (`~/Library/LaunchAgents/`). Runs `syncthis start --foreground` internally — launchd handles daemonization.
- **Linux:** Registered as a systemd user unit (`~/.config/systemd/user/`). Uses `systemctl --user` for management.

- **Windows:** Registered as a per-user Task Scheduler task in the `\SyncThis\` folder (no admin rights). The task launches the stable shim `%USERPROFILE%\.syncthis\bin\syncthis.cmd` in a hidden window and redirects output to `task-stdout.log` / `task-stderr.log`. Running/stopped state comes from the `.syncthis.lock` PID, so it doesn't depend on localized `schtasks` output.

On macOS and Linux the OS auto-restarts the service on unexpected exits (crash, rebase conflict after manual resolution). Graceful stops via `syncthis stop` or `SIGTERM` are not restarted.

> **Windows note:** Task Scheduler does not restart crashed services. A crashed service shows as `unhealthy` and can be restarted with `syncthis start` (or one click in the desktop app). Tasks run only while you are logged on.

### Stopping

On macOS and Linux, `syncthis stop` sends `SIGTERM` and the service shuts down gracefully (stops the scheduler, releases the lock). Windows has no catchable termination signal (`schtasks /end` and `process.kill` terminate immediately, which could leave `.git/index.lock` behind or an unfinished rebase), so `syncthis stop` writes `.syncthis/stop-request` instead. The service polls for it and runs the same graceful shutdown. If the process is still alive after about 15 seconds, it is force-ended together with its child processes.

### Git and Node

The desktop app bundles Node.js and, on Windows, a trimmed Git (a system Git is preferred when installed). Services reach them through the stable shim, so nothing depends on versioned install paths. CLI-only (npm) users need Node.js ≥ 20 and Git on their `PATH`.

> **Linux note:** For the service to keep running after logout, user lingering must be enabled: `loginctl enable-linger $USER` (may require sudo). syncthis warns you if this isn't configured.
