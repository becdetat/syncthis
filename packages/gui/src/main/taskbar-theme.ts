export type TaskbarTheme = 'light' | 'dark';

/**
 * Parse `reg query ... /v SystemUsesLightTheme` output into the taskbar theme.
 * Returns null when the value cannot be found.
 */
export function parseTaskbarTheme(output: string): TaskbarTheme | null {
  const match = output.match(/^\s*SystemUsesLightTheme\s+REG_DWORD\s+(0x[0-9a-fA-F]+)\s*$/m);
  if (!match) return null;
  return Number.parseInt(match[1], 16) === 0 ? 'dark' : 'light';
}
