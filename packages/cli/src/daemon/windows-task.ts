import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execa } from 'execa';
import { isLocked } from '../lock.js';
import { type StopOptions, stopLockedProcess } from '../stop-request.js';
import type { DaemonConfig, DaemonInfo, DaemonPlatform, DaemonStatus } from './platform.js';

const DEFAULT_TASK_FOLDER = '\\SyncThis';
const SERVICE_PREFIX = 'com.syncthis.';

export interface TaskAction {
  command: string;
  arguments: string;
  workingDirectory?: string;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

/** Quote an argument for a cmd.exe / CreateProcess command line when it needs it. */
export function quoteArg(arg: string): string {
  if (arg !== '' && !/[\s"&|<>^%()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildSyncthisArgs(config: DaemonConfig): string[] {
  const args = ['start', '--foreground', '--path', config.dirPath];
  if (config.cron !== undefined) {
    args.push('--cron', config.cron);
  } else if (config.interval !== undefined) {
    args.push('--interval', String(config.interval));
  }
  if (config.logLevel !== undefined) {
    args.push('--log-level', config.logLevel);
  }
  if (config.onConflict !== undefined && config.onConflict !== 'auto-both') {
    args.push('--on-conflict', config.onConflict);
  }
  return args.map(quoteArg);
}

/** The GUI's launcher is a .cmd shim; an npm-installed CLI is a plain cli.js run through node. */
export function isLauncherShim(syncthisBinary: string): boolean {
  return /\.(cmd|bat)$/i.test(syncthisBinary);
}

export function buildTaskAction(config: DaemonConfig): TaskAction {
  const args = buildSyncthisArgs(config).join(' ');
  if (isLauncherShim(config.syncthisBinary)) {
    // Relative shim name + WorkingDirectory = shim folder: the nested
    // `cmd /c ""<path with space>\shim.cmd" .."` form fails under conhost --headless.
    const logPath = join(config.dirPath, '.syncthis', 'logs', 'task-stdout.log');
    return {
      command: 'conhost.exe',
      arguments: `--headless cmd.exe /d /c ${basename(config.syncthisBinary)} ${args} >> "${logPath}" 2>&1`,
      workingDirectory: dirname(config.syncthisBinary),
    };
  }
  const nodeExe = join(config.nodeBinDir, 'node.exe');
  return {
    command: 'conhost.exe',
    arguments: `--headless "${nodeExe}" "${config.syncthisBinary}" ${args}`,
  };
}

export function generateTaskXml(
  config: DaemonConfig,
  options: { autostart: boolean; user: string },
): string {
  const action = buildTaskAction(config);
  const user = escapeXml(options.user);
  const triggers = options.autostart ? logonTriggers(user) : '';
  const workingDir =
    action.workingDirectory !== undefined
      ? `<WorkingDirectory>${escapeXml(action.workingDirectory)}</WorkingDirectory>`
      : '';
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${escapeXml(`syncthis sync daemon for ${config.dirPath}`)}</Description>
  </RegistrationInfo>
${triggers}  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(action.command)}</Command>
      <Arguments>${escapeXml(action.arguments)}</Arguments>
      ${workingDir}
    </Exec>
  </Actions>
</Task>
`;
}

function logonTriggers(escapedUser: string): string {
  return `  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${escapedUser}</UserId>
    </LogonTrigger>
  </Triggers>
`;
}

export interface ParsedTask {
  dirPath: string;
  schedule: string;
  autostart: boolean;
}

function extractFlag(args: string, flag: string): string | undefined {
  const match = args.match(new RegExp(`${flag}\\s+(?:"([^"]*)"|(\\S+))`));
  return match ? (match[1] ?? match[2]) : undefined;
}

export function parseTaskXml(xml: string): ParsedTask {
  const argsMatch = xml.match(/<Arguments>([\s\S]*?)<\/Arguments>/);
  const args = argsMatch ? unescapeXml(argsMatch[1]) : '';

  const dirPath = extractFlag(args, '--path') ?? '';
  let schedule = '';
  const cron = extractFlag(args, '--cron');
  const interval = extractFlag(args, '--interval');
  if (cron !== undefined) schedule = cron;
  else if (interval !== undefined && /^\d+$/.test(interval)) schedule = `every ${interval}s`;

  return { dirPath, schedule, autostart: /<LogonTrigger[\s>]/.test(xml) };
}

/** Return the task XML with its Triggers replaced by a LogonTrigger (or none). */
export function withAutostart(xml: string, autostart: boolean, fallbackUser: string): string {
  const stripped = xml.replace(
    /[ \t]*<Triggers\s*\/>\r?\n?|[ \t]*<Triggers>[\s\S]*?<\/Triggers>\r?\n?/g,
    '',
  );
  if (!autostart) return stripped;
  const userMatch = stripped.match(/<Principal[\s\S]*?<UserId>([\s\S]*?)<\/UserId>/);
  const user = userMatch ? userMatch[1] : escapeXml(fallbackUser);
  return stripped.replace(/([ \t]*)<Principals>/, (_, indent: string) => {
    return `${logonTriggers(user)}${indent}<Principals>`;
  });
}

function currentUser(): string {
  const { username } = userInfo();
  const domain = process.env.USERDOMAIN;
  return domain ? `${domain}\\${username}` : username;
}

export class WindowsTaskPlatform implements DaemonPlatform {
  constructor(
    private readonly taskFolder: string = DEFAULT_TASK_FOLDER,
    private readonly stopOptions: StopOptions = {},
  ) {}

  private taskName(serviceName: string): string {
    return `${this.taskFolder}\\${serviceName}`;
  }

  private async queryXml(serviceName: string): Promise<string> {
    // schtasks writes the console codepage, which garbles non-ASCII paths; switch to UTF-8 first.
    const { stdout } = await execa(
      'cmd',
      [
        '/d',
        '/s',
        '/c',
        `chcp 65001>nul && schtasks /query /tn "${this.taskName(serviceName)}" /xml`,
      ],
      { windowsVerbatimArguments: true },
    );
    return stdout;
  }

  private async createFromXml(serviceName: string, xml: string): Promise<void> {
    const tmp = await mkdtemp(join(tmpdir(), 'syncthis-task-'));
    try {
      const xmlPath = join(tmp, `${serviceName}.xml`);
      // schtasks wants UTF-16 LE with a BOM
      await writeFile(xmlPath, `﻿${xml}`, 'utf16le');
      await execa('schtasks', [
        '/create',
        '/tn',
        this.taskName(serviceName),
        '/xml',
        xmlPath,
        '/f',
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async install(config: DaemonConfig): Promise<void> {
    if (isLauncherShim(config.syncthisBinary)) {
      await mkdir(join(config.dirPath, '.syncthis', 'logs'), { recursive: true });
    }
    const xml = generateTaskXml(config, { autostart: false, user: currentUser() });
    await this.createFromXml(config.serviceName, xml);
  }

  async uninstall(serviceName: string): Promise<void> {
    await execa('schtasks', ['/delete', '/tn', this.taskName(serviceName), '/f']);
  }

  async start(serviceName: string): Promise<void> {
    await execa('schtasks', ['/run', '/tn', this.taskName(serviceName)]);
  }

  async stop(serviceName: string): Promise<void> {
    // schtasks /end is a hard TerminateProcess of the task's root process only, leaving node.exe
    // orphaned, so ask the process to stop itself first and kill its tree only as a fallback.
    let dirPath = '';
    try {
      dirPath = parseTaskXml(await this.queryXml(serviceName)).dirPath;
    } catch {
      // task XML not readable: nothing to stop cooperatively
    }
    if (dirPath !== '') await stopLockedProcess(dirPath, this.stopOptions);
    try {
      await execa('schtasks', ['/end', '/tn', this.taskName(serviceName)]);
    } catch {
      // task not running: state already settled
    }
  }

  async status(serviceName: string): Promise<DaemonStatus> {
    let xml: string;
    try {
      xml = await this.queryXml(serviceName);
    } catch {
      return { state: 'not-installed' };
    }
    const { dirPath } = parseTaskXml(xml);
    if (dirPath === '') return { state: 'stopped' };
    const lock = await isLocked(dirPath);
    return lock.locked ? { state: 'running', pid: lock.pid } : { state: 'stopped' };
  }

  async listAll(): Promise<DaemonInfo[]> {
    let stdout: string;
    try {
      ({ stdout } = await execa('schtasks', [
        '/query',
        '/tn',
        `${this.taskFolder}\\`,
        '/fo',
        'csv',
        '/nh',
      ]));
    } catch {
      return [];
    }

    const prefix = `${this.taskFolder}\\${SERVICE_PREFIX}`.toLowerCase();
    const names = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const name = line.match(/^"([^"]*)"/)?.[1];
      if (name?.toLowerCase().startsWith(prefix)) names.add(name.slice(this.taskFolder.length + 1));
    }

    const results: DaemonInfo[] = [];
    for (const serviceName of names) {
      let parsed: ParsedTask = { dirPath: '', schedule: '', autostart: false };
      try {
        parsed = parseTaskXml(await this.queryXml(serviceName));
      } catch {
        // task XML not readable
      }
      const lock = parsed.dirPath ? await isLocked(parsed.dirPath) : { locked: false };
      results.push({
        serviceName,
        label: serviceName.slice(SERVICE_PREFIX.length),
        dirPath: parsed.dirPath,
        state: lock.locked ? 'running' : 'stopped',
        pid: lock.pid,
        autostart: parsed.autostart,
        schedule: parsed.schedule,
      });
    }
    return results;
  }

  private async setAutostart(serviceName: string, autostart: boolean): Promise<void> {
    const xml = await this.queryXml(serviceName);
    await this.createFromXml(serviceName, withAutostart(xml, autostart, currentUser()));
  }

  async enableAutostart(serviceName: string): Promise<void> {
    await this.setAutostart(serviceName, true);
  }

  async disableAutostart(serviceName: string): Promise<void> {
    await this.setAutostart(serviceName, false);
  }

  async isAutostartEnabled(serviceName: string): Promise<boolean> {
    try {
      return parseTaskXml(await this.queryXml(serviceName)).autostart;
    } catch {
      return false;
    }
  }
}
