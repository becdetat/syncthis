import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RELEASE_REPO,
  getReleaseRepo,
  releaseApiUrl,
  releasePageUrl,
  updateFeedUrl,
} from '../../src/main/release-repo.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getReleaseRepo', () => {
  it('defaults to the upstream repo when no override is set', () => {
    vi.stubEnv('SYNCTHIS_RELEASE_REPO', '');
    expect(getReleaseRepo()).toBe(DEFAULT_RELEASE_REPO);
    expect(DEFAULT_RELEASE_REPO).toBe('mischah/syncthis');
  });

  it('uses the build-time override when set', () => {
    vi.stubEnv('SYNCTHIS_RELEASE_REPO', 'becdetat/syncthis');
    expect(getReleaseRepo()).toBe('becdetat/syncthis');
  });
});

describe('URL construction', () => {
  it('builds the update.electronjs.org feed URL', () => {
    expect(updateFeedUrl('becdetat/syncthis', 'darwin', 'arm64', '1.2.3')).toBe(
      'https://update.electronjs.org/becdetat/syncthis/darwin-arm64/1.2.3',
    );
  });

  it('builds the GitHub releases API URL', () => {
    expect(releaseApiUrl('becdetat/syncthis')).toBe(
      'https://api.github.com/repos/becdetat/syncthis/releases/latest',
    );
  });

  it('builds the release page URL', () => {
    expect(releasePageUrl('becdetat/syncthis', '1.2.3')).toBe(
      'https://github.com/becdetat/syncthis/releases/tag/v1.2.3',
    );
  });

  it('matches the previous hard-coded URLs for the default repo', () => {
    expect(releaseApiUrl(DEFAULT_RELEASE_REPO)).toBe(
      'https://api.github.com/repos/mischah/syncthis/releases/latest',
    );
  });
});
