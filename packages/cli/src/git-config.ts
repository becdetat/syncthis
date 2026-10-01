import simpleGit from 'simple-git';

/** Windows only: enable repo-local core.longpaths (idempotent, non-fatal). */
export async function ensureLongPaths(
  dirPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') return;
  try {
    const git = simpleGit(dirPath);
    const current = await git.raw(['config', '--local', '--get', 'core.longpaths']).catch(() => '');
    if (current.trim() === 'true') return;
    await git.raw(['config', '--local', 'core.longpaths', 'true']);
  } catch {
    // Best effort: a failure here must not block init or the service.
  }
}
