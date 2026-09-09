import { createHashRouter } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { HomePage } from './pages/HomePage'
import { SectionPage } from './pages/SectionPage'
import { ProgressPage } from './pages/ProgressPage'
import { JudgeLabPage } from './pages/JudgeLabPage'
import { NotFoundPage } from './pages/NotFoundPage'

/**
 * HashRouter：GitHub Pages 项目页跑在 /<repo>/ 子路径下，
 * 没有服务端 rewrite 可用，BrowserRouter 刷新深链必然 404。
 * 配合 vite base: './' 实现零配置部署。
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'problems', element: <SectionPage /> },
      // 阶段 4 题目详情页。用 problems/p/:id 而不是 problems/:id：后者会与下面的
      // problems/:section 同层歧义（React Router 靠静态段优先级能分辨，但显式加 p 更好读）
      //
      // 路由级 lazy：详情页拖着判分层 + 三个 Renderer（其中程序填空还拖着整套 CodeMirror 6）。
      // 静态 import 会让首页也付这份体积（实测主 chunk 505 kB），拆出去后首页零成本。
      {
        path: 'problems/p/:id',
        lazy: async () => {
          const mod = await import('./pages/ProblemDetailPage')
          return { Component: mod.ProblemDetailPage }
        },
        // lazy 路由会让「首屏直接落在题目深链」这一次渲染变成 React Router 的 hydration，
        // 不给 HydrateFallback 就会在控制台打一条 warning（模块 3 UI 验收实测抓到）。
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载题目页…</p>
        ),
      },
      { path: 'problems/:section', element: <SectionPage /> },
      { path: 'knowledge', element: <SectionPage /> },
      { path: 'knowledge/:section', element: <SectionPage /> },
      { path: 'viz', element: <SectionPage /> },
      { path: 'viz/:section', element: <SectionPage /> },
      { path: 'progress', element: <ProgressPage /> },
      // 阶段 2 的判分实测台，阶段 4 判分器进刷题页后可移除
      { path: 'judge-lab', element: <JudgeLabPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])