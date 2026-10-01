import { describe, expect, it } from 'vitest';
import { parseTaskbarTheme } from '../../src/main/taskbar-theme.js';

const KEY = String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`;

describe('parseTaskbarTheme', () => {
  it('returns light when SystemUsesLightTheme is 0x1', () => {
    const out = `\r\n${KEY}\r\n    SystemUsesLightTheme    REG_DWORD    0x1\r\n\r\n`;
    expect(parseTaskbarTheme(out)).toBe('light');
  });

  it('returns dark when SystemUsesLightTheme is 0x0', () => {
    const out = `\r\n${KEY}\r\n    SystemUsesLightTheme    REG_DWORD    0x0\r\n\r\n`;
    expect(parseTaskbarTheme(out)).toBe('dark');
  });

  it('ignores AppsUseLightTheme', () => {
    const out = `${KEY}\r\n    AppsUseLightTheme    REG_DWORD    0x1\r\n    SystemUsesLightTheme    REG_DWORD    0x0\r\n`;
    expect(parseTaskbarTheme(out)).toBe('dark');
  });

  it('returns null when the value is absent', () => {
    expect(parseTaskbarTheme(`${KEY}\r\n    AppsUseLightTheme    REG_DWORD    0x1\r\n`)).toBeNull();
  });

  it('returns null for empty or garbage output', () => {
    expect(parseTaskbarTheme('')).toBeNull();
    expect(
      parseTaskbarTheme('ERROR: The system was unable to find the specified registry key'),
    ).toBeNull();
  });
});
