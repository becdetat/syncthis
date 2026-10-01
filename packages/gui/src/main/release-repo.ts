/** Upstream repository used when no build-time override is injected. */
export const DEFAULT_RELEASE_REPO = 'mischah/syncthis';

/**
 * The `owner/name` GitHub repository that publishes releases for this build.
 * `SYNCTHIS_RELEASE_REPO` is injected at build time via `vite.main.config.ts`.
 */
export function getReleaseRepo(): string {
  return process.env.SYNCTHIS_RELEASE_REPO || DEFAULT_RELEASE_REPO;
}

export function updateFeedUrl(
  repo: string,
  platform: string,
  arch: string,
  currentVersion: string,
): string {
  return `https://update.electronjs.org/${repo}/${platform}-${arch}/${currentVersion}`;
}

export function releaseApiUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export function releasePageUrl(repo: string, version: string): string {
  return `https://github.com/${repo}/releases/tag/v${version}`;
}
