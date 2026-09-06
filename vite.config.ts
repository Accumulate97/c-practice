import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// React 运行时的稳定依赖集合，单独切一个 chunk，业务代码迭代时它不会变，
// 从而让浏览器缓存持续命中。
const REACT_RUNTIME = /^.*node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/

// 部署到 GitHub Pages 的项目站点（https://<user>.github.io/C-practice/）时，
// 用相对 base + HashRouter 可做到零配置：任何子目录打开都不会 404。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // 注意：Vite 8 底层是 Rolldown，manualChunks 只接受函数形式，
        // 不接受 Rollup 时代的 { chunkName: [modules] } 对象形式。
        manualChunks(id: string): string | undefined {
          return REACT_RUNTIME.test(id) ? 'react' : undefined
        },
      },
    },
  },
})