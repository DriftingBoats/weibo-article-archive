const session = document.querySelector('#session');
const sessionTitle = document.querySelector('#session-title');
const sessionCopy = document.querySelector('#session-copy');
const refreshButton = document.querySelector('#refresh-session');
let refreshing = false;

document.querySelector('#version').textContent = `v${chrome.runtime.getManifest().version}`;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
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

async function refreshSession() {
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
      type: 'GET_WEIBO_SESSION_STATUS'
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

document.querySelector('#open-site').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://driftingboats.github.io/weibo-article-archive/'
  });
});

document.querySelector('#open-weibo').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://weibo.com/' });
});

chrome.cookies.onChanged.addListener(refreshSession);
refreshButton.addEventListener('click', refreshSession);
refreshSession();
