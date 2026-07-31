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
  try {
    const payload = JSON.parse(value);
    if (
      [-100, '-100'].includes(payload?.ok) ||
      [100001, 100098, '100001', '100098'].includes(payload?.code) ||
      /\/login\.php|passport\.weibo/.test(String(payload?.url || ''))
    ) {
      return true;
    }
  } catch {
    // HTML and plain-text responses are handled by phrase matching below.
  }
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

function hasTabId(tab) {
  return Number.isInteger(tab?.id);
}

async function runInWeiboPage(
  origin,
  func,
  args,
  {
    tabsApi,
    scriptingApi,
    createUrl = `${origin}/`,
    maxExistingTabs = 2,
    tabLoadTimeoutMs = 8_000,
    createAfterExistingFailure = true
  }
) {
  const matches = (await tabsApi.query({ url: `${origin}/*` }))
    .filter(hasTabId)
    .sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active)))
    .slice(0, maxExistingTabs);
  let lastError = null;

  async function execute(tab) {
    await waitForTab(tab.id, tabsApi, tabLoadTimeoutMs);
    const [execution] = await scriptingApi.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func,
      args
    });
    if (!execution) throw new Error('微博页面没有返回执行结果。');
    if (execution.result?.ok === false) {
      throw new Error(execution.result.error || '微博页面请求失败。');
    }
    return execution.result;
  }

  for (const tab of matches) {
    try {
      return await execute(tab);
    } catch (error) {
      lastError = error;
    }
  }

  if (matches.length > 0 && !createAfterExistingFailure) {
    throw lastError || new Error('现有微博页面无法执行登录验证。');
  }

  const tab = await tabsApi.create({
    url: createUrl,
    active: false
  });
  try {
    return await execute(tab);
  } catch (error) {
    throw error || lastError || new Error('无法在微博页面中执行验证。');
  } finally {
    if (hasTabId(tab)) {
      try {
        await tabsApi.remove(tab.id);
      } catch {
        // The user may have closed the temporary tab first.
      }
    }
  }
}

export async function fetchInWeiboPage(
  url,
  headers = {},
  {
    tabsApi = chrome.tabs,
    scriptingApi = chrome.scripting,
    referrer = '',
    pageUrl = ''
  } = {}
) {
  const target = new URL(url);
  const result = await runInWeiboPage(
    target.origin,
    async (requestUrl, requestHeaders, requestReferrer) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(requestUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow',
          headers: requestHeaders,
          referrer: requestReferrer || undefined,
          signal: controller.signal
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
      } finally {
        clearTimeout(timeout);
      }
    },
    [url, headers, referrer],
    {
      tabsApi,
      scriptingApi,
      createUrl: pageUrl || `${target.origin}/`,
      maxExistingTabs: 2,
      tabLoadTimeoutMs: 8_000
    }
  );
  if (!result?.ok) throw new Error(result?.error || '微博页面没有返回有效响应。');
  return result;
}

export async function probeWeiboSessionInPage(
  {
    tabsApi = chrome.tabs,
    scriptingApi = chrome.scripting
  } = {}
) {
  const result = await runInWeiboPage(
    'https://weibo.com',
    async () => {
      function currentUid() {
        const app = document.querySelector('#app')?.__vue_app__;
        const store = app?.config?.globalProperties?.$store;
        const candidates = [
          store?.state?.config?.config?.uid,
          store?.state?.config?.config?.user?.id,
          store?.state?.config?.config?.user?.idstr,
          store?.state?.config?.uid,
          store?.state?.config?.user?.id,
          store?.state?.config?.user?.idstr,
          store?.state?.user?.id,
          store?.state?.user?.idstr,
          globalThis.$CONFIG?.uid
        ];
        const uid = candidates.find((value) => value && String(value) !== '0');
        return uid ? String(uid) : '';
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const uid = currentUid();
          if (uid) {
            return { ok: true, status: 200, body: '', uid, source: 'page-store' };
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }

        const response = await fetch('/ajax/config/get_config', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            Accept: 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        return {
          ok: true,
          status: response.status,
          body: await response.text(),
          uid: '',
          source: 'page-api'
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          body: '',
          uid: '',
          source: 'page-error',
          error: error.message || '微博页面登录验证失败。'
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    [],
    {
      tabsApi,
      scriptingApi,
      maxExistingTabs: 1,
      tabLoadTimeoutMs: 5_000,
      createAfterExistingFailure: false
    }
  );
  if (!result?.ok) throw new Error(result?.error || '微博页面登录验证失败。');
  return result;
}
