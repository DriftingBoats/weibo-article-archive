const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
let lastImportedCookie = '';

function validArticleId(value) {
  return typeof value === 'string' && /^\d{15,30}$/.test(value);
}

function senderIsAllowed(sender) {
  const senderLocation = sender.origin || sender.url || sender.tab?.url;
  if (!senderLocation) return false;
  const url = new URL(senderLocation);
  if (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.port === '4173'
  ) {
    return true;
  }
  return (
    url.origin === 'https://driftingboats.github.io' &&
    url.pathname.startsWith('/weibo-article-archive/')
  );
}

function endpoints(articleId, token) {
  return [
    {
      url: `https://weibo.com/ttarticle/x/m/aj/detail?id=${articleId}`,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' }
    },
    {
      url: `https://m.weibo.cn/statuses/extend?id=${articleId}`,
      mobile: true
    },
    {
      url: `https://weibo.com/ajax/statuses/longtext?id=${articleId}`,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' }
    },
    {
      url: `https://card.weibo.com/article/m/show/id/${articleId}`
    },
    {
      url: `https://weibo.com/ttarticle/p/show?id=${articleId}`
    },
    {
      url: `https://weibo.com/ajax/statuses/show?id=${articleId}`,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' }
    },
    token
      ? {
          url: `https://api.weibo.com/2/statuses/show.json?id=${articleId}&access_token=${encodeURIComponent(token)}`,
          mobile: true
        }
      : { unavailable: true }
  ];
}

function parseCookieString(value) {
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return null;
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim()
      };
    })
    .filter((item) => item && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(item.name));
}

async function importCookies(cookieString) {
  const trimmed = String(cookieString || '').trim();
  if (!trimmed || trimmed === lastImportedCookie) return;
  const cookies = parseCookieString(trimmed);
  const origins = [
    'https://weibo.com/',
    'https://m.weibo.cn/',
    'https://card.weibo.com/'
  ];
  for (const cookie of cookies) {
    for (const url of origins) {
      try {
        await chrome.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          path: '/',
          secure: true,
          sameSite: 'unspecified'
        });
      } catch {
        // Some cookies are scoped to only one Weibo host; continue with the rest.
      }
    }
  }
  lastImportedCookie = trimmed;
}

async function fetchEndpoint(payload) {
  const { articleId, endpointIndex, cookie = '', token = '' } = payload;
  if (!validArticleId(articleId)) throw new Error('文章 ID 格式不正确。');
  if (!Number.isInteger(endpointIndex) || endpointIndex < 0 || endpointIndex > 6) {
    throw new Error('请求的微博接口不在允许范围内。');
  }
  if (String(cookie).length > 8000 || String(token).length > 4000) {
    throw new Error('本地访问凭据长度异常。');
  }

  await importCookies(cookie);
  const endpoint = endpoints(articleId, String(token).trim())[endpointIndex];
  if (endpoint.unavailable) {
    return { status: 400, body: '', endpointIndex };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint.url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      referrer: endpoint.mobile ? 'https://m.weibo.cn/' : 'https://weibo.com/',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        ...endpoint.headers
      }
    });
    const body = await response.text();
    if (new Blob([body]).size > MAX_RESPONSE_BYTES) {
      throw new Error('微博返回内容过大，扩展已停止读取。');
    }
    return {
      status: response.status,
      body,
      endpointIndex
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接微博超时，请稍后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMessage(message, sender) {
  if (!senderIsAllowed(sender)) throw new Error('当前网站没有连接扩展的权限。');
  if (message?.type === 'PING') {
    return { version: chrome.runtime.getManifest().version };
  }
  if (message?.type === 'FETCH_ARTICLE_ENDPOINT') {
    return fetchEndpoint(message.payload || {});
  }
  throw new Error('扩展不支持这个请求。');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({
      ok: false,
      error: error.message || '扩展请求失败。'
    })
  );
  return true;
});
