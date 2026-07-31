let nextCookieRuleId = 810_210;

function allocateCookieRuleId() {
  nextCookieRuleId = nextCookieRuleId >= 819_999 ? 810_210 : nextCookieRuleId + 1;
  return nextCookieRuleId;
}

export function buildCookieHeader(cookies = []) {
  return cookies
    .filter((cookie) => cookie?.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function createCookieRule(url, cookieHeader, extensionId, ruleId = 810_210) {
  const target = new URL(url);
  return {
    id: ruleId,
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
    fetchImpl = fetch,
    ruleIdProvider = allocateCookieRuleId
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

  const ruleId = ruleIdProvider();
  await rulesApi.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [createCookieRule(url, cookieHeader, extensionId, ruleId)]
  });
  try {
    return {
      response: await fetchImpl(url, init),
      cookieCount: cookies.length,
      cookieRuleApplied: true
    };
  } finally {
    await rulesApi.updateSessionRules({
      removeRuleIds: [ruleId]
    });
  }
}
