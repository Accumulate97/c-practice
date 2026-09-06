import { createHashRouter } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { HomePage } from './pages/HomePage'
import { SectionPage } from './pages/SectionPage'
import { ProgressPage } from './pages/ProgressPage'
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
      { path: 'problems/:section', element: <SectionPage /> },
      { path: 'knowledge', element: <SectionPage /> },
      { path: 'knowledge/:section', element: <SectionPage /> },
      { path: 'viz', element: <SectionPage /> },
      { path: 'viz/:section', element: <SectionPage /> },
      { path: 'progress', element: <ProgressPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])