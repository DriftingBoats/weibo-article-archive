function metadata(article) {
  return [
    article.author ? `作者：${article.author}` : '',
    `来源：${article.sourceUrl}`,
    `保存时间：${article.createdAt}`,
    article.description ? `说明：${article.description}` : ''
  ].filter(Boolean);
}

function imageText(image) {
  const heading = `[图片 ${image.index}${image.alt ? `：${image.alt}` : ''}]`;
  if (image.ocrStatus === 'done' && image.ocrText) {
    return `${heading}\n图片文字：\n${image.ocrText}`;
  }
  return heading;
}

function textContent(chapter) {
  let content = String(chapter.content || '');
  for (const image of chapter.images || []) {
    content = content.replace(image.marker, imageText(image));
  }
  return content;
}

function markdownContent(chapter) {
  let content = String(chapter.content || '');
  for (const image of chapter.images || []) {
    const alt = String(image.alt || `文章配图 ${image.index}`).replace(/[[\]]/g, '');
    const visual = image.url
      ? `![${alt}](${image.url})`
      : `[图片 ${image.index}${image.alt ? `：${image.alt}` : ''}]`;
    const ocr = image.ocrStatus === 'done' && image.ocrText
      ? `\n\n**图片文字**\n\n${image.ocrText}`
      : '';
    content = content.replace(image.marker, `${visual}${ocr}`);
  }
  return content;
}

export function renderText(article, chapters) {
  const lines = [article.title, ...metadata(article), ''];
  chapters.forEach((chapter) => {
    lines.push(`第 ${chapter.index} 篇｜${chapter.title}`, '', textContent(chapter), '');
  });
  return `${lines.join('\n').trim()}\n`;
}

export function renderMarkdown(article, chapters) {
  const lines = [`# ${article.title}`, '', ...metadata(article).map((line) => `> ${line}`), ''];
  chapters.forEach((chapter) => {
    lines.push(`## ${chapter.title}`, '', markdownContent(chapter), '');
  });
  return `${lines.join('\n').trim()}\n`;
}

function safeFilename(value) {
  return String(value || 'weibo-article')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'weibo-article';
}

export function downloadArchive(article, chapters, format) {
  const builders = {
    txt: { type: 'text/plain;charset=utf-8', body: () => renderText(article, chapters) },
    md: { type: 'text/markdown;charset=utf-8', body: () => renderMarkdown(article, chapters) },
    json: {
      type: 'application/json;charset=utf-8',
      body: () => `${JSON.stringify({ article, chapters }, null, 2)}\n`
    }
  };
  const selected = builders[format] || builders.txt;
  const blob = new Blob([selected.body()], { type: selected.type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilename(article.title)}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBackup(backup) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `weicun-backup-${date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
