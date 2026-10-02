import { open, stat } from 'node:fs/promises';

export interface FollowOptions {
  lines: number;
  write: (text: string) => void;
  signal: AbortSignal;
  pollMs?: number;
}

async function readRange(path: string, start: number, end: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Node-native `tail -f`: print the last N lines, then print data appended until aborted. */
export async function followFile(path: string, options: FollowOptions): Promise<void> {
  const { lines, write, signal, pollMs = 500 } = options;

  let position = (await stat(path)).size;
  const existing = await readRange(path, 0, position);
  const tail = existing.split('\n').filter(Boolean).slice(-lines);
  if (tail.length > 0) write(`${tail.join('\n')}\n`);

  while (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    if (signal.aborted) break;
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      continue; // rotated or briefly missing
    }
    if (size < position) position = 0; // truncated
    if (size > position) {
      write(await readRange(path, position, size));
      position = size;
    }
  }
}
