const DATABASE_NAME = 'weicun-archive';
const DATABASE_VERSION = 1;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

export class LocalArchive {
  constructor(indexedDBFactory = indexedDB, databaseName = DATABASE_NAME) {
    this.indexedDB = indexedDBFactory;
    this.databaseName = databaseName;
    this.databasePromise = null;
  }

  open() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('articles')) {
          const articles = database.createObjectStore('articles', { keyPath: 'id' });
          articles.createIndex('weiboId', 'weiboId', { unique: true });
          articles.createIndex('updatedAt', 'updatedAt');
        }
        if (!database.objectStoreNames.contains('chapters')) {
          const chapters = database.createObjectStore('chapters', { keyPath: 'id' });
          chapters.createIndex('articleId', 'articleId');
          chapters.createIndex('articleWeiboId', ['articleId', 'weiboId'], { unique: true });
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' });
        }
      });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    return this.databasePromise;
  }

  async listArticles({ query = '', page = 1, limit = 12 } = {}) {
    const database = await this.open();
    const transaction = database.transaction('articles', 'readonly');
    let items = await requestToPromise(transaction.objectStore('articles').getAll());
    const term = query.trim().toLocaleLowerCase('zh-CN');
    if (term) {
      items = items.filter((article) =>
        [article.title, article.author, article.description]
          .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(term))
      );
    }
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(Math.max(1, page), pages);
    return {
      items: items.slice((safePage - 1) * limit, safePage * limit),
      page: safePage,
      pages,
      limit,
      total
    };
  }

  async findArticle(weiboId) {
    const database = await this.open();
    const transaction = database.transaction('articles', 'readonly');
    return requestToPromise(transaction.objectStore('articles').index('weiboId').get(weiboId));
  }

  async getArticle(id) {
    const database = await this.open();
    const transaction = database.transaction('articles', 'readonly');
    return requestToPromise(transaction.objectStore('articles').get(id));
  }

  async putArticle(article) {
    const database = await this.open();
    const transaction = database.transaction('articles', 'readwrite');
    transaction.objectStore('articles').put(article);
    await transactionDone(transaction);
    return article;
  }

  async putChapter(chapter) {
    const database = await this.open();
    const transaction = database.transaction(['chapters', 'articles'], 'readwrite');
    const chapters = transaction.objectStore('chapters');
    const articles = transaction.objectStore('articles');
    chapters.put(chapter);
    const article = await requestToPromise(articles.get(chapter.articleId));
    if (article) {
      article.chapterCount = Math.max(article.chapterCount || 0, chapter.index);
      article.updatedAt = chapter.crawledAt;
      article.lastCheckedAt = chapter.crawledAt;
      article.status = 'ready';
      article.errorMessage = '';
      articles.put(article);
    }
    await transactionDone(transaction);
    return chapter;
  }

  async listChapters(articleId, { includeContent = false } = {}) {
    const database = await this.open();
    const transaction = database.transaction('chapters', 'readonly');
    const rows = await requestToPromise(
      transaction.objectStore('chapters').index('articleId').getAll(articleId)
    );
    rows.sort((left, right) => left.index - right.index);
    if (includeContent) return rows;
    return rows.map(({ content: _content, ...chapter }) => chapter);
  }

  async getChapter(articleId, index) {
    const database = await this.open();
    const transaction = database.transaction('chapters', 'readonly');
    return requestToPromise(transaction.objectStore('chapters').get(`${articleId}:${index}`));
  }

  async getLastChapter(articleId) {
    const chapters = await this.listChapters(articleId, { includeContent: true });
    return chapters.at(-1);
  }

  async deleteArticle(id) {
    const database = await this.open();
    const transaction = database.transaction(['articles', 'chapters'], 'readwrite');
    transaction.objectStore('articles').delete(id);
    const chapterStore = transaction.objectStore('chapters');
    const chapterKeys = await requestToPromise(chapterStore.index('articleId').getAllKeys(id));
    chapterKeys.forEach((key) => chapterStore.delete(key));
    await transactionDone(transaction);
  }

  async getSetting(key, fallback = null) {
    const database = await this.open();
    const transaction = database.transaction('settings', 'readonly');
    const result = await requestToPromise(transaction.objectStore('settings').get(key));
    return result?.value ?? fallback;
  }

  async setSetting(key, value) {
    const database = await this.open();
    const transaction = database.transaction('settings', 'readwrite');
    transaction.objectStore('settings').put({ key, value });
    await transactionDone(transaction);
  }

  async createBackup() {
    const database = await this.open();
    const transaction = database.transaction(['articles', 'chapters'], 'readonly');
    const articles = await requestToPromise(transaction.objectStore('articles').getAll());
    const chapters = await requestToPromise(transaction.objectStore('chapters').getAll());
    return {
      format: 'weicun-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      articles,
      chapters
    };
  }

  async restoreBackup(backup) {
    if (
      backup?.format !== 'weicun-backup' ||
      backup?.version !== 1 ||
      !Array.isArray(backup.articles) ||
      !Array.isArray(backup.chapters)
    ) {
      throw new Error('这不是有效的微存备份文件。');
    }
    const database = await this.open();
    const transaction = database.transaction(['articles', 'chapters'], 'readwrite');
    const articles = transaction.objectStore('articles');
    const chapters = transaction.objectStore('chapters');
    for (const article of backup.articles) {
      if (!article?.id || !article?.weiboId || !article?.title) {
        transaction.abort();
        throw new Error('备份中的归档资料不完整。');
      }
      articles.put(article);
    }
    for (const chapter of backup.chapters) {
      if (!chapter?.id || !chapter?.articleId || !Number.isInteger(chapter?.index)) {
        transaction.abort();
        throw new Error('备份中的文章章节不完整。');
      }
      chapters.put(chapter);
    }
    await transactionDone(transaction);
    return {
      articles: backup.articles.length,
      chapters: backup.chapters.length
    };
  }
}
