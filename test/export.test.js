import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderText } from '../src/export.js';

const article = {
  title: '归档标题',
  sourceUrl: 'https://weibo.com/example',
  createdAt: '2026-07-31T00:00:00.000Z'
};

const chapters = [{
  index: 1,
  title: '第一篇',
  content: '图片之前\n\n[图片 1：截图]\n\n图片之后',
  images: [{
    index: 1,
    marker: '[图片 1：截图]',
    alt: '截图',
    url: 'https://wx1.sinaimg.cn/large/example.jpg',
    ocrStatus: 'done',
    ocrText: '识别出的文字'
  }]
}];

describe('OCR export', () => {
  it('places OCR text at the original image position in TXT', () => {
    const text = renderText(article, chapters);
    expect(text).toContain('[图片 1：截图]\n图片文字：\n识别出的文字');
  });

  it('places the original image and OCR text into Markdown', () => {
    const markdown = renderMarkdown(article, chapters);
    expect(markdown).toContain('![截图](https://wx1.sinaimg.cn/large/example.jpg)');
    expect(markdown).toContain('**图片文字**\n\n识别出的文字');
  });
});
