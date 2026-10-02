import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { followFile } from '../../src/log-follow.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'syncthis-follow-'));
  file = join(dir, 'syncthis.log');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('followFile', () => {
  it('prints the last N lines then appended data', async () => {
    await writeFile(file, 'a\nb\nc\nd\n');
    const out: string[] = [];
    const controller = new AbortController();
    const done = followFile(file, {
      lines: 2,
      write: (t) => out.push(t),
      signal: controller.signal,
      pollMs: 10,
    });
    await sleep(60);
    await appendFile(file, 'e\nf\n');
    await sleep(100);
    controller.abort();
    await done;
    expect(out.join('')).toBe('c\nd\ne\nf\n');
  });

  it('restarts from the beginning after truncation', async () => {
    await writeFile(file, 'long old content\n');
    const out: string[] = [];
    const controller = new AbortController();
    const done = followFile(file, {
      lines: 1,
      write: (t) => out.push(t),
      signal: controller.signal,
      pollMs: 10,
    });
    await sleep(60);
    await writeFile(file, 'new\n');
    await sleep(100);
    controller.abort();
    await done;
    expect(out.join('')).toBe('long old content\nnew\n');
  });

  it('rejects when the file does not exist', async () => {
    await expect(
      followFile(file, { lines: 5, write: () => {}, signal: new AbortController().signal }),
    ).rejects.toThrow();
  });
});
