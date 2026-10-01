// Stops stale dev Electron processes left over from a previous `electron-forge start`.
// Cross-platform replacement for an inline `pkill`, which does not exist on Windows.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function killPosix() {
  // pkill exits 1 when nothing matched; that is not an error here.
  spawnSync('pkill', ['-f', 'syncthis/node_modules/electron'], { stdio: 'ignore' });
}

function killWindows() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const electronDir = path.resolve(here, '..', '..', '..', 'node_modules', 'electron');
  const escaped = electronDir.replaceAll("'", "''");
  const script = [
    `$dir = '${escaped}'`,
    `Get-CimInstance Win32_Process |`,
    `  Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } |`,
    `  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join('\n');
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
  });
}

try {
  if (process.platform === 'win32') {
    killWindows();
  } else {
    killPosix();
  }
} catch {
  // Best effort: never block start/dev.
}
