import { describe, expect, it } from 'vitest';
import { senderIsAllowed } from '../extension/security.js';

describe('extension sender validation', () => {
  it('accepts the published GitHub Pages URL when origin has no path', () => {
    expect(senderIsAllowed({
      origin: 'https://driftingboats.github.io',
      url: 'https://driftingboats.github.io/weibo-article-archive/',
      tab: {
        url: 'https://driftingboats.github.io/weibo-article-archive/#archive'
      }
    })).toBe(true);
  });

  it('accepts local development ports', () => {
    expect(senderIsAllowed({
      origin: 'http://127.0.0.1:4174',
      url: 'http://127.0.0.1:4174/weibo-article-archive/'
    })).toBe(true);
  });

  it('rejects lookalike and unrelated sites', () => {
    expect(senderIsAllowed({
      url: 'https://driftingboats.github.io.evil.example/weibo-article-archive/'
    })).toBe(false);
    expect(senderIsAllowed({
      url: 'https://driftingboats.github.io/another-project/'
    })).toBe(false);
  });
});
