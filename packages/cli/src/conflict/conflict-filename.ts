import path from 'node:path';

// Git-relative paths always use '/', so build the filename with posix semantics.
export function formatTimestampForFilename(date: Date): string {
  return date
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
}

export function generateConflictFilename(
  filePath: string,
  timestamp: Date,
  existsSync: (p: string) => boolean = () => false,
): string {
  const ts = formatTimestampForFilename(timestamp);
  const ext = path.posix.extname(filePath);
  const base = path.posix.basename(filePath, ext);
  const dir = path.posix.dirname(filePath);

  const buildPath = (counter: number): string => {
    const suffix = counter > 0 ? `-${counter}` : '';
    if (ext) {
      return path.posix.join(dir, `${base}.conflict-${ts}${suffix}${ext}`);
    }
    return path.posix.join(dir, `${base}.conflict-${ts}${suffix}`);
  };

  let counter = 0;
  let candidate = buildPath(counter);
  while (existsSync(candidate)) {
    counter++;
    candidate = buildPath(counter);
  }
  return candidate;
}
