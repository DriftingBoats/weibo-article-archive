const ALLOWED_HOSTS = new Set([
  'weibo.com',
  'www.weibo.com',
  'm.weibo.cn',
  'card.weibo.com'
]);

export function extractArticleId(input) {
  const value = String(input || '').trim();
  if (/^\d{15,30}$/.test(value)) return value;

  const fragmentMatch = value.match(/[#&?/]id[=/](\d{15,30})/i);
  if (fragmentMatch) return fragmentMatch[1];

  const pathMatch = value.match(/\/show\/id\/(\d{15,30})/i);
  if (pathMatch) return pathMatch[1];

  try {
    const url = new URL(value);
    const queryId = url.searchParams.get('id');
    if (queryId && /^\d{15,30}$/.test(queryId)) return queryId;
    const hashId = new URLSearchParams(url.hash.replace(/^#\/?/, '')).get('id');
    if (hashId && /^\d{15,30}$/.test(hashId)) return hashId;
  } catch {
    // Continue with the conservative numeric matcher.
  }

  return value.match(/(?:^|\D)(\d{18,30})(?:\D|$)/)?.[1] || null;
}

export function canonicalArticleUrl(articleId) {
  return `https://weibo.com/ttarticle/p/show?id=${articleId}`;
}

export function assertWeiboArticleUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw new Error('链接格式不正确，请粘贴完整的微博文章地址。');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('目前只支持 weibo.com、m.weibo.cn 或 card.weibo.com 的 HTTPS 链接。');
  }
  const articleId = extractArticleId(url.href);
  if (!articleId) throw new Error('没有从链接中找到文章 ID，请确认这是微博长文地址。');
  return { articleId, url: canonicalArticleUrl(articleId) };
}
