import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { sign } from '@electron/windows-sign';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel, type MakerSquirrelConfig } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { getReleaseRepo } from './src/main/release-repo';

// Must end in `git` so it lands at resources/git.
const STAGED_GIT_DIR = '.staging/git';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const isWindows = process.platform === 'win32';

// Staged next to the app as resources/node.exe (the daemon runs the CLI with it).
// Runner's Node, copied as-is: its OpenJS signature must stay intact.
function nodeExeResources(): string[] {
  if (!isWindows) return [];
  try {
    const status = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(Get-AuthenticodeSignature -LiteralPath $env:NODE_EXE).Status.ToString()',
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_EXE: process.execPath } },
    ).trim();
    if (status !== 'Valid') {
      console.warn(`node.exe Authenticode signature is "${status}", expected "Valid".`);
    }
  } catch (error) {
    console.warn(`Could not verify the node.exe signature: ${error}`);
  }
  return [process.execPath];
}

// Third-party binaries keep their vendor signature and are never re-signed.
const isThirdPartyBinary = (file: string) => /[\\/]resources[\\/](node\.exe$|git[\\/])/i.test(file);

const windowsSign: NonNullable<ForgeConfig['packagerConfig']>['windowsSign'] = (() => {
  if (!isWindows) return undefined;
  if (!process.env.WINDOWS_CERTIFICATE_FILE) {
    console.log('Windows signing disabled');
    return undefined;
  }
  return {
    hookFunction: async (file: string) => {
      if (isThirdPartyBinary(file)) return;
      await sign({ files: [file] });
    },
  };
})();

const config: ForgeConfig = {
  packagerConfig: {
    name: 'SyncThis',
    executableName: 'SyncThis',
    appBundleId: 'com.syncthis.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: './resources/icon',
    extraResource: [
      'resources/tray',
      'resources/icon.ico',
      '../cli/dist',
      // Trimmed git from scripts/stage-git.mjs; only Windows has no system git to lean on.
      ...(isWindows ? [STAGED_GIT_DIR] : []),
      ...nodeExeResources(),
    ],
    windowsSign,
    osxSign: process.env.APPLE_TEAM_ID ? {} : undefined,
    osxNotarize: process.env.APPLE_API_KEY_PATH
      ? {
          appleApiKey: process.env.APPLE_API_KEY_PATH,
          appleApiKeyId: process.env.APPLE_API_KEY_ID ?? '',
          appleApiIssuer: process.env.APPLE_API_KEY_ISSUER ?? '',
        }
      : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG(
      {
        name: `SyncThis-${version}-mac`,
        icon: './resources/icon.icns',
        background: './resources/dmg/dmg-background.png',
        iconSize: 80,
        contents: (opts) => [
          { x: 190, y: 180, type: 'file', path: opts.appPath },
          { x: 470, y: 180, type: 'link', path: '/Applications' },
        ],
        additionalDMGOptions: {
          window: { size: { width: 660, height: 400 } },
        },
      },
      ['darwin'],
    ),
    // The `-win32-x64` token in the setup name is what update.electronjs.org matches.
    // Leave `-full.nupkg` and `RELEASES` named as built: RELEASES references the nupkg name.
    new MakerSquirrel(
      {
        name: 'SyncThis',
        authors: 'SyncThis',
        description: 'Desktop GUI for syncthis',
        setupIcon: './resources/icon.ico',
        setupExe: `SyncThis-${version}-win32-x64-setup.exe`,
        noMsi: true,
        iconUrl: `https://raw.githubusercontent.com/${getReleaseRepo()}/HEAD/packages/gui/resources/icon.ico`,
        windowsSign: windowsSign as MakerSquirrelConfig['windowsSign'],
      },
      ['win32'],
    ),
    new MakerZIP({}, ['darwin']),
    new MakerDeb({ options: { bin: 'SyncThis' } }, ['linux']),
  ],
  hooks: {
    postMake: async (_config, results) => {
      for (const result of results) {
        for (let i = 0; i < result.artifacts.length; i++) {
          const oldPath = result.artifacts[i];
          if (oldPath.endsWith('.deb')) {
            const newPath = join(dirname(oldPath), `SyncThis-${version}-linux.deb`);
            renameSync(oldPath, newPath);
            result.artifacts[i] = newPath;
          }
        }
      }
      return results;
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'dashboard',
          config: 'vite.renderer.config.ts',
        },
        {
          name: 'popover',
          config: 'vite.popover.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
