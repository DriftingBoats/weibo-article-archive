const WEB_SOURCE = 'weicun-web';
const EXTENSION_SOURCE = 'weicun-extension';
const RESPONSE_TIMEOUT_MS = 30_000;

export class ExtensionBridge {
  constructor(targetWindow = window) {
    this.window = targetWindow;
    this.pending = new Map();
    this.connected = false;
    this.sessionStatus = null;
    this.window.addEventListener('message', (event) => this.handleMessage(event));
  }

  handleMessage(event) {
    if (event.source !== this.window || event.data?.source !== EXTENSION_SOURCE) return;
    if (event.data.type === 'READY') {
      this.connected = true;
      this.window.dispatchEvent(new CustomEvent('weicun:extension-ready'));
      return;
    }
    const pending = this.pending.get(event.data.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(event.data.requestId);
    if (event.data.ok) pending.resolve(event.data.result);
    else pending.reject(new Error(event.data.error || '扩展没有完成这次请求。'));
  }

  request(type, payload = {}, timeoutMs = RESPONSE_TIMEOUT_MS) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('没有收到浏览器扩展的回应，请确认扩展已安装并允许访问当前网站。'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.window.postMessage({
        source: WEB_SOURCE,
        type,
        requestId,
        payload
      }, this.window.location.origin);
    });
  }

  async ping() {
    try {
      const result = await this.request('PING', {}, 2000);
      this.connected = true;
      this.sessionStatus = result.session || null;
      return true;
    } catch {
      this.connected = false;
      this.sessionStatus = null;
      return false;
    }
  }

  fetchEndpoint({ articleId, endpointIndex, cookie = '', token = '' }) {
    return this.request('FETCH_ARTICLE_ENDPOINT', {
      articleId,
      endpointIndex,
      cookie,
      token
    });
  }

  fetchImage(url) {
    return this.request('FETCH_WEIBO_IMAGE', { url }, 45_000);
  }
}
