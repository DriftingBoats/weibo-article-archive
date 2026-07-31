import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE_PATH || (mode === 'production' ? '/weibo-article-archive/' : '/'),
    build: {
      target: 'es2022',
      sourcemap: true
    },
    server: {
      port: 4173,
      strictPort: true
    },
    preview: {
      port: 4173,
      strictPort: true
    }
  };
});
