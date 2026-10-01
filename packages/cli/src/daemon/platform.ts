import { dirname, resolve } from 'node:path';
import { LaunchdPlatform } from './launchd.js';
import { SystemdPlatform } from './systemd.js';

export interface DaemonStatus {
  state: 'running' | 'stopped' | 'not-installed';
  pid?: number;
}

export interface DaemonInfo {
  serviceName: string;
  label: string;
  dirPath: string;
  state: 'running' | 'stopped';
  pid?: number;
  autostart: boolean;
  schedule: string;
}

export interface DaemonConfig {
  serviceName: string;
  dirPath: string;
  nodeBinDir: string;
  syncthisBinary: string;
  cron?: string;
  interval?: number;
  logLevel?: string;
  onConflict?: string;
  gitBinDir?: string;
}

export interface DaemonPlatform {
  install(config: DaemonConfig): Promise<void>;
  uninstall(serviceName: string): Promise<void>;
  start(serviceName: string): Promise<void>;
  stop(serviceName: string): Promise<void>;
  status(serviceName: string): Promise<DaemonStatus>;
  listAll(): Promise<DaemonInfo[]>;
  enableAutostart(serviceName: string): Promise<void>;
  disableAutostart(serviceName: string): Promise<void>;
  isAutostartEnabled(serviceName: string): Promise<boolean>;
}

export function getPlatform(): DaemonPlatform {
  switch (process.platform) {
    case 'darwin':
      return new LaunchdPlatform();
    case 'linux':
      return new SystemdPlatform();
    default:
      throw new Error(
        `Daemon mode is not supported on ${process.platform}. Use 'syncthis start' instead.`,
      );
  }
}

/**
 * The GUI's stable launcher shim sets SYNCTHIS_LAUNCHER so services register
 * it rather than a versioned install path or process.execPath.
 */
export function getSyncthisBinary(): string {
  return process.env.SYNCTHIS_LAUNCHER || resolve(process.argv[1]);
}

export function getNodeBinDir(): string {
  const launcher = process.env.SYNCTHIS_LAUNCHER;
  return launcher ? dirname(launcher) : dirname(process.execPath);
}
