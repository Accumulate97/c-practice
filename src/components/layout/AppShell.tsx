import { Link, NavLink, Outlet } from 'react-router-dom'
import { APP_NAME, sections } from '../../app/config'
import { ThemeToggle } from './ThemeToggle'

const NAV = [
  { to: '/', label: '首页' },
  // 任务 3-2：学习路径是「学 → 懂 → 练」的编排层，放在三大板块之前当主线入口
  { to: '/path', label: '🗺️ 学习路径' },
  ...sections.map((s) => ({ to: s.path, label: `${s.emoji} ${s.title}` })),
  // 任务 2：3D 馆是「可视化演示」的立体延伸，不是第四个板块 ——
  // 学 / 懂 / 练 的三分法是首页三卡与产品心智的骨架，所以不动 config.sections，只在这里加入口。
  { to: '/viz3d', label: '🧊 3D 馆' },
  { to: '/progress', label: '📈 我的进度' },
]

/**
 * 第二排「工具与复习」：任务 3 新增的板块都归到这里。
 * 主导航守住「学 / 懂 / 练 + 主线 + 进度」的产品心智，工具类入口另起一排，
 * 375px 窄屏下两排各自 flex-wrap，不会挤成一坨。
 */
const TOOLS = [
  // 任务 3-1：游乐场是面向学习者的正式板块（原「判分实测台」退到页脚，它验的是后端链路）
  { to: '/playground', label: '🧪 游乐场' },
]

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-12">
      {/* 无障碍（阶段 10-4）：键盘用户第一个 Tab 就能跳过整条导航 */}
      <a
        href="#main"
        data-role="skip-link"
        onClick={(e) => {
          e.preventDefault()   // HashRouter 会把 #main 当路由，默认行为必须掐掉
          const m = document.getElementById('main')
          m?.focus()
          m?.scrollIntoView({ block: 'start' })
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
      >
        跳到主要内容
      </a>
      <header className="sticky top-0 z-10 -mx-4 mb-6 border-b bg-[var(--bg)]/95 px-4 py-3 backdrop-blur" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-lg font-semibold">{APP_NAME}</span>
          <span className="hidden text-sm sm:inline" style={{ color: 'var(--fg-muted)' }}>
            C 语言 · 数据结构在线学习平台（纯静态）
          </span>
          <span className="ml-auto"><ThemeToggle /></span>
        </div>
        <nav aria-label="主导航" className="mt-2 flex flex-wrap gap-1 text-sm">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className="rounded-md px-3 py-1.5"
              style={({ isActive }) => ({
                background: isActive ? 'var(--bg-elev)' : 'transparent',
                color: isActive ? 'var(--fg)' : 'var(--fg-muted)',
                textDecoration: 'none',
              })}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <nav aria-label="工具与复习" data-role="nav-tools" className="mt-1 flex flex-wrap gap-1 text-xs">
          {TOOLS.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className="rounded-md px-2.5 py-1.5"
              style={({ isActive }) => ({
                background: isActive ? 'var(--bg-elev)' : 'transparent',
                color: isActive ? 'var(--fg)' : 'var(--fg-muted)',
                textDecoration: 'none',
              })}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
        <span>进度保存在本机 localStorage · 代码经第三方公共编译服务在线执行 · 依据仓库内 00–08 规范文件构建</span>
        {/* 阶段 10-3：勘误表入口放页脚 —— 它是查证性内容，不该占主导航的位置 */}
        <Link data-role="errata-link" to="/errata" className="underline decoration-dotted" style={{ color: 'var(--fg-muted)' }}>
          📕 原书勘误表
        </Link>
        {/* 开发者工具：判分链路实测台（四类结论 + 降级路径），不占主导航位置 */}
        <Link data-role="judge-lab-link" to="/judge-lab" className="underline decoration-dotted" style={{ color: 'var(--fg-muted)' }}>
          🔬 判分实测台
        </Link>
      </footer>
    </div>
  )
}