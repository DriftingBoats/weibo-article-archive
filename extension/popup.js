import { checkForUpdate } from './update.js';

const session = document.querySelector('#session');
const sessionTitle = document.querySelector('#session-title');
const sessionCopy = document.querySelector('#session-copy');
const refreshButton = document.querySelector('#refresh-session');
let refreshing = false;
const currentVersion = chrome.runtime.getManifest().version;
const update = document.querySelector('#update');
const updateTitle = document.querySelector('#update-title');
const updateCopy = document.querySelector('#update-copy');
const updateAction = document.querySelector('#update-action');
let latestDownloadUrl = '';
let checkingUpdate = false;

document.querySelector('#version').textContent = `v${currentVersion}`;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('登录验证超过 12 秒，已停止等待。'));
    }, 12_000);
    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timeout);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function renderSession(status) {
  if (status.verified === false) {
    session.className = 'session is-unknown';
    sessionTitle.textContent = '微博页面验证未完成';
    sessionCopy.textContent = status.verificationError
      ? `失败原因：${status.verificationError}`
      : '请打开微博首页并保持登录，然后点击“刷新状态”。';
    return;
  }
  session.className = `session ${status.available ? 'is-ready' : 'is-missing'}`;
  sessionTitle.textContent = status.available ? '微博已登录' : '微博未登录';
  sessionCopy.textContent = status.available
    ? '微博服务器已确认当前登录状态，抓取请求会自动使用。'
    : '公开内容仍可抓取；登录后可读取你有权访问的内容。';
}

async function refreshSession(force = false) {
  if (refreshing) return;
  refreshing = true;
  refreshButton.disabled = true;
  refreshButton.textContent = '刷新中…';
  session.setAttribute('aria-busy', 'true');
  session.className = 'session';
  sessionTitle.textContent = '正在刷新微博登录状态';
  sessionCopy.textContent = '正在微博页面环境中确认当前用户…';
  try {
    const response = await sendRuntimeMessage({
      type: 'GET_WEIBO_SESSION_STATUS',
      payload: { force }
    });
    if (!response?.ok) throw new Error(response?.error || '没有收到状态');
    renderSession(response.result);
  } catch (error) {
    session.className = 'session is-missing';
    sessionTitle.textContent = '暂时无法读取登录状态';
    sessionCopy.textContent = `失败原因：${error.message || '扩展后台没有返回结果。'}`;
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
    refreshButton.textContent = '刷新状态';
    session.removeAttribute('aria-busy');
  }
}

async function refreshUpdate() {
  if (checkingUpdate) return;
  checkingUpdate = true;
  latestDownloadUrl = '';
  update.className = 'update is-checking';
  updateTitle.textContent = '正在检查更新';
  updateCopy.textContent = `当前版本 v${currentVersion}`;
  updateAction.disabled = true;
  updateAction.textContent = '检查中…';
  try {
    const result = await checkForUpdate(currentVersion);
    if (result.updateAvailable) {
      latestDownloadUrl = result.downloadUrl;
      update.className = 'update is-available';
      updateTitle.textContent = `发现新版 v${result.latestVersion}`;
      updateCopy.textContent = `当前 v${result.currentVersion}，下载后覆盖旧扩展目录。`;
      updateAction.textContent = '下载更新';
    } else {
      update.className = 'update is-current';
      updateTitle.textContent = '已是最新版';
      updateCopy.textContent = `当前版本 v${result.currentVersion}`;
      updateAction.textContent = '再次检查';
    }
  } catch (error) {
    update.className = 'update is-error';
    updateTitle.textContent = '暂时无法检查更新';
    updateCopy.textContent = error.message || '请稍后重试。';
    updateAction.textContent = '重新检查';
  } finally {
    checkingUpdate = false;
    updateAction.disabled = false;
  }
}

document.querySelector('#open-site').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://driftingboats.github.io/weibo-article-archive/'
  });
});

document.querySelector('#open-weibo').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://weibo.com/' });
});

updateAction.addEventListener('click', () => {
  if (!latestDownloadUrl) {
    refreshUpdate();
    return;
  }
  chrome.tabs.create({ url: latestDownloadUrl });
  update.className = 'update is-downloading';
  updateTitle.textContent = '新版已开始下载';
  updateCopy.textContent = '解压覆盖旧目录，再到扩展管理页点击“重新加载”。';
  updateAction.textContent = '再次下载';
});

refreshButton.addEventListener('click', () => refreshSession(true));
refreshSession(false);
refreshUpdate();
