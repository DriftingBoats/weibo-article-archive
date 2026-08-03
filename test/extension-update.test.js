import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  compareVersions,
  normalizeUpdateManifest
} from '../extension/update.js';

const manifest = {
  version: '1.4.0',
  downloadUrl: 'https://github.com/DriftingBoats/weibo-article-archive/releases/latest/download/weicun-extension.zip',
  releaseUrl: 'https://github.com/DriftingBoats/weibo-article-archive/releases/latest'
};

describe('extension updates', () => {
  it('compares semantic versions numerically', () => {
    expect(compareVersions('1.3.8', '1.4.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('v1.3.8', '1.3.8')).toBe(0);
  });

  it('rejects update downloads outside the project releases', () => {
    expect(() => normalizeUpdateManifest({
      ...manifest,
      downloadUrl: 'https://example.com/extension.zip'
    })).toThrow('下载地址不受信任');
  });

  it('reports a newer published version', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => manifest
    }));
    const result = await checkForUpdate('1.3.8', { fetchImpl });

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('1.4.0');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('extension-version.json'),
      expect.objectContaining({ cache: 'no-store' })
    );
  });
});
