const LOGIN_COOKIE_NAMES = new Set([
  'SUB',
  'SUBP',
  'WBPSESS',
  'SCF',
  'SSOLoginState',
  '_T_WM'
]);

export function summarizeWeiboCookies(cookies = []) {
  const unique = new Map();
  for (const cookie of cookies) {
    if (!cookie?.name || !cookie?.domain) continue;
    const key = `${cookie.storeId || 'default'}:${cookie.domain}:${cookie.path || '/'}:${cookie.name}`;
    unique.set(key, cookie);
  }
  const values = [...unique.values()];
  const loginCookieCount = values.filter((cookie) =>
    LOGIN_COOKIE_NAMES.has(cookie.name) && Boolean(cookie.value)
  ).length;
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
