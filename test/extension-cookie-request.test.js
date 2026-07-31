import { describe, expect, it, vi } from 'vitest';
import {
  buildCookieHeader,
  createCookieRule,
  fetchWithBrowserCookies
} from '../extension/cookie-request.js';

describe('authenticated extension requests', () => {
  it('builds a Cookie header without empty entries', () => {
    expect(buildCookieHeader([
      { name: 'SUB', value: 'login' },
      { name: 'empty', value: '' },
      { name: 'lang', value: 'zh-cn' }
    ])).toBe('SUB=login; lang=zh-cn');
  });

  it('limits its temporary rule to the extension and target host', () => {
    expect(createCookieRule(
      'https://weibo.com/ajax/statuses/longtext?id=1',
      'SUB=login',
      'extension-id'
    )).toEqual(expect.objectContaining({
      action: expect.objectContaining({
        requestHeaders: [expect.objectContaining({
          header: 'Cookie',
          operation: 'set'
        })]
      }),
      condition: expect.objectContaining({
        initiatorDomains: ['extension-id'],
        requestDomains: ['weibo.com']
      })
    }));
  });

  it('adds and always removes the session-only Cookie rule', async () => {
    const updateSessionRules = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({ status: 200 }));
    const result = await fetchWithBrowserCookies(
      'https://weibo.com/example',
      { method: 'GET' },
      {
        cookiesApi: {
          getAll: async () => [{ name: 'SUB', value: 'login' }]
        },
        rulesApi: { updateSessionRules },
        extensionId: 'extension-id',
        fetchImpl,
        ruleIdProvider: () => 810_999
      }
    );
    expect(result.cookieRuleApplied).toBe(true);
    expect(updateSessionRules).toHaveBeenCalledTimes(2);
    expect(updateSessionRules.mock.calls[1][0]).toEqual({
      removeRuleIds: [810999]
    });
  });
});
