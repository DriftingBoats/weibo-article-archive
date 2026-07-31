const COOKIE_RULE_ID = 81021;

export function buildCookieHeader(cookies = []) {
  return cookies
    .filter((cookie) => cookie?.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function createCookieRule(url, cookieHeader, extensionId) {
  const target = new URL(url);
  return {
    id: COOKIE_RULE_ID,
    priority: 10_000,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'Cookie',
        operation: 'set',
        value: cookieHeader
      }]
    },
    condition: {
      initiatorDomains: [extensionId],
      requestDomains: [target.hostname],
      resourceTypes: ['xmlhttprequest']
    }
  };
}

export async function fetchWithBrowserCookies(
  url,
  init,
  {
    cookiesApi = chrome.cookies,
    rulesApi = chrome.declarativeNetRequest,
    extensionId = chrome.runtime.id,
    fetchImpl = fetch
  } = {}
) {
  const cookies = await cookiesApi.getAll({ url });
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader || !rulesApi?.updateSessionRules) {
    return {
      response: await fetchImpl(url, init),
      cookieCount: cookies.length,
      cookieRuleApplied: false
    };
  }

  await rulesApi.updateSessionRules({
    removeRuleIds: [COOKIE_RULE_ID],
    addRules: [createCookieRule(url, cookieHeader, extensionId)]
  });
  try {
    return {
      response: await fetchImpl(url, init),
      cookieCount: cookies.length,
      cookieRuleApplied: true
    };
  } finally {
    await rulesApi.updateSessionRules({
      removeRuleIds: [COOKIE_RULE_ID]
    });
  }
}
