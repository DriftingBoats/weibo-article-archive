import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LocalArchive } from '../src/storage.js';

describe('local IndexedDB archive', () => {
  it('stores, searches and deletes an article with chapters', async () => {
    const storage = new LocalArchive(indexedDB, `weicun-test-${crypto.randomUUID()}`);
    const now = new Date().toISOString();
    const article = {
      id: crypto.randomUUID(),
      weiboId: '2309405068125862494705',
      sourceUrl: 'https://weibo.com/ttarticle/p/show?id=2309405068125862494705',
      title: '本地测试文章',
      author: '测试作者',
      description: '',
      chapterCount: 0,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: now
    };
    await storage.putArticle(article);
    await storage.putChapter({
      id: `${article.id}:1`,
      articleId: article.id,
      index: 1,
      weiboId: article.weiboId,
      title: '第一篇',
      content: '正文',
      sourceUrl: article.sourceUrl,
      nextUrl: null,
      crawledAt: now
    });

    expect((await storage.getArticle(article.id)).chapterCount).toBe(1);
    expect((await storage.listArticles({ query: '测试作者' })).total).toBe(1);
    expect((await storage.getChapter(article.id, 1)).content).toBe('正文');

    await storage.deleteArticle(article.id);
    expect(await storage.getArticle(article.id)).toBeUndefined();
    expect(await storage.listChapters(article.id)).toEqual([]);
  });

  it('keeps credentials in the local settings store', async () => {
    const storage = new LocalArchive(indexedDB, `weicun-settings-${crypto.randomUUID()}`);
    await storage.setSetting('credentials', { token: 'local-token', cookie: 'SUB=local' });
    expect(await storage.getSetting('credentials')).toEqual({
      token: 'local-token',
      cookie: 'SUB=local'
    });
  });

  it('backs up and restores archives without credentials', async () => {
    const source = new LocalArchive(indexedDB, `weicun-backup-source-${crypto.randomUUID()}`);
    const target = new LocalArchive(indexedDB, `weicun-backup-target-${crypto.randomUUID()}`);
    const now = new Date().toISOString();
    await source.putArticle({
      id: 'article-one',
      weiboId: '2309405068125862494705',
      sourceUrl: 'https://weibo.com/ttarticle/p/show?id=2309405068125862494705',
      title: '备份文章',
      author: '',
      description: '',
      chapterCount: 0,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: now
    });
    await source.setSetting('credentials', { token: 'must-not-export', cookie: 'SUB=secret' });

    const backup = await source.createBackup();
    expect(backup).not.toHaveProperty('settings');
    await target.restoreBackup(backup);
    expect((await target.getArticle('article-one')).title).toBe('备份文章');
    expect(await target.getSetting('credentials')).toBeNull();
  });
});
