export function validWeiboImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return (
      url.protocol === 'https:' &&
      (
        url.hostname === 'sinaimg.cn' ||
        url.hostname.endsWith('.sinaimg.cn') ||
        url.hostname === 'weibo.com' ||
        url.hostname.endsWith('.weibo.com')
      )
    );
  } catch {
    return false;
  }
}

export function imageRequestInit(signal) {
  return {
    method: 'GET',
    cache: 'no-cache',
    credentials: 'include',
    redirect: 'follow',
    signal,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  };
}
