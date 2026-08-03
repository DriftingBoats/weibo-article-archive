import { describe, expect, it } from 'vitest';
import { imageRequestInit, validWeiboImageUrl } from '../extension/image-request.js';

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
});
