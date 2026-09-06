import { NavLink, Outlet } from 'react-router-dom'
import { APP_NAME, sections } from '../../app/config'
import { ThemeToggle } from './ThemeToggle'

const NAV = [
  { to: '/', label: '首页' },
  ...sections.map((s) => ({ to: s.path, label: `${s.emoji} ${s.title}` })),
  { to: '/progress', label: '📈 我的进度' },
  { to: '/judge-lab', label: '🧪 判分实测台' },
]

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-12">
      <header className="sticky top-0 z-10 -mx-4 mb-6 border-b bg-[var(--bg)]/95 px-4 py-3 backdrop-blur" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-lg font-semibold">{APP_NAME}</span>
          <span className="hidden text-sm sm:inline" style={{ color: 'var(--fg-muted)' }}>
            C 语言 · 数据结构在线学习平台（纯静态）
          </span>
          <span className="ml-auto"><ThemeToggle /></span>
        </div>
        <nav className="mt-2 flex flex-wrap gap-1 text-sm">
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
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-10 border-t pt-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
        进度保存在本机 localStorage · 代码经第三方公共编译服务在线执行 · 依据仓库内 00–08 规范文件构建
      </footer>
    </div>
  )
}