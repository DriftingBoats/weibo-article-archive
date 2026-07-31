import { describe, expect, it } from 'vitest';
import {
  interpretWeiboSessionProbe,
  shouldImportManualCookies,
  summarizeWeiboCookies,
  WEIBO_SESSION_PROBE_URL
} from '../extension/session.js';

describe('Weibo session detection', () => {
  it('uses the current first-party config endpoint', () => {
    expect(WEIBO_SESSION_PROBE_URL).toBe('https://weibo.com/ajax/config/get_config');
  });

  it('never overwrites a current or unverified browser session with manual cookies', () => {
    expect(shouldImportManualCookies('SUB=old', {
      available: true,
      verified: true
    })).toBe(false);
    expect(shouldImportManualCookies('SUB=old', {
      available: false,
      verified: false
    })).toBe(false);
    expect(shouldImportManualCookies('SUB=fallback', {
      available: false,
      verified: true
    })).toBe(true);
  });

  it('detects a usable login cookie without exposing cookie values', () => {
    const result = summarizeWeiboCookies([
      { name: 'SUB', value: 'secret', domain: '.weibo.com', path: '/', storeId: '0' },
      { name: 'lang', value: 'zh-cn', domain: '.weibo.com', path: '/', storeId: '0' }
    ]);
    expect(result).toEqual({
      available: true,
      cookieCount: 2,
      loginCookieCount: 1
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('uses the Weibo server response rather than stale local cookies', () => {
    expect(interpretWeiboSessionProbe(403, { error: 'Forbidden' })).toEqual({
      authenticated: false,
      verified: true
    });
    expect(interpretWeiboSessionProbe(200, {
      data: { login: true, uid: '123456' }
    })).toEqual({
      authenticated: true,
      verified: true
    });
    expect(interpretWeiboSessionProbe(200, {
      data: { config: { config: { uid: '123456' } } }
    })).toEqual({
      authenticated: true,
      verified: true
    });
    expect(interpretWeiboSessionProbe(200, {
      ok: 1,
      data: { config: {} }
    })).toEqual({
      authenticated: true,
      verified: true
    });
    expect(interpretWeiboSessionProbe(200, {
      data: { login: false }
    })).toEqual({
      authenticated: false,
      verified: true
    });
    expect(interpretWeiboSessionProbe(200, {
      ok: -100,
      url: 'https://weibo.com/login.php'
    })).toEqual({
      authenticated: false,
      verified: true
    });
  });

  it('does not treat ordinary preference cookies as a login', () => {
    expect(summarizeWeiboCookies([
      { name: 'lang', value: 'zh-cn', domain: '.weibo.com', path: '/' },
      { name: '_T_WM', value: 'anonymous', domain: '.weibo.cn', path: '/' }
    ])).toEqual({
      available: false,
      cookieCount: 2,
      loginCookieCount: 0
    });
  });
});
