import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// React 运行时的稳定依赖集合，单独切一个 chunk，业务代码迭代时它不会变，
// 从而让浏览器缓存持续命中。
const REACT_RUNTIME = /^.*node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/

// 状态层与 babel 助手：zustand（设置 / 进度 store）+ 它的 React 绑定垫片。
// ⚠️ 必须显式切成独立 chunk。这几个包**同时**被入口和 @react-three/fiber 依赖，
// 如果不点名，Rolldown 会把它们并进先声明的 three chunk，于是入口反向静态依赖 three
// （产物里能看到 import{f as g}from"./three-*.js"），Vite 随即在 index.html 里给首页插一条
// <link rel="modulepreload" href="./assets/three-*.js"> —— 「首页零 3D 体积」这条红线当场被打穿。
// 2026-09-13 实测踩过：首页与 ProblemDetailPage 都因此下载了 887 KB 的 three。
const STORE_RUNTIME = /^.*node_modules[\\/](zustand|use-sync-external-store|@babel[\\/]runtime)[\\/]/

// 3D 馆（/viz3d/*）专用运行时：three + react-three-fiber + drei 未压缩约 1.2 MB。
// 单独切一个 chunk，好处有二：① 只有真正打开 3D 演示页才会下载，首页 / 列表页零负担；
// ② 业务代码迭代时这个 chunk 的哈希不变，浏览器缓存持续命中。
// 注意别把 zustand 之类的共享包写进来，见上面 STORE_RUNTIME 的说明。
const THREE_RUNTIME = /^.*node_modules[\\/](@react-three[\\/](?:drei|fiber)|three|three-stdlib|three-mesh-bvh|camera-controls|maath|suspend-react|its-fine|react-use-measure|stats-gl)[\\/]/

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
          if (REACT_RUNTIME.test(id)) return 'react'
          if (STORE_RUNTIME.test(id)) return 'store'
          if (THREE_RUNTIME.test(id)) return 'three'
          return undefined
        },
      },
    },
  },
})
