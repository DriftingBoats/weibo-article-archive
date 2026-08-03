export const UPDATE_MANIFEST_URL =
  'https://driftingboats.github.io/weibo-article-archive/extension-version.json';

function versionParts(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('更新信息中的版本号格式不正确。');
  }
  return version.split('.').map(Number);
}

export function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

function trustedReleaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith('/DriftingBoats/weibo-article-archive/releases/')
    );
  } catch {
    return false;
  }
}

export function normalizeUpdateManifest(payload) {
  const version = String(payload?.version || '').trim().replace(/^v/i, '');
  versionParts(version);
  if (!trustedReleaseUrl(payload?.downloadUrl)) {
    throw new Error('更新信息中的下载地址不受信任。');
  }
  return {
    version,
    downloadUrl: String(payload.downloadUrl),
    releaseUrl: trustedReleaseUrl(payload.releaseUrl)
      ? String(payload.releaseUrl)
      : 'https://github.com/DriftingBoats/weibo-article-archive/releases/latest'
  };
}

export async function checkForUpdate(
  currentVersion,
  {
    fetchImpl = fetch,
    manifestUrl = UPDATE_MANIFEST_URL
  } = {}
) {
  versionParts(currentVersion);
  const response = await fetchImpl(manifestUrl, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`更新服务返回 HTTP ${response.status}。`);
  }
  const latest = normalizeUpdateManifest(await response.json());
  return {
    currentVersion: String(currentVersion).replace(/^v/i, ''),
    latestVersion: latest.version,
    updateAvailable: compareVersions(currentVersion, latest.version) < 0,
    downloadUrl: latest.downloadUrl,
    releaseUrl: latest.releaseUrl
  };
}
