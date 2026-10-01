import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExeca = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));
vi.mock('execa', () => ({ execa: mockExeca }));

const mockIsLocked = vi.hoisted(() => vi.fn().mockResolvedValue({ locked: false }));
vi.mock('../../src/lock.js', () => ({ isLocked: mockIsLocked }));

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  mkdtemp: vi.fn().mockResolvedValue('C:\\tmp\\syncthis-task-x'),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildTaskAction,
  escapeXml,
  generateTaskXml,
  parseTaskXml,
  quoteArg,
  WindowsTaskPlatform,
  withAutostart,
} from '../../src/daemon/windows-task.js';

const LAUNCHER_CONFIG = {
  serviceName: 'com.syncthis.notes',
  dirPath: String.raw`D:\My Notes`,
  nodeBinDir: String.raw`C:\Users\Jane Doe\AppData\Local\syncthis\bin`,
  syncthisBinary: String.raw`C:\Users\Jane Doe\AppData\Local\syncthis\bin\syncthis.cmd`,
  cron: '*/5 * * * *',
};

const NPM_CONFIG = {
  serviceName: 'com.syncthis.notes',
  dirPath: String.raw`D:\notes`,
  nodeBinDir: String.raw`C:\Program Files\nodejs`,
  syncthisBinary: String.raw`C:\Users\me\AppData\Roaming\npm\node_modules\syncthis\dist\cli.js`,
  interval: 300,
};

const USER = String.raw`DESKTOP\jane`;

describe('quoteArg', () => {
  it('leaves simple arguments alone', () => {
    expect(quoteArg('--path')).toBe('--path');
  });

  it('quotes arguments with spaces, ampersands and empty strings', () => {
    expect(quoteArg('My Notes')).toBe('"My Notes"');
    expect(quoteArg('a&b')).toBe('"a&b"');
    expect(quoteArg('')).toBe('""');
  });

  it('leaves non-ASCII alone', () => {
    expect(quoteArg('Zoë')).toBe('Zoë');
  });
});

describe('buildTaskAction', () => {
  it('uses conhost + cmd with the relative shim and logs to task-stdout.log (launcher)', () => {
    const action = buildTaskAction(LAUNCHER_CONFIG);
    expect(action.command).toBe('conhost.exe');
    expect(action.workingDirectory).toBe(String.raw`C:\Users\Jane Doe\AppData\Local\syncthis\bin`);
    expect(action.arguments).toBe(
      '--headless cmd.exe /d /c syncthis.cmd start --foreground --path "D:\\My Notes" --cron "*/5 * * * *"' +
        ' >> "D:\\My Notes\\.syncthis\\logs\\task-stdout.log" 2>&1',
    );
  });

  it('uses the direct quoted node form without redirection (npm CLI)', () => {
    const action = buildTaskAction(NPM_CONFIG);
    expect(action.workingDirectory).toBeUndefined();
    expect(action.arguments).toBe(
      '--headless "C:\\Program Files\\nodejs\\node.exe"' +
        ' "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\syncthis\\dist\\cli.js"' +
        ' start --foreground --path D:\\notes --interval 300',
    );
  });

  it('quotes paths containing & and non-ASCII characters', () => {
    const action = buildTaskAction({ ...NPM_CONFIG, dirPath: String.raw`D:\Zoë & Co\notes` });
    expect(action.arguments).toContain('--path "D:\\Zoë & Co\\notes"');
  });

  it('passes log level and a non-default conflict strategy', () => {
    const action = buildTaskAction({ ...NPM_CONFIG, logLevel: 'debug', onConflict: 'stop' });
    expect(action.arguments).toContain('--log-level debug --on-conflict stop');
    const dflt = buildTaskAction({ ...NPM_CONFIG, onConflict: 'auto-both' });
    expect(dflt.arguments).not.toContain('--on-conflict');
  });
});

describe('generateTaskXml', () => {
  it('matches the golden XML without autostart (launcher)', () => {
    expect(
      generateTaskXml(LAUNCHER_CONFIG, { autostart: false, user: USER }),
    ).toBe(`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>syncthis sync daemon for D:\\My Notes</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>DESKTOP\\jane</UserId>
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
      <Command>conhost.exe</Command>
      <Arguments>--headless cmd.exe /d /c syncthis.cmd start --foreground --path &quot;D:\\My Notes&quot; --cron &quot;*/5 * * * *&quot; &gt;&gt; &quot;D:\\My Notes\\.syncthis\\logs\\task-stdout.log&quot; 2&gt;&amp;1</Arguments>
      <WorkingDirectory>C:\\Users\\Jane Doe\\AppData\\Local\\syncthis\\bin</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`);
  });

  it('has a LogonTrigger for the current user iff autostart', () => {
    const on = generateTaskXml(NPM_CONFIG, { autostart: true, user: USER });
    expect(on).toContain('<LogonTrigger>');
    expect(on).toContain('<UserId>DESKTOP\\jane</UserId>\n    </LogonTrigger>');
    expect(on.indexOf('<Triggers>')).toBeLessThan(on.indexOf('<Principals>'));
    expect(generateTaskXml(NPM_CONFIG, { autostart: false, user: USER })).not.toContain('Trigger');
  });

  it('never configures RestartOnFailure', () => {
    expect(generateTaskXml(NPM_CONFIG, { autostart: true, user: USER })).not.toContain(
      'RestartOnFailure',
    );
  });

  it('XML-escapes paths and the user', () => {
    const xml = generateTaskXml(
      { ...NPM_CONFIG, dirPath: String.raw`D:\A & B\<x>` },
      { autostart: true, user: 'A&B\\o<>' },
    );
    expect(xml).toContain('A&amp;B\\o&lt;&gt;');
    expect(xml).not.toContain('A & B');
    expect(xml).toContain('D:\\A &amp; B\\&lt;x&gt;');
  });

  it('keeps non-ASCII characters intact', () => {
    const xml = generateTaskXml(
      { ...NPM_CONFIG, dirPath: String.raw`D:\Zoë\notes` },
      { autostart: false, user: USER },
    );
    expect(xml).toContain('Zoë');
  });
});

describe('parseTaskXml', () => {
  it('round-trips path, schedule and autostart from generated XML', () => {
    const xml = generateTaskXml(LAUNCHER_CONFIG, { autostart: true, user: USER });
    expect(parseTaskXml(xml)).toEqual({
      dirPath: String.raw`D:\My Notes`,
      schedule: '*/5 * * * *',
      autostart: true,
    });
  });

  it('reads an interval schedule and no autostart', () => {
    const xml = generateTaskXml(NPM_CONFIG, { autostart: false, user: USER });
    expect(parseTaskXml(xml)).toEqual({
      dirPath: String.raw`D:\notes`,
      schedule: 'every 300s',
      autostart: false,
    });
  });

  it('round-trips paths with & and non-ASCII characters', () => {
    const dirPath = String.raw`D:\Zoë & Co\notes`;
    const xml = generateTaskXml({ ...NPM_CONFIG, dirPath }, { autostart: false, user: USER });
    expect(parseTaskXml(xml).dirPath).toBe(dirPath);
  });

  it('handles an empty XML document', () => {
    expect(parseTaskXml('')).toEqual({ dirPath: '', schedule: '', autostart: false });
  });
});

describe('withAutostart', () => {
  const base = generateTaskXml(NPM_CONFIG, { autostart: false, user: USER });
  const enabled = generateTaskXml(NPM_CONFIG, { autostart: true, user: USER });

  it('adds a LogonTrigger using the principal user', () => {
    expect(withAutostart(base, true, 'other')).toBe(enabled);
  });

  it('removes the Triggers block', () => {
    expect(withAutostart(enabled, false, 'other')).toBe(base);
  });

  it('removes an empty <Triggers /> element and is idempotent when enabling', () => {
    const empty = base.replace('  <Principals>', '  <Triggers />\n  <Principals>');
    expect(withAutostart(empty, false, 'other')).toBe(base);
    expect(withAutostart(enabled, true, 'other')).toBe(enabled);
  });
});

describe('WindowsTaskPlatform', () => {
  let platform: WindowsTaskPlatform;
  const taskXml = generateTaskXml(NPM_CONFIG, { autostart: true, user: USER });

  beforeEach(() => {
    vi.clearAllMocks();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' });
    mockIsLocked.mockResolvedValue({ locked: false });
    platform = new WindowsTaskPlatform();
  });

  it('install creates the task from a UTF-16 XML file with /f', async () => {
    await platform.install(NPM_CONFIG);
    const [file, content, encoding] = mockWriteFile.mock.calls[0];
    expect(String(file)).toMatch(/com\.syncthis\.notes\.xml$/);
    expect(content.startsWith('\uFEFF<?xml')).toBe(true);
    expect(encoding).toBe('utf16le');
    const [cmd, args] = mockExeca.mock.calls[0];
    expect(cmd).toBe('schtasks');
    expect(args.slice(0, 3)).toEqual(['/create', '/tn', '\\SyncThis\\com.syncthis.notes']);
    expect(args.slice(-2)[1]).toBe('/f');
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it('install creates the logs folder when started by the launcher', async () => {
    await platform.install(LAUNCHER_CONFIG);
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
  });

  it('uninstall and start call schtasks', async () => {
    await platform.uninstall('com.syncthis.notes');
    await platform.start('com.syncthis.notes');
    expect(mockExeca).toHaveBeenNthCalledWith(1, 'schtasks', [
      '/delete',
      '/tn',
      '\\SyncThis\\com.syncthis.notes',
      '/f',
    ]);
    expect(mockExeca).toHaveBeenNthCalledWith(2, 'schtasks', [
      '/run',
      '/tn',
      '\\SyncThis\\com.syncthis.notes',
    ]);
  });

  describe('status', () => {
    it('is not-installed when the query fails', async () => {
      mockExeca.mockRejectedValue(new Error('ERROR: The system cannot find the file specified.'));
      expect(await platform.status('com.syncthis.notes')).toEqual({ state: 'not-installed' });
    });

    it('is running with the lock PID when the lock is live', async () => {
      mockExeca.mockResolvedValue({ stdout: taskXml });
      mockIsLocked.mockResolvedValue({ locked: true, pid: 4242 });
      expect(await platform.status('com.syncthis.notes')).toEqual({ state: 'running', pid: 4242 });
      expect(mockIsLocked).toHaveBeenCalledWith(String.raw`D:\notes`);
    });

    it('is stopped when there is no live lock', async () => {
      mockExeca.mockResolvedValue({ stdout: taskXml });
      expect(await platform.status('com.syncthis.notes')).toEqual({ state: 'stopped' });
    });
  });

  describe('listAll', () => {
    it('returns [] when the task folder does not exist', async () => {
      mockExeca.mockRejectedValue(new Error('not found'));
      expect(await platform.listAll()).toEqual([]);
    });

    it('lists SyncThis tasks with path, schedule, autostart and state', async () => {
      mockExeca.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('csv')) {
          return {
            stdout:
              '"\\SyncThis\\com.syncthis.notes","N/A","Ready"\r\n' +
              '"\\SyncThis\\com.syncthis.notes","N/A","Ready"\r\n' +
              '"\\SyncThis\\other-task","N/A","Ready"\r\n',
          };
        }
        return { stdout: taskXml };
      });
      mockIsLocked.mockResolvedValue({ locked: true, pid: 7 });

      expect(await platform.listAll()).toEqual([
        {
          serviceName: 'com.syncthis.notes',
          label: 'notes',
          dirPath: String.raw`D:\notes`,
          state: 'running',
          pid: 7,
          autostart: true,
          schedule: 'every 300s',
        },
      ]);
      expect(mockExeca).toHaveBeenCalledWith('schtasks', [
        '/query',
        '/tn',
        '\\SyncThis\\',
        '/fo',
        'csv',
        '/nh',
      ]);
    });
  });

  describe('autostart', () => {
    it('isAutostartEnabled reflects the LogonTrigger and is false when not installed', async () => {
      mockExeca.mockResolvedValue({ stdout: taskXml });
      expect(await platform.isAutostartEnabled('com.syncthis.notes')).toBe(true);
      mockExeca.mockRejectedValue(new Error('missing'));
      expect(await platform.isAutostartEnabled('com.syncthis.notes')).toBe(false);
    });

    it('disableAutostart re-creates the task without Triggers', async () => {
      mockExeca.mockResolvedValue({ stdout: taskXml });
      await platform.disableAutostart('com.syncthis.notes');
      const written = mockWriteFile.mock.calls[0][1] as string;
      expect(written).not.toContain('<Triggers>');
      expect(mockExeca).toHaveBeenLastCalledWith(
        'schtasks',
        expect.arrayContaining(['/create', '/f']),
      );
    });

    it('enableAutostart re-creates the task with a LogonTrigger', async () => {
      mockExeca.mockResolvedValue({
        stdout: generateTaskXml(NPM_CONFIG, { autostart: false, user: USER }),
      });
      await platform.enableAutostart('com.syncthis.notes');
      expect(mockWriteFile.mock.calls[0][1] as string).toContain('<LogonTrigger>');
    });
  });
});

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});
