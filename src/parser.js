import { canonicalArticleUrl, extractArticleId } from './url.js';

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TH', 'TR', 'UL'
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function imageSource(node) {
  const candidates = [
    node.getAttribute('data-original'),
    node.getAttribute('data-src'),
    node.getAttribute('data-lazy-src'),
    node.getAttribute('src'),
    node.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0]
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = candidate.startsWith('//') ? `https:${candidate}` : candidate;
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch {
      // Relative and malformed image sources cannot be fetched by the extension.
    }
  }
  return '';
}

function textFromNode(node, images = null) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') {
    const alt = node.getAttribute('alt')?.trim();
    if (!images) return `\n${alt ? `[图片：${alt}]` : '[图片]'}\n`;
    const index = images.length + 1;
    const marker = `[图片 ${index}${alt ? `：${alt}` : ''}]`;
    images.push({
      index,
      marker,
      url: imageSource(node),
      alt: alt || '',
      ocrText: '',
      ocrStatus: 'pending',
      ocrConfidence: null
    });
    return `\n${marker}\n`;
  }
  if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return '';

  let result = '';
  for (const child of node.childNodes) result += textFromNode(child, images);
  if (node.tagName === 'LI') result = `• ${result}`;
  return BLOCK_TAGS.has(node.tagName) ? `\n${result}\n` : result;
}

export function htmlToText(html) {
  const document = new DOMParser().parseFromString(`<main>${html || ''}</main>`, 'text/html');
  return normalizeText(textFromNode(document.querySelector('main')));
}

export function htmlToArchiveContent(html) {
  const document = new DOMParser().parseFromString(`<main>${html || ''}</main>`, 'text/html');
  const images = [];
  const content = normalizeText(textFromNode(document.querySelector('main'), images));
  return { content, images };
}

function nextUrlFromData(data) {
  const candidates = [
    data?.sibling?.next?.url,
    data?.sibling?.next?.id,
    data?.next_article_id,
    data?.series_info?.next_id,
    data?.next_url,
    data?.nextChapter,
    data?.next
  ];
  for (const value of candidates) {
    const id = value ? extractArticleId(String(value)) : null;
    if (id) return canonicalArticleUrl(id);
  }
  return null;
}

export function parseJsonArticle(payload) {
  if (typeof payload?.data === 'string') {
    const parsedContent = /<[^>]+>/.test(payload.data)
      ? htmlToArchiveContent(payload.data)
      : { content: normalizeText(payload.data), images: [] };
    return { title: '', ...parsedContent, nextUrl: null };
  }

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const records = [
    data,
    data.article,
    data.article_data,
    data.status,
    data.longText,
    data.long_text
  ].filter((value) => value && typeof value === 'object');
  const firstValue = (keys) => {
    for (const record of records) {
      for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
          return record[key];
        }
      }
    }
    return '';
  };
  const rawContent = firstValue([
    'longTextContent', 'long_text_content', 'content', 'text', 'html'
  ]);
  const parsedContent = /<[^>]+>/.test(String(rawContent))
    ? htmlToArchiveContent(String(rawContent))
    : { content: normalizeText(rawContent), images: [] };
  let nextUrl = null;
  for (const record of records) {
    nextUrl = nextUrlFromData(record);
    if (nextUrl) break;
  }
  return {
    title: normalizeText(firstValue(['title', 'status_title', 'page_title'])),
    ...parsedContent,
    nextUrl
  };
}

export function parseHtmlArticle(html) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const titleSelectors = [
    'h1.title', '.article-title', '.title', 'article h1', 'h1', 'title'
  ];
  const contentSelectors = [
    '.article-content', '.WB_editor_iframe', '.WB_detail', '.WB_text',
    '.content', 'article', '.main-content'
  ];

  let title = '';
  for (const selector of titleSelectors) {
    title = document.querySelector(selector)?.textContent?.trim() || '';
    if (title) break;
  }

  let content = '';
  let images = [];
  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const candidateImages = [];
    content = normalizeText(textFromNode(element, candidateImages));
    images = candidateImages;
    if (content) break;
  }

  let nextUrl = null;
  for (const link of document.querySelectorAll('a[href]')) {
    const label = `${link.getAttribute('rel') || ''} ${link.getAttribute('title') || ''} ${link.textContent || ''}`;
    if (!/next|下一篇|下一章|下一页|下一节|继续阅读/i.test(label)) continue;
    const id = extractArticleId(link.href);
    if (id) {
      nextUrl = canonicalArticleUrl(id);
      break;
    }
  }
  return { title: normalizeText(title), content, images, nextUrl };
}

export function parseArticleResponse(raw) {
  const value = String(raw || '').trim();
  if (!value) return { title: '', content: '', images: [], nextUrl: null };
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return parseJsonArticle(JSON.parse(value));
    } catch {
      // Fall through to HTML parsing.
    }
  }
  return parseHtmlArticle(value);
}

export function looksLikeAuthWall(raw) {
  const text = String(raw || '').replace(/\\u([0-9a-f]{4})/gi, (_, code) =>
    String.fromCharCode(Number.parseInt(code, 16))
  );
  try {
    const payload = JSON.parse(text);
    if (
      [-100, '-100'].includes(payload?.ok) ||
      [100001, 100098, '100001', '100098'].includes(payload?.code) ||
      /\/login\.php|passport\.weibo/i.test(String(payload?.url || ''))
    ) {
      return true;
    }
  } catch {
    // Non-JSON responses continue through phrase matching.
  }
  return [
    '请登录',
    '登录后查看',
    '需要登录',
    '请先登录',
    '微博不存在或暂无查看权限',
    '在微博客户端登录查看完整内容',
    'session expired',
    'unauthorized',
    'forbidden'
  ].some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
}
