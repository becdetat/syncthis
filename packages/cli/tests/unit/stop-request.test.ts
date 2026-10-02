import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStopRequest, stopRequestPath, watchStopRequest } from '../../src/stop-request.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'syncthis-stopreq-'));
  await mkdir(join(dir, '.syncthis'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('watchStopRequest', () => {
  it('fires once and removes the request file', async () => {
    const onRequest = vi.fn();
    const dispose = watchStopRequest(dir, onRequest, 10);
    await new Promise((r) => setTimeout(r, 40));
    expect(onRequest).not.toHaveBeenCalled();
    await writeFile(stopRequestPath(dir), 'x');
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    await expect(access(stopRequestPath(dir))).rejects.toThrow();
    dispose();
  });

  it('clearStopRequest is a no-op when no file exists', async () => {
    await expect(clearStopRequest(dir)).resolves.toBeUndefined();
  });
});
