const session = document.querySelector('#session');
const sessionTitle = document.querySelector('#session-title');
const sessionCopy = document.querySelector('#session-copy');

document.querySelector('#version').textContent = `v${chrome.runtime.getManifest().version}`;

function renderSession(status) {
  if (status.verified === false) {
    session.className = 'session is-unknown';
    sessionTitle.textContent = '暂时无法验证微博登录';
    sessionCopy.textContent = '请检查网络，稍后重新打开扩展。';
    return;
  }
  session.className = `session ${status.available ? 'is-ready' : 'is-missing'}`;
  sessionTitle.textContent = status.available ? '微博已登录' : '微博未登录';
  sessionCopy.textContent = status.available
    ? '微博服务器已确认当前登录状态，抓取请求会自动使用。'
    : '公开内容仍可抓取；登录后可读取你有权访问的内容。';
}

async function refreshSession() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_WEIBO_SESSION_STATUS'
    });
    if (!response?.ok) throw new Error(response?.error || '没有收到状态');
    renderSession(response.result);
  } catch {
    session.className = 'session is-missing';
    sessionTitle.textContent = '暂时无法读取登录状态';
    sessionCopy.textContent = '请重新加载扩展后再试。';
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
refreshSession();
