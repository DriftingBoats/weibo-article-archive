const PRIMARY_LOGIN_COOKIE_NAMES = new Set([
  'SUB',
  'WBPSESS'
]);

export const WEIBO_SESSION_PROBE_URL = 'https://weibo.com/ajax/config/get_config';

export function shouldImportManualCookies(cookieString, currentSession) {
  return Boolean(String(cookieString || '').trim()) &&
    currentSession?.available === false &&
    currentSession?.verified === true;
}

export function summarizeWeiboCookies(cookies = []) {
  const unique = new Map();
  for (const cookie of cookies) {
    if (!cookie?.name || !cookie?.domain) continue;
    const key = `${cookie.storeId || 'default'}:${cookie.domain}:${cookie.path || '/'}:${cookie.name}`;
    unique.set(key, cookie);
  }
  const values = [...unique.values()];
  const loginCookieCount = values.filter((cookie) => (
    PRIMARY_LOGIN_COOKIE_NAMES.has(cookie.name) && Boolean(cookie.value)
  ) || (
    cookie.name === 'MLOGIN' && cookie.value === '1'
  )).length;
  return {
    available: loginCookieCount > 0,
    cookieCount: values.length,
    loginCookieCount
  };
}

export async function getWeiboSessionStatus(cookiesApi = chrome.cookies) {
  const groups = await Promise.all([
    cookiesApi.getAll({ domain: 'weibo.com' }),
    cookiesApi.getAll({ domain: 'm.weibo.cn' })
  ]);
  return summarizeWeiboCookies(groups.flat());
}

export function interpretWeiboSessionProbe(status, payload = null) {
  if ([401, 403].includes(status)) {
    return { authenticated: false, verified: true };
  }
  if (status < 200 || status >= 300) {
    return { authenticated: false, verified: false };
  }
  if (payload?.ok === -100 || payload?.ok === '-100') {
    return { authenticated: false, verified: true };
  }
  const data = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload || {};
  const nested = data.config && typeof data.config === 'object' ? data.config : {};
  const nestedConfig = nested.config && typeof nested.config === 'object'
    ? nested.config
    : {};
  const login = data.login ?? data.isLogin ?? data.is_login ??
    nested.login ?? nested.isLogin ?? nested.is_login ??
    nestedConfig.login ?? nestedConfig.isLogin ?? nestedConfig.is_login;
  const uid = data.uid ?? data.user?.id ?? data.user?.idstr ??
    nested.uid ?? nested.user?.id ?? nested.user?.idstr ??
    nestedConfig.uid ?? nestedConfig.user?.id ?? nestedConfig.user?.idstr;
  if ([true, 1, '1'].includes(login) || (uid && String(uid) !== '0')) {
    return { authenticated: true, verified: true };
  }
  if ([false, 0, '0'].includes(login)) {
    return { authenticated: false, verified: true };
  }
  if ([1, '1'].includes(payload?.ok) && payload?.data && typeof payload.data === 'object') {
    return { authenticated: true, verified: true };
  }
  return { authenticated: false, verified: false };
}
