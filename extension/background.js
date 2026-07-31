import { senderIsAllowed } from './security.js';
import {
  getWeiboSessionStatus,
  interpretWeiboSessionProbe,
  WEIBO_SESSION_PROBE_URL
} from './session.js';
import { fetchWithBrowserCookies } from './cookie-request.js';
import {
  fetchInWeiboPage,
  shouldRetryInPageContext
} from './page-request.js';

const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
let lastImportedCookie = '';
let sessionCache = null;
const SESSION_CACHE_MS = 5_000;

async function verifiedWeiboSessionStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && sessionCache && now - sessionCache.checkedAt < SESSION_CACHE_MS) {
    return sessionCache;
  }

  const localStatus = await getWeiboSessionStatus();
  if (!localStatus.available) {
    sessionCache = {
      ...localStatus,
      available: false,
      verified: true,
      checkedAt: now
    };
    return sessionCache;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const { response } = await fetchWithBrowserCookies(WEIBO_SESSION_PROBE_URL, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      referrer: 'https://weibo.com/',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    let payload = null;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      // The status code can still conclusively identify an expired session.
    }
    let probe = interpretWeiboSessionProbe(response.status, payload);
    if (!probe.authenticated && localStatus.available) {
      try {
        const pageResult = await fetchInWeiboPage(WEIBO_SESSION_PROBE_URL, {
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest'
        });
        let pagePayload = null;
        try {
          pagePayload = JSON.parse(pageResult.body);
        } catch {
          // Status-only responses remain useful for detecting logout.
        }
        probe = interpretWeiboSessionProbe(pageResult.status, pagePayload);
      } catch {
        // Keep the extension-origin probe result.
      }
    }
    sessionCache = {
      ...localStatus,
      available: probe.authenticated,
      verified: probe.verified,
      checkedAt: now
    };
    return sessionCache;
  } catch {
    sessionCache = {
      ...localStatus,
      available: false,
      verified: false,
      checkedAt: now
    };
    return sessionCache;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.cookies.onChanged.addListener(() => {
  sessionCache = null;
});

function validArticleId(value) {
  return typeof value === 'string' && /^\d{15,30}$/.test(value);
}

function endpoints(articleId) {
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
    }
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
  const { articleId, endpointIndex, cookie = '' } = payload;
  if (!validArticleId(articleId)) throw new Error('文章 ID 格式不正确。');
  if (!Number.isInteger(endpointIndex) || endpointIndex < 0 || endpointIndex > 5) {
    throw new Error('请求的微博接口不在允许范围内。');
  }
  if (String(cookie).length > 8000) {
    throw new Error('本地访问凭据长度异常。');
  }

  await importCookies(cookie);
  const endpoint = endpoints(articleId)[endpointIndex];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const { response, cookieCount, cookieRuleApplied } = await fetchWithBrowserCookies(endpoint.url, {
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
    let status = response.status;
    let body = await response.text();
    let viaPageContext = false;
    if (shouldRetryInPageContext(status, body)) {
      try {
        const pageResult = await fetchInWeiboPage(endpoint.url, {
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
          ...endpoint.headers
        });
        status = pageResult.status;
        body = pageResult.body;
        viaPageContext = true;
      } catch {
        // Return the original response so the website can show the auth error.
      }
    }
    if (new Blob([body]).size > MAX_RESPONSE_BYTES) {
      throw new Error('微博返回内容过大，扩展已停止读取。');
    }
    return {
      status,
      body,
      endpointIndex,
      session: await verifiedWeiboSessionStatus(),
      cookieCount,
      cookieRuleApplied,
      viaPageContext
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接微博超时，请稍后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validWeiboImageUrl(value) {
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

function bytesToBase64(bytes) {
  const chunkSize = 32_768;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fetchImage(payload) {
  const imageUrl = String(payload?.url || '');
  if (!validWeiboImageUrl(imageUrl)) {
    throw new Error('扩展只允许读取微博图片地址。');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(imageUrl, {
      method: 'GET',
      cache: 'force-cache',
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal,
      referrer: 'https://weibo.com/',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）。`);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    if (!contentType.startsWith('image/')) throw new Error('微博返回的内容不是图片。');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error('图片超过 10 MB，已跳过本地识别。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过 10 MB，已跳过本地识别。');
    return {
      dataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}`,
      contentType,
      byteLength: bytes.byteLength
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('读取微博图片超时。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMessage(message, sender) {
  if (message?.type === 'GET_WEIBO_SESSION_STATUS') {
    if (sender.id !== chrome.runtime.id) throw new Error('只有微存扩展可以读取登录状态。');
    return verifiedWeiboSessionStatus({ force: true });
  }
  if (!senderIsAllowed(sender)) throw new Error('当前网站没有连接扩展的权限。');
  if (message?.type === 'PING') {
    return {
      version: chrome.runtime.getManifest().version,
      session: await verifiedWeiboSessionStatus({ force: true })
    };
  }
  if (message?.type === 'FETCH_ARTICLE_ENDPOINT') {
    return fetchEndpoint(message.payload || {});
  }
  if (message?.type === 'FETCH_WEIBO_IMAGE') {
    return fetchImage(message.payload || {});
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
