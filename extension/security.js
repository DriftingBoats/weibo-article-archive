function pageUrlFromSender(sender = {}) {
  const candidates = [sender.tab?.url, sender.url];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    try {
      const url = new URL(candidate);
      if (['http:', 'https:'].includes(url.protocol)) return url;
    } catch {
      // Continue to the next page URL candidate.
    }
  }
  return null;
}

export function senderIsAllowed(sender) {
  const url = pageUrlFromSender(sender);
  if (url) {
    if (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      return true;
    }
    return (
      url.origin === 'https://driftingboats.github.io' &&
      (
        url.pathname === '/weibo-article-archive' ||
        url.pathname.startsWith('/weibo-article-archive/')
      )
    );
  }

  // Some Chromium versions omit the page URL but include the document origin.
  return sender.origin === 'https://driftingboats.github.io';
}
