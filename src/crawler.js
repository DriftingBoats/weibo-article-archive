import { canonicalArticleUrl, extractArticleId, assertWeiboArticleUrl } from './url.js';
import { looksLikeAuthWall, parseArticleResponse } from './parser.js';

const ENDPOINT_COUNT = 7;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BrowserCrawler {
  constructor({ archive, bridge, delayMs = 1500, maxChapters = 200 }) {
    this.archive = archive;
    this.bridge = bridge;
    this.delayMs = delayMs;
    this.maxChapters = maxChapters;
  }

  async getArticle(articleId, credentials) {
    let sawAuthWall = false;
    let firstError = '';
    for (let endpointIndex = 0; endpointIndex < ENDPOINT_COUNT; endpointIndex += 1) {
      try {
        const response = await this.bridge.fetchEndpoint({
          articleId,
          endpointIndex,
          ...credentials
        });
        if ([401, 403].includes(response.status) || looksLikeAuthWall(response.body)) {
          sawAuthWall = true;
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          firstError ||= `HTTP ${response.status}`;
          continue;
        }
        const parsed = parseArticleResponse(response.body);
        if (parsed.content && parsed.content !== '无内容') return parsed;
      } catch (error) {
        firstError ||= error.message;
      }
    }
    if (sawAuthWall && !credentials.cookie && !credentials.token) {
      throw new Error('微博要求登录后查看。请在“本地访问设置”中保存 Cookie，或先登录微博后重试。');
    }
    if (sawAuthWall) {
      throw new Error('微博拒绝了当前访问凭据。请更新本地 Cookie 或 Token 后重试。');
    }
    throw new Error(`没有读取到文章正文。${firstError ? `最后一次返回：${firstError}。` : ''}`);
  }

  async archiveFromUrl({
    url,
    title = '',
    author = '',
    description = '',
    credentials = {},
    onProgress = () => {}
  }) {
    const source = assertWeiboArticleUrl(url);
    const existing = await this.archive.findArticle(source.articleId);
    if (existing) {
      return this.refresh({
        articleId: existing.id,
        credentials,
        onProgress
      });
    }

    const connected = await this.bridge.ping();
    if (!connected) throw new Error('还没有连接“微存抓取扩展”。请先安装并启用扩展。');

    const articleId = crypto.randomUUID();
    let currentWeiboId = source.articleId;
    let article = null;
    let added = 0;
    const seen = new Set();

    try {
      while (
        currentWeiboId &&
        added < this.maxChapters &&
        !seen.has(currentWeiboId)
      ) {
        seen.add(currentWeiboId);
        onProgress({
          message: added ? `正在继续保存第 ${added + 1} 篇…` : '正在读取第一篇文章…',
          current: added + 1
        });
        const fetched = await this.getArticle(currentWeiboId, credentials);
        const now = new Date().toISOString();
        const resolvedTitle = title.trim() || fetched.title || `微博文章 ${currentWeiboId}`;

        if (!article) {
          article = {
            id: articleId,
            weiboId: source.articleId,
            sourceUrl: source.url,
            title: resolvedTitle,
            author: author.trim(),
            description: description.trim(),
            chapterCount: 0,
            status: 'crawling',
            errorMessage: '',
            createdAt: now,
            updatedAt: now,
            lastCheckedAt: now
          };
          await this.archive.putArticle(article);
        }

        added += 1;
        await this.archive.putChapter({
          id: `${articleId}:${added}`,
          articleId,
          index: added,
          weiboId: currentWeiboId,
          title: fetched.title || (added === 1 ? resolvedTitle : `第 ${added} 篇`),
          content: fetched.content,
          sourceUrl: canonicalArticleUrl(currentWeiboId),
          nextUrl: fetched.nextUrl,
          crawledAt: now
        });
        onProgress({ message: `已在本机保存 ${added} 篇`, current: added });
        currentWeiboId = fetched.nextUrl ? extractArticleId(fetched.nextUrl) : null;
        if (currentWeiboId && added < this.maxChapters) await delay(this.delayMs);
      }
      article = await this.archive.getArticle(articleId);
      article.status = 'ready';
      article.errorMessage = '';
      await this.archive.putArticle(article);
      return { article, added };
    } catch (error) {
      if (article) {
        article.status = 'error';
        article.errorMessage = error.message;
        await this.archive.putArticle(article);
      }
      throw error;
    }
  }

  async refresh({ articleId, credentials = {}, onProgress = () => {} }) {
    const connected = await this.bridge.ping();
    if (!connected) throw new Error('还没有连接“微存抓取扩展”。请先安装并启用扩展。');
    const article = await this.archive.getArticle(articleId);
    if (!article) throw new Error('没有找到这份本地归档。');
    const last = await this.archive.getLastChapter(articleId);
    if (!last) throw new Error('这份归档还没有正文，请删除后重新保存。');

    article.status = 'crawling';
    await this.archive.putArticle(article);
    let currentWeiboId = last.nextUrl ? extractArticleId(last.nextUrl) : last.weiboId;
    let nextIndex = last.index + (last.nextUrl ? 1 : 0);
    let added = 0;
    const existingChapters = await this.archive.listChapters(articleId);
    const seen = new Set(existingChapters.map((chapter) => chapter.weiboId));

    try {
      if (!last.nextUrl) {
        onProgress({ message: '正在检查最后一篇是否有后续…', current: last.index });
        const refreshedLast = await this.getArticle(last.weiboId, credentials);
        last.nextUrl = refreshedLast.nextUrl;
        last.content = refreshedLast.content;
        last.title = refreshedLast.title || last.title;
        last.crawledAt = new Date().toISOString();
        await this.archive.putChapter(last);
        if (!refreshedLast.nextUrl) {
          article.status = 'ready';
          article.lastCheckedAt = last.crawledAt;
          await this.archive.putArticle(article);
          return { article: await this.archive.getArticle(articleId), added: 0 };
        }
        currentWeiboId = extractArticleId(refreshedLast.nextUrl);
        nextIndex = last.index + 1;
        await delay(this.delayMs);
      }

      while (
        currentWeiboId &&
        nextIndex <= this.maxChapters &&
        !seen.has(currentWeiboId)
      ) {
        seen.add(currentWeiboId);
        onProgress({ message: `发现后续，正在保存第 ${nextIndex} 篇…`, current: nextIndex });
        const fetched = await this.getArticle(currentWeiboId, credentials);
        const now = new Date().toISOString();
        await this.archive.putChapter({
          id: `${articleId}:${nextIndex}`,
          articleId,
          index: nextIndex,
          weiboId: currentWeiboId,
          title: fetched.title || `第 ${nextIndex} 篇`,
          content: fetched.content,
          sourceUrl: canonicalArticleUrl(currentWeiboId),
          nextUrl: fetched.nextUrl,
          crawledAt: now
        });
        added += 1;
        currentWeiboId = fetched.nextUrl ? extractArticleId(fetched.nextUrl) : null;
        nextIndex += 1;
        if (currentWeiboId && nextIndex <= this.maxChapters) await delay(this.delayMs);
      }

      const updated = await this.archive.getArticle(articleId);
      updated.status = 'ready';
      updated.errorMessage = '';
      updated.lastCheckedAt = new Date().toISOString();
      await this.archive.putArticle(updated);
      return { article: updated, added };
    } catch (error) {
      article.status = 'error';
      article.errorMessage = error.message;
      await this.archive.putArticle(article);
      throw error;
    }
  }
}
