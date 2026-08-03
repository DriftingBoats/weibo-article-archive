import { senderIsAllowed } from './security.js';
import {
  getWeiboSessionStatus,
  isWeiboLoginCookieChange,
  interpretWeiboSessionProbe,
  shouldImportManualCookies,
  WEIBO_SESSION_PROBE_URL
} from './session.js';
import { fetchWithBrowserCookies } from './cookie-request.js';
import {
  fetchInWeiboPage,
  probeWeiboSessionInPage,
  shouldRetryInPageContext
} from './page-request.js';
import { imageRequestInit, validWeiboImageUrl } from './image-request.js';

const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
let sessionCache = null;
const SESSION_CACHE_KEY = 'weicunWeiboSession';
const SESSION_CACHE_MS = 12 * 60 * 60 * 1_000;

function safeVerificationError(error) {
  return String(error?.message || error || '未知错误')
    .replace(/chrome-extension:\/\/[^/\s]+/gi, 'chrome-extension://…')
    .slice(0, 180);
}

async function readSessionCache() {
  if (sessionCache) return sessionCache;
  try {
    const stored = await chrome.storage.session.get(SESSION_CACHE_KEY);
    const value = stored?.[SESSION_CACHE_KEY];
    if (value && typeof value.checkedAt === 'number') sessionCache = value;
  } catch {
    // Memory caching still works when session storage is unavailable.
  }
  return sessionCache;
}

async function rememberSessionStatus(value) {
  sessionCache = value;
  try {
    await chrome.storage.session.set({ [SESSION_CACHE_KEY]: value });
  } catch {
    // Keep the in-memory value when session storage is unavailable.
  }
  return value;
}

function invalidateSessionCache() {
  sessionCache = null;
  try {
    chrome.storage.session.remove(SESSION_CACHE_KEY);
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
}

async function verifiedWeiboSessionStatus({ force = false } = {}) {
  const now = Date.now();
  const cached = await readSessionCache();
  if (!force && cached && now - cached.checkedAt < SESSION_CACHE_MS) {
    return cached;
  }

  let localStatus;
  try {
    localStatus = await getWeiboSessionStatus();
  } catch (error) {
    return rememberSessionStatus({
      available: false,
      verified: false,
      cookieCount: 0,
      loginCookieCount: 0,
      verification: 'cookie-api-error',
      verificationError: safeVerificationError(error),
      checkedAt: now
    });
  }
  if (!localStatus.available) {
    return rememberSessionStatus({
      ...localStatus,
      available: false,
      verified: true,
      verification: 'no-login-cookie',
      checkedAt: now
    });
  }

  let pageVerificationError = '';
  try {
    const pageResult = await probeWeiboSessionInPage();
    let pageProbe = pageResult.uid
      ? { authenticated: true, verified: true }
      : { authenticated: false, verified: false };
    if (!pageResult.uid) {
      let pagePayload = null;
      try {
        pagePayload = JSON.parse(pageResult.body);
      } catch {
        // A non-JSON response is not enough to confirm either state.
      }
      pageProbe = interpretWeiboSessionProbe(pageResult.status, pagePayload);
    }
    if (pageProbe.verified) {
      return rememberSessionStatus({
        ...localStatus,
        available: pageProbe.authenticated,
        verified: true,
        verification: pageResult.source,
        checkedAt: now
      });
    }
  } catch (error) {
    pageVerificationError = safeVerificationError(error);
    // Fall back to an extension request, but only trust a positive UID result.
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
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
    const probe = interpretWeiboSessionProbe(response.status, payload);
    return rememberSessionStatus({
      ...localStatus,
      available: probe.authenticated,
      verified: probe.authenticated,
      verification: probe.authenticated ? 'extension-api' : 'unavailable',
      verificationError: probe.authenticated
        ? ''
        : pageVerificationError || '微博页面与扩展请求均未返回用户 UID。',
      checkedAt: now
    });
  } catch (error) {
    return rememberSessionStatus({
      ...localStatus,
      available: false,
      verified: false,
      verification: 'unavailable',
      verificationError: [
        pageVerificationError,
        safeVerificationError(error)
      ].filter(Boolean).join('；'),
      checkedAt: now
    });
  } finally {
    clearTimeout(timeout);
  }
}

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (isWeiboLoginCookieChange(changeInfo)) invalidateSessionCache();
});

function validArticleId(value) {
  return typeof value === 'string' && /^\d{15,30}$/.test(value);
}

function endpoints(articleId) {
  const articleReferrer = `https://weibo.com/ttarticle/p/show?id=${articleId}`;
  return [
    {
      url: `https://weibo.com/ttarticle/x/m/aj/detail?id=${articleId}`,
      referrer: articleReferrer,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' }
    },
    {
      url: `https://m.weibo.cn/statuses/extend?id=${articleId}`,
      referrer: 'https://m.weibo.cn/',
      headers: { Accept: 'application/json, text/plain, */*' }
    },
    {
      url: `https://weibo.com/ajax/statuses/longtext?id=${articleId}`,
      referrer: articleReferrer,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' }
    },
    {
      url: `https://card.weibo.com/article/m/show/id/${articleId}`,
      referrer: 'https://card.weibo.com/',
      pageUrl: `https://card.weibo.com/article/m/show/id/${articleId}`
    },
    {
      url: articleReferrer,
      referrer: 'https://weibo.com/'
    },
    {
      url: `https://weibo.com/ajax/statuses/show?id=${articleId}`,
      referrer: articleReferrer,
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
  if (!trimmed) return false;

  const currentSession = await verifiedWeiboSessionStatus({ force: true });
  if (!shouldImportManualCookies(trimmed, currentSession)) {
    return false;
  }

  const cookies = parseCookieString(trimmed);
  const origins = [
    'https://weibo.com/',
    'https://m.weibo.cn/',
    'https://card.weibo.com/'
  ];
  let imported = 0;
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
        imported += 1;
      } catch {
        // Some cookies are scoped to only one Weibo host; continue with the rest.
      }
    }
  }
  if (imported > 0) invalidateSessionCache();
  return imported > 0;
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
    const requestHeaders = {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      ...endpoint.headers
    };
    const cookies = await chrome.cookies.getAll({ url: endpoint.url });
    let cookieCount = cookies.length;
    let cookieRuleApplied = false;
    let status = 0;
    let body = '';
    let viaPageContext = false;
    let pageError = '';

    try {
      const pageResult = await fetchInWeiboPage(
        endpoint.url,
        requestHeaders,
        {
          referrer: endpoint.referrer,
          pageUrl: endpoint.pageUrl || endpoint.referrer
        }
      );
      status = pageResult.status;
      body = pageResult.body;
      viaPageContext = true;
    } catch (error) {
      pageError = error.message || '微博页面请求失败。';
    }

    if (!viaPageContext || shouldRetryInPageContext(status, body)) {
      const extensionResult = await fetchWithBrowserCookies(endpoint.url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        referrer: endpoint.referrer,
        headers: requestHeaders
      });
      const extensionBody = await extensionResult.response.text();
      if (!viaPageContext || !shouldRetryInPageContext(extensionResult.response.status, extensionBody)) {
        status = extensionResult.response.status;
        body = extensionBody;
        viaPageContext = false;
      }
      cookieCount = extensionResult.cookieCount;
      cookieRuleApplied = extensionResult.cookieRuleApplied;
    }

    if (!body && pageError) {
      throw new Error(pageError);
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
    const response = await fetch(imageUrl, imageRequestInit(controller.signal));
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
    return verifiedWeiboSessionStatus({
      force: Boolean(message.payload?.force)
    });
  }
  if (!senderIsAllowed(sender)) throw new Error('当前网站没有连接扩展的权限。');
  if (message?.type === 'PING') {
    const cached = await readSessionCache();
    return {
      version: chrome.runtime.getManifest().version,
      session: cached || {
        available: false,
        verified: false,
        verification: 'pending'
      }
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
