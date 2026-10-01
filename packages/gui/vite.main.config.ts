import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      'process.env.GITHUB_CLIENT_ID': JSON.stringify(env.GITHUB_CLIENT_ID ?? ''),
      'process.env.SYNCTHIS_RELEASE_REPO': JSON.stringify(
        env.SYNCTHIS_RELEASE_REPO ?? process.env.SYNCTHIS_RELEASE_REPO ?? '',
      ),
    },
    build: {
      rollupOptions: {
        // dugite uses __dirname to locate its bundled git binary —
        // bundling it would break that path resolution
        external: ['dugite'],
      },
    },
  };
});
