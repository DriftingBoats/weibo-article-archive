import { canonicalArticleUrl, extractArticleId, assertWeiboArticleUrl } from './url.js';
import { looksLikeAuthWall, parseArticleResponse } from './parser.js';

const ENDPOINT_COUNT = 7;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BrowserCrawler {
  constructor({ archive, bridge, ocr = null, delayMs = 1500, maxChapters = 200 }) {
    this.archive = archive;
    this.bridge = bridge;
    this.ocr = ocr;
    this.delayMs = delayMs;
    this.maxChapters = maxChapters;
  }

  async withImageOcr(fetched, enabled, onProgress, chapterIndex) {
    if (!enabled || !this.ocr || !fetched.images?.length) return fetched;
    const images = await this.ocr.recognizeImages(fetched.images, (progress) => {
      onProgress({
        ...progress,
        current: chapterIndex,
        message: `${progress.message}（第 ${chapterIndex} 篇）`
      });
    });
    return { ...fetched, images };
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
    ocrEnabled = true,
    onProgress = () => {}
  }) {
    const source = assertWeiboArticleUrl(url);
    const existing = await this.archive.findArticle(source.articleId);
    if (existing) {
      return this.refresh({
        articleId: existing.id,
        credentials,
        ocrEnabled,
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
        const fetched = await this.withImageOcr(
          await this.getArticle(currentWeiboId, credentials),
          ocrEnabled,
          onProgress,
          added + 1
        );
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
          images: fetched.images || [],
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

  async refresh({
    articleId,
    credentials = {},
    ocrEnabled = true,
    onProgress = () => {}
  }) {
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
        const refreshedLast = await this.withImageOcr(
          await this.getArticle(last.weiboId, credentials),
          ocrEnabled,
          onProgress,
          last.index
        );
        last.nextUrl = refreshedLast.nextUrl;
        last.content = refreshedLast.content;
        last.images = refreshedLast.images || [];
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
        const fetched = await this.withImageOcr(
          await this.getArticle(currentWeiboId, credentials),
          ocrEnabled,
          onProgress,
          nextIndex
        );
        const now = new Date().toISOString();
        await this.archive.putChapter({
          id: `${articleId}:${nextIndex}`,
          articleId,
          index: nextIndex,
          weiboId: currentWeiboId,
          title: fetched.title || `第 ${nextIndex} 篇`,
          content: fetched.content,
          images: fetched.images || [],
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

  async recognizeArticleImages({
    articleId,
    credentials = {},
    onProgress = () => {}
  }) {
    if (!this.ocr) throw new Error('当前浏览器没有加载图片文字识别模块。');
    const chapters = await this.archive.listChapters(articleId, { includeContent: true });
    let imageCount = 0;
    let recognized = 0;

    try {
      for (const chapter of chapters) {
        let workingChapter = chapter;
        if (!workingChapter.images?.length) {
          onProgress({
            current: chapter.index,
            message: `正在重新读取第 ${chapter.index} 篇的图片地址…`
          });
          const fetched = await this.getArticle(chapter.weiboId, credentials);
          workingChapter = {
            ...workingChapter,
            title: fetched.title || workingChapter.title,
            content: fetched.content,
            images: fetched.images || [],
            nextUrl: fetched.nextUrl,
            crawledAt: new Date().toISOString()
          };
        }

        imageCount += workingChapter.images?.length || 0;
        const before = workingChapter.images?.filter((image) =>
          ['done', 'empty'].includes(image.ocrStatus)
        ).length || 0;
        workingChapter.images = await this.ocr.recognizeImages(
          workingChapter.images || [],
          (progress) => onProgress({
            ...progress,
            current: chapter.index,
            message: `${progress.message}（第 ${chapter.index} 篇）`
          })
        );
        const after = workingChapter.images.filter((image) =>
          ['done', 'empty'].includes(image.ocrStatus)
        ).length;
        recognized += Math.max(0, after - before);
        await this.archive.putChapter(workingChapter);
      }
      return { imageCount, recognized };
    } finally {
      await this.ocr.terminate();
    }
  }
}
