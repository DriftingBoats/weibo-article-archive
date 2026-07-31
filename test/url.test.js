import { describe, expect, it } from 'vitest';
import {
  assertWeiboArticleUrl,
  canonicalArticleUrl,
  extractArticleId
} from '../src/url.js';

const ID = '2309405068125862494705';

describe('Weibo article URLs', () => {
  it('extracts ids from common URL shapes', () => {
    expect(extractArticleId(`https://weibo.com/ttarticle/x/m/show#/id=${ID}&_wb_client_=1`)).toBe(ID);
    expect(extractArticleId(`https://card.weibo.com/article/m/show/id/${ID}`)).toBe(ID);
    expect(extractArticleId(`https://weibo.com/ttarticle/p/show?id=${ID}`)).toBe(ID);
  });

  it('normalizes an accepted URL', () => {
    expect(assertWeiboArticleUrl(`https://m.weibo.cn/detail?id=${ID}`)).toEqual({
      articleId: ID,
      url: canonicalArticleUrl(ID)
    });
  });

  it('rejects other hosts and HTTP', () => {
    expect(() => assertWeiboArticleUrl(`https://example.com/?id=${ID}`)).toThrow(/只支持/);
    expect(() => assertWeiboArticleUrl(`http://weibo.com/?id=${ID}`)).toThrow(/HTTPS/);
  });
});
