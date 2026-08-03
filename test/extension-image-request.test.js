import { describe, expect, it, vi } from 'vitest';
import {
  createImageReferrerRule,
  fetchWeiboImage,
  imageRequestInit,
  validWeiboImageUrl
} from '../extension/image-request.js';

describe('extension image requests', () => {
  it('accepts only secure Weibo image hosts', () => {
    expect(validWeiboImageUrl('https://wx1.sinaimg.cn/large/example.jpg')).toBe(true);
    expect(validWeiboImageUrl('https://weibo.com/example.jpg')).toBe(true);
    expect(validWeiboImageUrl('http://wx1.sinaimg.cn/large/example.jpg')).toBe(false);
    expect(validWeiboImageUrl('https://sinaimg.cn.example.com/example.jpg')).toBe(false);
  });

  it('does not force a cross-origin referrer from the extension', () => {
    const signal = new AbortController().signal;
    const request = imageRequestInit(signal);

    expect(request.signal).toBe(signal);
    expect(request.credentials).toBe('include');
    expect(request).not.toHaveProperty('referrer');
  });

  it('limits its temporary Referer rule to the extension and image host', () => {
    expect(createImageReferrerRule(
      'https://wx1.sinaimg.cn/large/example.jpg',
      'extension-id'
    )).toEqual(expect.objectContaining({
      action: expect.objectContaining({
        requestHeaders: [{
          header: 'Referer',
          operation: 'set',
          value: 'https://weibo.com/'
        }]
      }),
      condition: {
        initiatorDomains: ['extension-id'],
        requestDomains: ['wx1.sinaimg.cn'],
        resourceTypes: ['xmlhttprequest']
      }
    }));
  });

  it('adds and always removes the temporary Referer rule', async () => {
    const updateSessionRules = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({ status: 200 }));
    const response = await fetchWeiboImage(
      'https://wx1.sinaimg.cn/large/example.jpg',
      { method: 'GET' },
      {
        rulesApi: { updateSessionRules },
        extensionId: 'extension-id',
        fetchImpl,
        ruleIdProvider: () => 820_999
      }
    );

    expect(response.status).toBe(200);
    expect(updateSessionRules).toHaveBeenCalledTimes(2);
    expect(updateSessionRules.mock.calls[0][0].addRules[0].id).toBe(820999);
    expect(updateSessionRules.mock.calls[1][0]).toEqual({
      removeRuleIds: [820999]
    });
  });

  it('removes the temporary Referer rule when the image request fails', async () => {
    const updateSessionRules = vi.fn(async () => {});
    const requestError = new Error('network failed');

    await expect(fetchWeiboImage(
      'https://wx1.sinaimg.cn/large/example.jpg',
      { method: 'GET' },
      {
        rulesApi: { updateSessionRules },
        extensionId: 'extension-id',
        fetchImpl: async () => { throw requestError; },
        ruleIdProvider: () => 820_998
      }
    )).rejects.toBe(requestError);

    expect(updateSessionRules.mock.calls[1][0]).toEqual({
      removeRuleIds: [820998]
    });
  });
});
