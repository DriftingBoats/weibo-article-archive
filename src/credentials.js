export function cookieCredentials(value = {}) {
  return {
    cookie: String(value?.cookie || '').trim()
  };
}
