import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { BrowserCrawler } from '../src/crawler.js';
import { LocalArchive } from '../src/storage.js';

const IDS = [
  '2309405068125862494705',
  '2309405068125862494706',
  '2309405068125862494707'
];

describe('browser crawler', () => {
  it('archives a series and later adds only its new chapter', async () => {
    const archive = new LocalArchive(indexedDB, `weicun-crawler-${crypto.randomUUID()}`);
    let hasThird = false;
    const bridge = {
      ping: async () => true,
      async fetchEndpoint({ articleId, endpointIndex }) {
        if (endpointIndex > 0) return { status: 404, body: '' };
        const response = articleId === IDS[0]
          ? {
              data: {
                title: '第一篇',
                text: '正文一',
                sibling: { next: { id: IDS[1] } }
              }
            }
          : articleId === IDS[1]
            ? {
                data: {
                  title: '第二篇',
                  text: '正文二',
                  sibling: { next: hasThird ? { id: IDS[2] } : null }
                }
              }
            : { data: { title: '第三篇', text: '正文三' } };
        return { status: 200, body: JSON.stringify(response) };
      }
    };
    const crawler = new BrowserCrawler({
      archive,
      bridge,
      delayMs: 0,
      maxChapters: 20
    });

    const first = await crawler.archiveFromUrl({
      url: `https://weibo.com/ttarticle/x/m/show#/id=${IDS[0]}`
    });
    expect(first.added).toBe(2);
    expect(first.article.chapterCount).toBe(2);

    hasThird = true;
    const refreshed = await crawler.refresh({ articleId: first.article.id });
    expect(refreshed.added).toBe(1);
    expect(refreshed.article.chapterCount).toBe(3);
    expect((await archive.getChapter(first.article.id, 3)).title).toBe('第三篇');
  });
});
