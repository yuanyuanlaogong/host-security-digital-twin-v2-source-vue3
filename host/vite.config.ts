import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const { VITE_RPC_PROXY_URL } = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      vueDevTools(),
    ],
    server: {
      proxy: VITE_RPC_PROXY_URL
        ? {
            '/rpc': {
              target: VITE_RPC_PROXY_URL,
              changeOrigin: true,
              secure: true,
            },
          }
        : {},
    },
    optimizeDeps: {
      include: ['three', 'vue-router'],
      force: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
