import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGit = vi.hoisted(() => ({ raw: vi.fn() }));
vi.mock('simple-git', () => ({ default: vi.fn(() => mockGit) }));

import { ensureLongPaths } from '../../src/git-config.js';

describe('ensureLongPaths', () => {
  beforeEach(() => {
    mockGit.raw.mockReset();
  });

  it('does nothing on non-Windows platforms', async () => {
    await ensureLongPaths('/repo', 'linux');
    expect(mockGit.raw).not.toHaveBeenCalled();
  });

  it('sets core.longpaths when it is not set', async () => {
    mockGit.raw.mockResolvedValueOnce('').mockResolvedValueOnce('');
    await ensureLongPaths('C:/repo', 'win32');
    expect(mockGit.raw).toHaveBeenNthCalledWith(1, [
      'config',
      '--local',
      '--get',
      'core.longpaths',
    ]);
    expect(mockGit.raw).toHaveBeenNthCalledWith(2, ['config', '--local', 'core.longpaths', 'true']);
  });

  it('is idempotent when already true', async () => {
    mockGit.raw.mockResolvedValueOnce('true\n');
    await ensureLongPaths('C:/repo', 'win32');
    expect(mockGit.raw).toHaveBeenCalledTimes(1);
  });

  it('sets it when git config --get exits non-zero (unset)', async () => {
    mockGit.raw.mockRejectedValueOnce(new Error('exit 1')).mockResolvedValueOnce('');
    await ensureLongPaths('C:/repo', 'win32');
    expect(mockGit.raw).toHaveBeenCalledTimes(2);
  });

  it('is non-fatal when git fails', async () => {
    mockGit.raw.mockRejectedValue(new Error('boom'));
    await expect(ensureLongPaths('C:/repo', 'win32')).resolves.toBeUndefined();
  });
});
