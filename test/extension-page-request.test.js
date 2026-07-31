import { describe, expect, it, vi } from 'vitest';
import {
  fetchInWeiboPage,
  shouldRetryInPageContext
} from '../extension/page-request.js';

describe('Weibo first-party request fallback', () => {
  it('retries HTTP authorization failures inside a Weibo page', () => {
    expect(shouldRetryInPageContext(401, '')).toBe(true);
    expect(shouldRetryInPageContext(403, '{"error":"Forbidden"}')).toBe(true);
  });

  it('retries login-wall bodies but not normal article responses', () => {
    expect(shouldRetryInPageContext(200, '<p>请登录后查看</p>')).toBe(true);
    expect(shouldRetryInPageContext(200, '{"data":{"text":"正常正文"}}')).toBe(false);
  });

  it('uses and closes a temporary first-party tab when none is open', async () => {
    const remove = vi.fn(async () => {});
    const executeScript = vi.fn(async () => [{
      result: { ok: true, status: 200, body: '{"data":{"text":"正文"}}' }
    }]);
    const result = await fetchInWeiboPage(
      'https://weibo.com/ajax/statuses/longtext?id=1',
      { Accept: 'application/json' },
      {
        tabsApi: {
          query: async () => [],
          create: async () => ({ id: 42 }),
          get: async () => ({ id: 42, status: 'complete' }),
          remove,
          onUpdated: {
            addListener: () => {},
            removeListener: () => {}
          }
        },
        scriptingApi: { executeScript }
      }
    );
    expect(result.status).toBe(200);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 42 },
      world: 'MAIN'
    }));
    expect(remove).toHaveBeenCalledWith(42);
  });
});
