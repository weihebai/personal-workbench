import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // 本地调试时可以指向线上：VITE_API_TARGET=http://39.107.50.150:9096
      '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8080', changeOrigin: true },
      // MCP 端点也走代理：设置页生成的连接地址用的是当前访问的 origin（5173）
      '/mcp': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
