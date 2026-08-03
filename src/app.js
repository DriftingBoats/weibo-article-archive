import { LocalArchive } from './storage.js';
import { ExtensionBridge } from './extension-bridge.js';
import { BrowserCrawler } from './crawler.js';
import { LocalImageOcr } from './ocr.js';
import { cookieCredentials } from './credentials.js';
import { downloadArchive, downloadBackup } from './export.js';

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const archive = new LocalArchive();
const bridge = new ExtensionBridge();
const imageOcr = new LocalImageOcr({ bridge });
const crawler = new BrowserCrawler({ archive, bridge, ocr: imageOcr });

const state = {
  home: { query: '', page: 1 },
  article: null,
  chapters: [],
  activeChapter: 1,
  pendingDelete: null,
  extensionConnected: false,
  weiboSession: null,
  credentials: { cookie: '' },
  ocrEnabled: true
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(value));
}

function excerpt(value, length = 110) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

function showToast(message, actionLabel = '', onAction = null, duration = 5000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  const copy = document.createElement('span');
  copy.textContent = message;
  toast.append(copy);

  let timer;
  if (actionLabel && onAction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', () => {
      clearTimeout(timer);
      toast.remove();
      onAction();
    });
    toast.append(button);
  }
  toastRegion.append(toast);
  timer = setTimeout(() => toast.remove(), duration);
  return { toast, timer };
}

async function imageDataUrl(imageUrl) {
  const result = await bridge.fetchImage(imageUrl);
  if (!result?.dataUrl?.startsWith('data:image/')) {
    throw new Error('扩展没有返回有效的图片数据。');
  }
  return result.dataUrl;
}

function bindArchiveImageEvents(container) {
  container.querySelectorAll('img[data-image-source]').forEach((image) => {
    image.addEventListener('error', async () => {
      if (image.dataset.extensionFallback === 'pending' || image.dataset.extensionFallback === 'done') return;
      image.dataset.extensionFallback = 'pending';
      try {
        image.src = await imageDataUrl(image.dataset.imageSource);
        image.dataset.extensionFallback = 'done';
      } catch (error) {
        image.dataset.extensionFallback = 'failed';
        image.closest('.archive-image')?.classList.add('has-image-error');
        showToast(`原图读取失败：${error.message}`, '', null, 8000);
      }
    });
  });

  container.querySelectorAll('[data-open-image]').forEach((button) => {
    button.addEventListener('click', async () => {
      const preview = window.open('about:blank', '_blank');
      if (!preview) {
        showToast('浏览器阻止了新窗口，请允许此网站打开新标签页。');
        return;
      }
      preview.opener = null;
      preview.document.title = '正在读取微博原图…';
      preview.document.body.textContent = '正在通过微存扩展读取原图…';
      try {
        const dataUrl = await imageDataUrl(button.dataset.openImage);
        const blob = await fetch(dataUrl).then((response) => response.blob());
        const blobUrl = URL.createObjectURL(blob);
        preview.location.replace(blobUrl);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch (error) {
        preview.close();
        showToast(`原图读取失败：${error.message}`, '', null, 8000);
      }
    });
  });
}

function loadingPage() {
  app.innerHTML = `
    <div class="loading-page" aria-label="正在打开页面">
      <div class="loading-line"></div>
    </div>
  `;
}

function extensionBadge() {
  const label = !state.extensionConnected
    ? '等待连接抓取扩展'
    : state.weiboSession?.verified !== true
      ? '扩展已连接 · 登录状态待确认'
    : state.weiboSession?.available
      ? '扩展已连接 · 微博已登录'
      : '扩展已连接 · 微博未登录';
  return `
    <span class="extension-status ${state.extensionConnected ? 'is-connected' : 'is-disconnected'}">
      <i aria-hidden="true"></i>
      ${label}
    </span>
  `;
}

function archiveItem(article, index) {
  const author = article.author ? escapeHtml(article.author) : '作者未填写';
  return `
    <a class="archive-item" href="#/articles/${article.id}">
      <span class="archive-index">${String(index).padStart(2, '0')}</span>
      <div class="archive-main">
        <h3 class="archive-title">${escapeHtml(article.title)}</h3>
        <div class="archive-meta">
          <span>${author}</span>
          <span>${article.chapterCount || 0} 篇</span>
          <time datetime="${escapeHtml(article.updatedAt)}">${formatDate(article.updatedAt)}</time>
          ${article.status === 'error' ? '<span class="error-label">需要重试</span>' : ''}
        </div>
        ${article.description
          ? `<p class="archive-description">${escapeHtml(excerpt(article.description))}</p>`
          : ''}
      </div>
      <span class="archive-arrow" aria-hidden="true">→</span>
    </a>
  `;
}

function homeTemplate(data) {
  const visibleItems = data.items.filter((item) => item.id !== state.pendingDelete);
  const list = visibleItems.length
    ? `<div class="archive-list">${visibleItems
        .map((article, index) => archiveItem(article, (data.page - 1) * data.limit + index + 1))
        .join('')}</div>`
    : `
      <div class="empty-state">
        <div>
          <strong>${state.home.query ? '没有找到相符的归档' : '书架还是空的'}</strong>
          <p>${state.home.query
            ? '换一个标题或作者关键词再找找。'
            : '安装扩展后，从上方粘贴第一篇微博长文。保存内容只会留在这个浏览器里。'}</p>
        </div>
      </div>
    `;
  const pagination = data.pages > 1
    ? `
      <nav class="pagination" aria-label="归档分页">
        <button type="button" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>← 上一页</button>
        <span>${data.page} / ${data.pages}</span>
        <button type="button" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>下一页 →</button>
      </nav>
    `
    : '';

  return `
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-inner">
        <div class="hero-topline">
          <p class="eyebrow">LOCAL-FIRST · OPEN SOURCE</p>
          ${extensionBadge()}
        </div>
        <div class="hero-layout">
          <div class="hero-message">
            <h1 class="hero-title" id="hero-title">把微博长文，<br>保存到自己的浏览器。</h1>
            <p class="hero-copy">自动寻找后续、整理正文并保存在本机。没有账号，没有云端数据库，你的归档只属于你。</p>
          </div>
          <div class="capture-area">
          <form class="capture-form" id="capture-form" novalidate>
            <div class="field">
              <label for="article-url">微博文章链接</label>
              <input
                id="article-url"
                name="url"
                type="url"
                inputmode="url"
                autocomplete="url"
                placeholder="https://weibo.com/ttarticle/…"
                required
                aria-describedby="capture-error"
              >
            </div>
            <button class="primary-button" type="submit">保存到本机</button>
          </form>
          <p class="capture-note">
            <span aria-hidden="true">✓</span>
            正文与图片文字均在浏览器本地处理
          </p>
          <p class="ocr-limit-note">
            <strong>图片识别提示</strong>
            图片文字识别仅作辅助，可能有错字或遗漏；中文长图、小字和复杂排版尤其容易不准，请以原图为准。
          </p>
          <p class="form-error" id="capture-error" hidden></p>

          <details class="advanced-settings" id="capture-settings">
            <summary>补充归档资料</summary>
            <div class="advanced-grid">
              <div class="field">
                <label for="article-title">归档标题（可选）</label>
                <input id="article-title" name="title" form="capture-form" placeholder="默认沿用文章标题">
              </div>
              <div class="field">
                <label for="article-author">作者（可选）</label>
                <input id="article-author" name="author" form="capture-form" placeholder="便于以后查找">
              </div>
            </div>
            <div class="field">
              <label for="article-description">归档说明（可选）</label>
              <textarea id="article-description" name="description" form="capture-form" placeholder="记下这组文章的主题或来源"></textarea>
            </div>
          </details>

          <details class="advanced-settings local-settings" id="local-settings">
            <summary>本地访问设置</summary>
            <form id="credentials-form">
              <div class="advanced-grid is-single">
                <div class="field">
                  <label for="weibo-cookie">手动 Cookie（可选）</label>
                  <input
                    id="weibo-cookie"
                    name="cookie"
                    type="password"
                    autocomplete="off"
                    value="${escapeHtml(state.credentials.cookie)}"
                    placeholder="扩展无法读取登录状态时再填写"
                  >
                </div>
              </div>
              <label class="setting-toggle">
                <input
                  name="ocrEnabled"
                  type="checkbox"
                  ${state.ocrEnabled ? 'checked' : ''}
                >
                <span>
                  <strong>自动识别图片文字</strong>
                  <small>图片由扩展读取，并在此浏览器中完成识别。结果仅用于辅助检索，可能有错字或遗漏，请以原图为准。</small>
                </span>
              </label>
              <div class="settings-footer">
                <p class="privacy-note">手动 Cookie 保存在此浏览器的 IndexedDB 中，并由扩展导入本机的微博 Cookie 存储。它不会上传到微存服务器——微存没有服务器。</p>
                <button class="secondary-button" type="submit">保存本地设置</button>
              </div>
            </form>
          </details>

          <div class="job-progress" id="capture-progress" hidden>
            <span class="progress-mark" aria-hidden="true"></span>
            <div class="progress-copy">
              <strong>正在准备</strong>
              <span>每完成一篇都会立即写入本机，关闭页面前请等待当前篇完成。</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    </section>

    <section class="archive-section" id="archive" aria-labelledby="archive-title">
      <header class="section-heading">
        <div>
          <p class="section-kicker">ONLY ON THIS DEVICE</p>
          <h2 class="section-title" id="archive-title">我的归档</h2>
        </div>
        <span class="archive-count">${data.total} 份本地内容</span>
      </header>
      <div class="archive-tools">
        <div class="backup-actions">
          <button class="text-button" id="backup-all" type="button">备份全部</button>
          <label class="text-button file-button">
            恢复备份
            <input id="restore-backup" type="file" accept="application/json,.json">
          </label>
        </div>
        <form class="search-field" id="search-form" role="search">
          <label class="visually-hidden" for="archive-search">搜索归档</label>
          <input id="archive-search" name="query" value="${escapeHtml(state.home.query)}" placeholder="搜索标题或作者">
          <button type="submit">查找</button>
        </form>
      </div>
      ${list}
      ${pagination}
    </section>

    <section class="guide-section" id="guide" aria-labelledby="guide-title">
      <div class="guide-intro">
        <p class="section-kicker">START IN FOUR STEPS</p>
        <h2 class="section-title" id="guide-title">网站很轻，<br>隐私很重。</h2>
        <p>扩展只解决浏览器无法跨域读取微博的问题。解析、保存、搜索和导出都在前端完成。</p>
      </div>
      <div class="guide-steps">
        <article class="guide-step">
          <div>
            <h3>安装抓取扩展</h3>
            <p>在 Chromium 的扩展管理页打开开发者模式，选择“加载已解压的扩展程序”，指向项目中的 <code>extension/</code> 目录。</p>
            <a
              class="guide-download"
              href="https://github.com/DriftingBoats/weibo-article-archive/releases/latest/download/weicun-extension.zip"
            >下载微存扩展 <span aria-hidden="true">↓</span></a>
          </div>
        </article>
        <article class="guide-step">
          <div>
            <h3>确认绿色连接状态</h3>
            <p>扩展成功注入后，首页会显示“抓取扩展已连接”。扩展只响应微存页面发出的固定微博接口请求。</p>
          </div>
        </article>
        <article class="guide-step">
          <div>
            <h3>保存正文与图片文字</h3>
            <p>粘贴文章链接后，正文会立即归档；图片由扩展读取，并在当前浏览器中完成中英文 OCR。</p>
          </div>
        </article>
        <article class="guide-step">
          <div>
            <h3>阅读、更新与带走</h3>
            <p>同一链接会自动检查后续；识别结果保留在图片原位置，可导出为 TXT、Markdown 或 JSON。</p>
          </div>
        </article>
      </div>
    </section>
  `;
}

async function renderHome({ preserveScroll = false } = {}) {
  if (!preserveScroll) loadingPage();
  try {
    const data = await archive.listArticles({
      query: state.home.query,
      page: state.home.page,
      limit: 12
    });
    app.innerHTML = homeTemplate(data);
    bindHomeEvents();
    const section = ['#archive', '#guide'].includes(location.hash) ? location.hash : '';
    if (section && !preserveScroll) {
      requestAnimationFrame(() => document.querySelector(section)?.scrollIntoView());
    }
  } catch (error) {
    app.innerHTML = `<div class="loading-page"><p class="reader-error">${escapeHtml(error.message)}</p></div>`;
  }
}

function setProgress(status, message, detail = '') {
  const progress = document.querySelector('#capture-progress');
  if (!progress) return;
  progress.hidden = false;
  progress.className = `job-progress is-${status}`;
  progress.querySelector('strong').textContent = message;
  progress.querySelector('span:last-child').textContent =
    detail || '每完成一篇都会立即写入这个浏览器。';
}

async function saveCredentials(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  state.credentials = cookieCredentials(values);
  state.ocrEnabled = values.ocrEnabled === 'on';
  await archive.setSetting('credentials', state.credentials);
  await archive.setSetting('ocrEnabled', state.ocrEnabled);
}

function bindHomeEvents() {
  document.querySelector('#credentials-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveCredentials(event.currentTarget);
    showToast('访问设置已保存在这个浏览器。');
  });

  const captureForm = document.querySelector('#capture-form');
  captureForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector('#capture-error');
    const submitButton = captureForm.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(captureForm).entries());
    errorElement.hidden = true;

    if (!payload.url?.trim()) {
      errorElement.textContent = '请先粘贴一篇微博文章链接。';
      errorElement.hidden = false;
      document.querySelector('#article-url').focus();
      return;
    }
    if (!state.extensionConnected) {
      state.extensionConnected = await bridge.ping();
      state.weiboSession = bridge.sessionStatus;
      if (!state.extensionConnected) {
        errorElement.textContent = '还没有检测到抓取扩展。请先按下方说明安装并刷新页面。';
        errorElement.hidden = false;
        document.querySelector('#guide')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }

    submitButton.disabled = true;
    submitButton.textContent = '正在保存';
    setProgress('running', '正在连接微博…');
    try {
      const result = await crawler.archiveFromUrl({
        ...payload,
        credentials: state.credentials,
        ocrEnabled: state.ocrEnabled,
        onProgress: (progress) => {
          setProgress('running', progress.message, `已经处理到第 ${progress.current} 篇。`);
        }
      });
      setProgress(
        'completed',
        result.added ? `完成，共新增 ${result.added} 篇。` : '已是最新，没有发现后续。',
        '正在打开本地阅读页…'
      );
      setTimeout(() => {
        location.hash = `#/articles/${result.article.id}`;
      }, 450);
    } catch (error) {
      setProgress('failed', '这次没有保存成功', error.message);
      errorElement.textContent = error.message;
      errorElement.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = '保存到本机';
    } finally {
      await imageOcr.terminate();
    }
  });

  document.querySelector('#search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    state.home.query = String(new FormData(event.currentTarget).get('query') || '').trim();
    state.home.page = 1;
    renderHome({ preserveScroll: true });
  });

  document.querySelector('#backup-all')?.addEventListener('click', async () => {
    const backup = await archive.createBackup();
    downloadBackup(backup);
    showToast(`已备份 ${backup.articles.length} 份本地归档。`);
  });

  document.querySelector('#restore-backup')?.addEventListener('change', async (event) => {
    const [file] = event.currentTarget.files;
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('备份文件超过 50 MB，无法在浏览器中安全导入。');
      const result = await archive.restoreBackup(JSON.parse(await file.text()));
      showToast(`已恢复 ${result.articles} 份归档、${result.chapters} 篇正文。`);
      await renderHome({ preserveScroll: true });
    } catch (error) {
      showToast(error.message);
    } finally {
      event.currentTarget.value = '';
    }
  });

  document.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      state.home.page = Number(button.dataset.page);
      renderHome();
    });
  });
}

function detailTemplate(article, chapters) {
  const chapterButtons = chapters.map((chapter) => `
    <button class="chapter-button${chapter.index === state.activeChapter ? ' is-active' : ''}" type="button" data-chapter="${chapter.index}">
      <span>${String(chapter.index).padStart(2, '0')}</span>
      <span>${escapeHtml(chapter.title)}</span>
    </button>
  `).join('');

  return `
    <article class="article-shell">
      <a class="article-back" href="#archive">← 返回归档</a>
      <header class="article-header">
        <div>
          <span class="article-label">${article.status === 'error' ? 'NEEDS ATTENTION' : 'LOCAL ARCHIVE'}</span>
          <h1 class="article-heading">${escapeHtml(article.title)}</h1>
          ${article.author ? `<p class="article-byline">作者 · ${escapeHtml(article.author)}</p>` : ''}
        </div>
        <dl class="article-facts">
          <div><dt>篇数</dt><dd>${article.chapterCount || 0} 篇</dd></div>
          <div><dt>首次保存</dt><dd>${formatDate(article.createdAt)}</dd></div>
          <div><dt>最近更新</dt><dd>${formatDate(article.updatedAt)}</dd></div>
          <div><dt>存储位置</dt><dd>当前浏览器</dd></div>
          <div><dt>来源</dt><dd><a href="${escapeHtml(article.sourceUrl)}" target="_blank" rel="noreferrer">查看微博原文 ↗</a></dd></div>
        </dl>
      </header>

      <div class="article-actions">
        <button class="secondary-button" id="refresh-article" type="button">检查更新</button>
        <button class="secondary-button" id="recognize-images" type="button" aria-describedby="article-ocr-limit">识别图片文字</button>
        <details class="download-group">
          <summary class="secondary-button">导出归档</summary>
          <div class="download-menu">
            <button type="button" data-export="txt">TXT 文本</button>
            <button type="button" data-export="md">Markdown</button>
            <button type="button" data-export="json">JSON 数据</button>
          </div>
        </details>
        <details class="download-group metadata-editor">
          <summary class="secondary-button">编辑资料</summary>
          <form class="download-menu" id="metadata-form">
            <label class="field">
              <span>标题</span>
              <input name="title" value="${escapeHtml(article.title)}" required>
            </label>
            <label class="field">
              <span>作者</span>
              <input name="author" value="${escapeHtml(article.author)}">
            </label>
            <label class="field">
              <span>说明</span>
              <textarea name="description">${escapeHtml(article.description)}</textarea>
            </label>
            <button class="secondary-button" type="submit">保存资料</button>
          </form>
        </details>
        <button class="text-button danger-button" id="delete-article" type="button">从本机删除</button>
      </div>
      <p class="ocr-limit-note article-ocr-limit" id="article-ocr-limit">
        <strong>图片识别提示</strong>
        识别结果可能有错字或遗漏，中文长图、小字和复杂排版尤其容易不准，请以原图为准。
      </p>

      ${article.errorMessage ? `<p class="form-error">${escapeHtml(article.errorMessage)}</p>` : ''}
      ${article.description ? `<p class="hero-copy article-description">${escapeHtml(article.description)}</p>` : ''}

      <div class="reader-layout">
        <nav class="chapter-nav" aria-label="文章目录">
          <p class="chapter-nav-title">CONTENTS · ${chapters.length}</p>
          <div class="chapter-list">${chapterButtons}</div>
        </nav>
        <section class="reader" id="reader" aria-live="polite">
          <div class="loading-line"></div>
        </section>
      </div>
    </article>
  `;
}

function contentHtml(content, images = []) {
  const imageByMarker = new Map(images.map((image) => [image.marker, image]));
  return String(content || '')
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => {
      const clean = paragraph.trim();
      if (/^\[图片(?: \d+)?(?:[：:].*)?\]$/.test(clean)) {
        const image = imageByMarker.get(clean);
        if (!image) return `<span class="image-marker">${escapeHtml(clean)}</span>`;
        const ocrCopy = image.ocrStatus === 'done'
          ? `<div class="image-ocr"><span>图片文字</span><p>${escapeHtml(image.ocrText).replaceAll('\n', '<br>')}</p></div>`
          : image.ocrStatus === 'error'
            ? `<p class="image-ocr-note">识别失败：${escapeHtml(image.ocrError || '无法读取或识别这张图片。')} 可点击页面上方“识别图片文字”重试。</p>`
            : image.ocrStatus === 'empty'
              ? '<p class="image-ocr-note">没有在这张图片中识别到文字。</p>'
              : '<p class="image-ocr-note">这张图片尚未进行文字识别。</p>';
        const imageUrl = String(image.url || '').trim();
        const imageView = imageUrl
          ? `
            <img
              src="${escapeHtml(imageUrl)}"
              data-image-source="${escapeHtml(imageUrl)}"
              alt="${escapeHtml(image.alt || `文章配图 ${image.index}`)}"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            >
            <figcaption>
              <span>文章配图 ${image.index}</span>
              <button type="button" data-open-image="${escapeHtml(imageUrl)}">查看原图 ↗</button>
            </figcaption>
          `
          : `
            <span class="image-marker">原图地址缺失</span>
            <figcaption><span>文章配图 ${image.index}</span></figcaption>
          `;
        return `
          <figure class="archive-image">
            ${imageView}
            ${ocrCopy}
          </figure>
        `;
      }
      return `<p>${escapeHtml(clean).replaceAll('\n', '<br>')}</p>`;
    })
    .join('');
}

async function loadChapter(index) {
  const reader = document.querySelector('#reader');
  if (!reader || !state.article) return;
  state.activeChapter = index;
  document.querySelectorAll('[data-chapter]').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.chapter) === index);
  });
  reader.innerHTML = '<div class="loading-line"></div>';
  try {
    const chapter = await archive.getChapter(state.article.id, index);
    if (!chapter) throw new Error('没有在本机找到这一篇正文。');
    reader.innerHTML = `
      <p class="reader-chapter-number">CHAPTER ${String(index).padStart(2, '0')}</p>
      <h2 class="reader-title">${escapeHtml(chapter.title)}</h2>
      <div class="reader-content">${contentHtml(chapter.content, chapter.images || [])}</div>
      <nav class="chapter-pager" aria-label="前后篇">
        <button type="button" data-go-chapter="${index - 1}" ${index <= 1 ? 'disabled' : ''}>← 上一篇</button>
        <button type="button" data-go-chapter="${index + 1}" ${index >= state.chapters.length ? 'disabled' : ''}>下一篇 →</button>
      </nav>
    `;
    bindArchiveImageEvents(reader);
    reader.querySelectorAll('[data-go-chapter]').forEach((button) => {
      button.addEventListener('click', () => {
        loadChapter(Number(button.dataset.goChapter));
        document.querySelector('.reader-layout')?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  } catch (error) {
    reader.innerHTML = `<p class="reader-error">${escapeHtml(error.message)}</p>`;
  }
}

function bindDetailEvents() {
  document.querySelectorAll('[data-chapter]').forEach((button) => {
    button.addEventListener('click', () => {
      loadChapter(Number(button.dataset.chapter));
      if (window.innerWidth < 768) {
        document.querySelector('#reader')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  document.querySelector('#refresh-article')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在检查…';
    try {
      const result = await crawler.refresh({
        articleId: state.article.id,
        credentials: state.credentials,
        ocrEnabled: state.ocrEnabled,
        onProgress: (progress) => {
          button.textContent = progress.message;
        }
      });
      showToast(result.added ? `完成，共新增 ${result.added} 篇。` : '已是最新，没有发现后续。');
      await renderArticle(state.article.id);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = '检查更新';
    } finally {
      await imageOcr.terminate();
    }
  });

  document.querySelector('#recognize-images')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在准备识别…';
    try {
      const result = await crawler.recognizeArticleImages({
        articleId: state.article.id,
        credentials: state.credentials,
        onProgress: (progress) => {
          button.textContent = progress.message;
        }
      });
      if (!result.imageCount) {
        showToast('没有在这些文章中找到可识别的图片。');
      } else if (!result.recognized) {
        showToast(`已检查 ${result.imageCount} 张图片，没有新的识别结果。`);
      } else {
        showToast(`完成，新增识别 ${result.recognized} 张图片。`);
      }
      await renderArticle(state.article.id);
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = '识别图片文字';
    }
  });

  document.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', async () => {
      const chapters = await archive.listChapters(state.article.id, { includeContent: true });
      downloadArchive(state.article, chapters, button.dataset.export);
      button.closest('details')?.removeAttribute('open');
    });
  });

  document.querySelector('#metadata-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const article = await archive.getArticle(state.article.id);
    article.title = String(values.title || '').trim() || article.title;
    article.author = String(values.author || '').trim();
    article.description = String(values.description || '').trim();
    article.updatedAt = new Date().toISOString();
    await archive.putArticle(article);
    showToast('资料已经保存在本机。');
    await renderArticle(article.id);
  });

  document.querySelector('#delete-article')?.addEventListener('click', () => {
    const shell = document.querySelector('.article-shell');
    shell.style.opacity = '0.35';
    shell.style.pointerEvents = 'none';
    const articleId = state.article.id;
    state.pendingDelete = articleId;
    let cancelled = false;
    const deletionTimer = setTimeout(async () => {
      if (cancelled) return;
      await archive.deleteArticle(articleId);
      state.pendingDelete = null;
      location.hash = '#archive';
    }, 5000);
    showToast('本地归档将在 5 秒后删除。', '撤销删除', () => {
      cancelled = true;
      clearTimeout(deletionTimer);
      state.pendingDelete = null;
      shell.style.opacity = '';
      shell.style.pointerEvents = '';
    });
  });
}

async function renderArticle(id) {
  loadingPage();
  try {
    const article = await archive.getArticle(id);
    if (!article) throw new Error('没有在这个浏览器中找到这份归档。');
    const chapters = await archive.listChapters(id);
    state.article = article;
    state.chapters = chapters;
    state.activeChapter = Math.min(
      Math.max(1, state.activeChapter),
      Math.max(1, chapters.length)
    );
    app.innerHTML = detailTemplate(article, chapters);
    bindDetailEvents();
    if (chapters.length) await loadChapter(state.activeChapter);
    else document.querySelector('#reader').innerHTML = '<p class="reader-error">这份归档还没有正文。</p>';
    document.title = `${article.title}｜微存`;
  } catch (error) {
    app.innerHTML = `
      <div class="loading-page">
        <div>
          <p class="reader-error">${escapeHtml(error.message)}</p>
          <a class="secondary-button" href="#/">返回首页</a>
        </div>
      </div>
    `;
  }
}

async function route() {
  const articleMatch = location.hash.match(/^#\/articles\/([0-9a-f-]+)$/i);
  if (articleMatch) {
    await renderArticle(articleMatch[1]);
    return;
  }
  document.title = '微存｜把散落的长文收进自己的书页';
  await renderHome();
}

async function initialize() {
  const savedCredentials = await archive.getSetting('credentials', { cookie: '' });
  state.credentials = cookieCredentials(savedCredentials);
  if (JSON.stringify(savedCredentials) !== JSON.stringify(state.credentials)) {
    await archive.setSetting('credentials', state.credentials);
  }
  state.ocrEnabled = await archive.getSetting('ocrEnabled', true);
  state.extensionConnected = await bridge.ping();
  state.weiboSession = bridge.sessionStatus;
  window.addEventListener('weicun:extension-ready', async () => {
    state.extensionConnected = await bridge.ping();
    state.weiboSession = bridge.sessionStatus;
    const badge = document.querySelector('.extension-status');
    if (badge) {
      const replacement = document.createElement('template');
      replacement.innerHTML = extensionBadge().trim();
      badge.replaceWith(replacement.content.firstElementChild);
    }
  });
  window.addEventListener('weicun:extension-invalidated', () => {
    state.extensionConnected = false;
    const badge = document.querySelector('.extension-status');
    if (badge) badge.outerHTML = extensionBadge();
    showToast(
      '扩展刚刚更新，需要刷新当前页面才能重新连接。',
      '立即刷新',
      () => location.reload(),
      15_000
    );
  });
  window.addEventListener('hashchange', route);
  await route();
}

initialize();
