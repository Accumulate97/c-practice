import { createHashRouter } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { HomePage } from './pages/HomePage'
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
      // 阶段 4 模块 5：刷题入口 /#/problems（原先指向 SectionPage 占位）。
      // 列表页只 fetch 索引（518 条 / 190 KB），本体不含判分层与 CodeMirror，但仍走路由级 lazy：
      // 与详情页同一口径 —— 首页不为刷题页付一分钱体积。
      {
        path: 'problems',
        lazy: async () => {
          const mod = await import('./pages/ProblemListPage')
          return { Component: mod.ProblemListPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载题库索引…</p>
        ),
      },
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
      // 阶段 10-1：知识板块从 SectionPage 占位换成真页面（列表 + 详情），与题目 / 演示同一口径走路由级 lazy。
      // 同时删掉 problems/:section —— 列表页早改用 ?chapter= 查询参数，这条只会让打错的深链
      // 落到一张「阶段 4 待办」的过期占位卡，不如直接交给下面的 404。
      {
        path: 'knowledge',
        lazy: async () => {
          const mod = await import('./pages/KnowledgeListPage')
          return { Component: mod.KnowledgeListPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载知识卡片索引…</p>
        ),
      },
      {
        path: 'knowledge/:id',
        lazy: async () => {
          const mod = await import('./pages/KnowledgeDetailPage')
          return { Component: mod.KnowledgeDetailPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载知识卡片…</p>
        ),
      },
      // 阶段 7：可视化板块从「诚实占位」换成真页面。三条都走路由级 lazy ——
      // 5 套渲染器 + Player + 语料 loader 不该由首页付体积（与题目详情页同一口径）。
      // 顺序有讲究：静态段 viz/compare 必须声明在 viz/:demoId 之前，否则 compare 会被当成演示 id。
      {
        path: 'viz',
        lazy: async () => {
          const mod = await import('./pages/VizListPage')
          return { Component: mod.VizListPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载演示索引…</p>
        ),
      },
      {
        path: 'viz/compare',
        lazy: async () => {
          const mod = await import('./pages/VizComparePage')
          return { Component: mod.VizComparePage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载对比演示…</p>
        ),
      },
      {
        path: 'viz/:demoId',
        lazy: async () => {
          const mod = await import('./pages/VizDemoPage')
          return { Component: mod.VizDemoPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载演示…</p>
        ),
      },
      // 任务 2：3D 可视化馆。两条都走路由级 lazy —— three + fiber + drei 未压缩约 1.2 MB，
      // 绝不能由首页 / 列表页付体积。列表页只 import catalog（纯数据表），
      // 演示页才经 sceneRegistry 引到 three；这条边界由 acceptance-viz3d-ui.mjs 守着。
      {
        path: 'viz3d',
        lazy: async () => {
          const mod = await import('./pages/Viz3DListPage')
          return { Component: mod.Viz3DListPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载 3D 馆目录…</p>
        ),
      },
      {
        path: 'viz3d/:demoId',
        lazy: async () => {
          const mod = await import('./pages/Viz3DDemoPage')
          return { Component: mod.Viz3DDemoPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载 3D 演示（首次进入需下载 three.js）…</p>
        ),
      },
      // 阶段 10-3：原书勘误表。内容是 data/errata.md（由 build:index 从 docs/errata.md 拷来），
      // 页面本身只有一个 Markdown 渲染器，仍走路由级 lazy，首页不为它付体积。
      {
        path: 'errata',
        lazy: async () => {
          const mod = await import('./pages/ErrataPage')
          return { Component: mod.ErrataPage }
        },
        HydrateFallback: () => (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>正在加载勘误表…</p>
        ),
      },
      { path: 'progress', element: <ProgressPage /> },
      // 阶段 2 的判分实测台，阶段 4 判分器进刷题页后可移除
      { path: 'judge-lab', element: <JudgeLabPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])