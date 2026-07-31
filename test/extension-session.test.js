import { describe, expect, it } from 'vitest';
import { summarizeWeiboCookies } from '../extension/session.js';

describe('Weibo session detection', () => {
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

  it('does not treat ordinary preference cookies as a login', () => {
    expect(summarizeWeiboCookies([
      { name: 'lang', value: 'zh-cn', domain: '.weibo.com', path: '/' }
    ])).toEqual({
      available: false,
      cookieCount: 1,
      loginCookieCount: 0
    });
  });
});
