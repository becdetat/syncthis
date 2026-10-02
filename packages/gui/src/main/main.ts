import { app, Menu } from 'electron';
import { loadAppSettings } from './app-settings.js';
import { ensureCliBundled } from './cli-bundler.js';
import { findBundledGitDir, initGitProvider } from './git-provider.js';
import { readRegistry, registerIpcHandlers, startHealthPolling } from './ipc.js';
import {
  handleSquirrelEvent,
  loginItemSettings,
  parseSquirrelEvent,
  SQUIRREL_APP_USER_MODEL_ID,
  setSquirrelUninstallHook,
  shouldDelayUpdateCheck,
} from './squirrel.js';
import { createTray } from './tray.js';
import { startUpdateChecker } from './updater.js';
import { hideDashboard, openDashboard } from './windows.js';
import { windowsUninstallCleanup } from './windows-uninstall.js';

const _startupTimestamp = Date.now();

// Squirrel lifecycle events must be handled before anything else starts, otherwise
// the installer/updater launches extra copies of the app.
setSquirrelUninstallHook(windowsUninstallCleanup);
const squirrelEvent = process.platform === 'win32' ? parseSquirrelEvent(process.argv) : null;
const squirrelExit: Promise<boolean> =
  process.platform === 'win32'
    ? handleSquirrelEvent(process.argv, process.execPath).then((exit) => {
        if (exit) app.quit();
        return exit;
      })
    : Promise.resolve(false);

if (process.platform === 'win32') {
  app.setAppUserModelId(SQUIRREL_APP_USER_MODEL_ID);
}

// A second launch (e.g. from a Squirrel shortcut) must not create a second tray icon.
// Lifecycle events that exit straight away must not contend for the lock.
const isExitingSquirrelEvent = squirrelEvent !== null && squirrelEvent !== 'firstrun';
const gotSingleInstanceLock =
  process.platform !== 'win32' || isExitingSquirrelEvent || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openDashboard();
  });
}

app.on('ready', async () => {
  if (!gotSingleInstanceLock) return;
  if (await squirrelExit) return;
  console.log(`[startup] app ready at +${Date.now() - _startupTimestamp}ms`);

  if (process.platform === 'darwin') {
    app.dock.hide();

    // Override Cmd+Q: hide dashboard instead of quitting.
    // Actual quit is only available via tray context menu → Quit.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            {
              label: 'Quit',
              accelerator: 'CmdOrCtrl+Q',
              click: () => hideDashboard(),
            },
          ],
        },
        { role: 'editMenu' },
      ]),
    );
  }

  if (process.platform === 'win32') {
    // No menu bar; text-field editing shortcuts still work without one.
    Menu.setApplicationMenu(null);
  }

  try {
    await initGitProvider(findBundledGitDir(process.resourcesPath, app.getAppPath()));
  } catch (err) {
    console.error('Failed to initialize git provider:', err);
  }

  try {
    await ensureCliBundled();
  } catch (err) {
    console.error('Failed to bundle CLI:', err);
  }

  registerIpcHandlers();
  startHealthPolling();
  startUpdateChecker(app.getVersion(), shouldDelayUpdateCheck(process.argv));

  try {
    createTray();
    console.log(`[startup] tray created at +${Date.now() - _startupTimestamp}ms`);
  } catch (err) {
    console.warn('Tray creation failed (expected on some Linux DEs without AppIndicator):', err);
  }

  const settings = await loadAppSettings();
  app.setLoginItemSettings(
    loginItemSettings(settings.launchOnLogin, process.platform, app.isPackaged, process.execPath),
  );

  // Open dashboard on first launch (no folders registered yet)
  const folders = await readRegistry();
  if (folders.length === 0) {
    openDashboard();
  }
});

app.on('window-all-closed', () => {
  // App lives in the tray — don't quit when all windows close
});

app.on('activate', () => {
  // macOS: open dashboard if dock icon is clicked (e.g., visible during setup)
  openDashboard();
});
