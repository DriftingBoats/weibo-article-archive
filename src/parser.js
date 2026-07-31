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

function textFromNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') {
    const alt = node.getAttribute('alt')?.trim();
    return `\n${alt ? `[图片：${alt}]` : '[图片]'}\n`;
  }
  if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return '';

  let result = '';
  for (const child of node.childNodes) result += textFromNode(child);
  if (node.tagName === 'LI') result = `• ${result}`;
  return BLOCK_TAGS.has(node.tagName) ? `\n${result}\n` : result;
}

export function htmlToText(html) {
  const document = new DOMParser().parseFromString(`<main>${html || ''}</main>`, 'text/html');
  return normalizeText(textFromNode(document.querySelector('main')));
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
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const rawContent =
    data.longTextContent ||
    data.content ||
    data.text ||
    data.article?.content ||
    '';
  return {
    title: normalizeText(data.title || data.status_title || data.page_title || ''),
    content: /<[^>]+>/.test(String(rawContent))
      ? htmlToText(String(rawContent))
      : normalizeText(rawContent),
    nextUrl: nextUrlFromData(data)
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
  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    content = normalizeText(textFromNode(element));
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
  return { title: normalizeText(title), content, nextUrl };
}

export function parseArticleResponse(raw) {
  const value = String(raw || '').trim();
  if (!value) return { title: '', content: '', nextUrl: null };
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
  return [
    '请登录',
    '登录后查看',
    '微博不存在或暂无查看权限',
    '在微博客户端登录查看完整内容',
    'session expired',
    'unauthorized',
    'forbidden'
  ].some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
}
