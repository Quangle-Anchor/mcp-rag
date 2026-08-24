import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Vite logs proxy errors directly to the terminal
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error(`\x1b[31m[PROXY ERROR]\x1b[0m ${req.method} ${req.url} → ${err.message}`);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log(`\x1b[36m[PROXY]\x1b[0m ${req.method} ${req.url}`);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            const color = proxyRes.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
            console.log(`${color}[PROXY ${proxyRes.statusCode}]\x1b[0m ${req.method} ${req.url}`);
          });
        },
      },
    },
  },
})
