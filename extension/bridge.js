const WEB_SOURCE = 'weicun-web';
const EXTENSION_SOURCE = 'weicun-extension';
const ALLOWED_TYPES = new Set(['PING', 'FETCH_ARTICLE_ENDPOINT', 'FETCH_WEIBO_IMAGE']);

function respond(requestId, response) {
  window.postMessage({
    source: EXTENSION_SOURCE,
    requestId,
    ...response
  }, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== WEB_SOURCE ||
    !ALLOWED_TYPES.has(event.data?.type) ||
    typeof event.data?.requestId !== 'string'
  ) {
    return;
  }

  chrome.runtime.sendMessage({
    type: event.data.type,
    requestId: event.data.requestId,
    payload: event.data.payload || {}
  }).then(
    (response) => {
      if (!response?.ok) {
        respond(event.data.requestId, {
          ok: false,
          error: response?.error || '扩展没有返回有效结果。'
        });
        return;
      }
      respond(event.data.requestId, { ok: true, result: response.result });
    },
    (error) => respond(event.data.requestId, {
      ok: false,
      error: error.message || '扩展请求失败。'
    })
  );
});

window.postMessage({
  source: EXTENSION_SOURCE,
  type: 'READY'
}, window.location.origin);
