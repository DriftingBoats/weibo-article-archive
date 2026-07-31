const AUTH_WALL_PHRASES = [
  '请登录',
  '登录后查看',
  '微博不存在或暂无查看权限',
  '在微博客户端登录查看完整内容',
  'session expired',
  'unauthorized',
  'forbidden'
];

export function shouldRetryInPageContext(status, body = '') {
  if ([401, 403].includes(status)) return true;
  const value = String(body).toLowerCase();
  return AUTH_WALL_PHRASES.some((phrase) => value.includes(phrase.toLowerCase()));
}

function waitForTab(tabId, tabsApi, timeoutMs = 15_000) {
  return new Promise(async (resolve, reject) => {
    try {
      const current = await tabsApi.get(tabId);
      if (current.status === 'complete') {
        resolve();
        return;
      }
    } catch (error) {
      reject(error);
      return;
    }

    const timeout = setTimeout(() => {
      tabsApi.onUpdated.removeListener(onUpdated);
      reject(new Error('等待微博页面加载超时。'));
    }, timeoutMs);
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      tabsApi.onUpdated.removeListener(onUpdated);
      resolve();
    }
    tabsApi.onUpdated.addListener(onUpdated);
  });
}

export async function fetchInWeiboPage(
  url,
  headers = {},
  {
    tabsApi = chrome.tabs,
    scriptingApi = chrome.scripting
  } = {}
) {
  const target = new URL(url);
  const matches = await tabsApi.query({ url: `${target.origin}/*` });
  let tab = matches.find((candidate) => candidate.id);
  let owned = false;

  if (!tab) {
    tab = await tabsApi.create({
      url: `${target.origin}/`,
      active: false
    });
    owned = true;
  }

  try {
    await waitForTab(tab.id, tabsApi);
    const [execution] = await scriptingApi.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (requestUrl, requestHeaders) => {
        try {
          const response = await fetch(requestUrl, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            headers: requestHeaders
          });
          return {
            ok: true,
            status: response.status,
            body: await response.text()
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            body: '',
            error: error.message || '微博页面请求失败。'
          };
        }
      },
      args: [url, headers]
    });
    const result = execution?.result;
    if (!result?.ok) throw new Error(result?.error || '微博页面没有返回有效响应。');
    return result;
  } finally {
    if (owned && tab?.id) {
      try {
        await tabsApi.remove(tab.id);
      } catch {
        // The user may have closed the temporary tab first.
      }
    }
  }
}
