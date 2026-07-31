import { describe, expect, it } from 'vitest';
import {
  htmlToText,
  htmlToArchiveContent,
  looksLikeAuthWall,
  parseArticleResponse,
  parseHtmlArticle,
  parseJsonArticle
} from '../src/parser.js';

describe('article parsing', () => {
  it('turns article HTML into readable text', () => {
    expect(htmlToText('<p>第一段<br>换行</p><p>第二段<img alt="配图"></p>'))
      .toBe('第一段\n换行\n\n第二段\n[图片：配图]');
  });

  it('keeps image positions and source URLs for local OCR', () => {
    const parsed = htmlToArchiveContent(`
      <p>图片之前</p>
      <img data-src="//wx1.sinaimg.cn/large/example.jpg" alt="聊天截图">
      <p>图片之后</p>
    `);
    expect(parsed.content).toBe('图片之前\n\n[图片 1：聊天截图]\n\n图片之后');
    expect(parsed.images).toEqual([expect.objectContaining({
      index: 1,
      marker: '[图片 1：聊天截图]',
      url: 'https://wx1.sinaimg.cn/large/example.jpg',
      ocrStatus: 'pending'
    })]);
  });

  it('parses JSON content and its next article', () => {
    const parsed = parseJsonArticle({
      data: {
        title: '第一篇',
        longTextContent: '<p>正文<strong>内容</strong></p>',
        sibling: { next: { id: '2309405068125862494706' } }
      }
    });
    expect(parsed.title).toBe('第一篇');
    expect(parsed.content).toBe('正文内容');
    expect(parsed.nextUrl).toMatch(/2494706$/);
  });

  it('parses HTML content and a next link', () => {
    const parsed = parseHtmlArticle(`
      <h1 class="title">长文标题</h1>
      <div class="article-content"><p>正文一</p><p>正文二</p></div>
      <a href="https://weibo.com/ttarticle/p/show?id=2309405068125862494707">下一篇</a>
    `);
    expect(parsed.title).toBe('长文标题');
    expect(parsed.content).toBe('正文一\n\n正文二');
    expect(parsed.nextUrl).toMatch(/2494707$/);
  });

  it('detects response types and login walls', () => {
    expect(parseArticleResponse('{"data":{"text":"正文"}}').content).toBe('正文');
    expect(looksLikeAuthWall('请登录后查看')).toBe(true);
    expect(looksLikeAuthWall('正常正文')).toBe(false);
  });
});
