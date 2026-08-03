export function validWeiboImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return (
      url.protocol === 'https:' &&
      (
        url.hostname === 'sinaimg.cn' ||
        url.hostname.endsWith('.sinaimg.cn') ||
        url.hostname === 'weibo.com' ||
        url.hostname.endsWith('.weibo.com')
      )
    );
  } catch {
    return false;
  }
}

export function imageRequestInit(signal) {
  return {
    method: 'GET',
    cache: 'no-cache',
    credentials: 'include',
    redirect: 'follow',
    signal,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  };
}

let nextImageRuleId = 820_210;

function allocateImageRuleId() {
  nextImageRuleId = nextImageRuleId >= 829_999 ? 820_210 : nextImageRuleId + 1;
  return nextImageRuleId;
}

export function createImageReferrerRule(url, extensionId, ruleId = 820_210) {
  const target = new URL(url);
  return {
    id: ruleId,
    priority: 10_000,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'Referer',
        operation: 'set',
        value: 'https://weibo.com/'
      }]
    },
    condition: {
      initiatorDomains: [extensionId],
      requestDomains: [target.hostname],
      resourceTypes: ['xmlhttprequest']
    }
  };
}

export async function fetchWeiboImage(
  url,
  init,
  {
    rulesApi = chrome.declarativeNetRequest,
    extensionId = chrome.runtime.id,
    fetchImpl = fetch,
    ruleIdProvider = allocateImageRuleId
  } = {}
) {
  if (!rulesApi?.updateSessionRules) {
    throw new Error('扩展无法设置微博图片请求头，请重新加载扩展。');
  }

  const ruleId = ruleIdProvider();
  await rulesApi.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [createImageReferrerRule(url, extensionId, ruleId)]
  });
  try {
    return await fetchImpl(url, init);
  } finally {
    await rulesApi.updateSessionRules({
      removeRuleIds: [ruleId]
    });
  }
}
