import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { APP_NAME, sections } from '../../app/config'
import { ThemeToggle } from './ThemeToggle'
// 任务 4-1/4-3：首访引导浮层与全站路由加载条都挂在外壳上 —— 它们是「全站级」的东西，
// 放进任何一个页面都会漏（换页就没了）。
import { NavProgress } from './NavProgress'
import { OnboardingOverlay, resetOnboarding } from './OnboardingOverlay'

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
  // 任务 3-3：速查手册（printf/scanf、优先级、ASCII、关键字、库函数）
  { to: '/cheatsheet', label: '📑 速查手册' },
  // 任务 3-4：错误博物馆（经典 bug 可交互演示，每段代码都能真机运行看后果）
  { to: '/bugs', label: '🐛 错误博物馆' },
  // 任务 3-5：错题重练（Leitner 间隔重复，自动收录错题本、按判分事实自动移箱）
  { to: '/review', label: '🔁 错题重练' },
]

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')

  /** 提交 = 跳 /search?q=…；空词就只跳搜索页（那页会自己把光标放进输入框） */
  const submitSearch = () => {
    const q = term.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
  }

  // 已经在 /search 时让头部搜索框跟着 URL 走：页内输入即改 URL，两处永远同一份真相
  useEffect(() => {
    if (location.pathname !== '/search') return
    const next = new URLSearchParams(location.search).get('q') ?? ''
    setTerm((cur) => (cur === next ? cur : next))
  }, [location.pathname, location.search])

  /**
   * 全局快捷键：Ctrl/⌘+K 与单键「/」聚焦搜索框（任务 4-4 无障碍：键盘用户不必 Tab 十几下）。
   * 正在输入控件里打字时绝不抢「/」—— 否则在游乐场写注释就被劫走了；
   * Ctrl+K 无条件生效（浏览器地址栏那个 Ctrl+K 与本站功能不冲突，站内它没有别的用途）。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      <NavProgress />
      <header className="sticky top-0 z-10 -mx-4 mb-6 border-b bg-[var(--bg)]/95 px-4 py-3 backdrop-blur" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-lg font-semibold">{APP_NAME}</span>
          <span className="hidden text-sm sm:inline" style={{ color: 'var(--fg-muted)' }}>
            C 语言 · 数据结构在线学习平台（纯静态）
          </span>
          {/* 任务 4-2：全局搜索入口放头部（它是全站动作，不属于任何一个板块）。
              375px 下整行独占（order-last + w-full + min-w-0），sm 以上挤在标题与主题开关之间。 */}
          <form
            role="search"
            data-role="global-search-form"
            onSubmit={(e) => { e.preventDefault(); submitSearch() }}
            className="order-last w-full min-w-0 sm:order-none sm:ml-auto sm:w-auto sm:max-w-xs sm:flex-1"
          >
            <label htmlFor="global-search" className="sr-only">全站搜索（题目 / 卡片 / 演示 / 手册）</label>
            <input
              id="global-search"
              ref={searchRef}
              type="search"
              value={term}
              maxLength={80}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setTerm('') }}
              placeholder="搜索题目 / 卡片 / 演示…（Ctrl+K）"
              data-role="global-search-input"
              autoComplete="off"
              className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg)', ['--tw-ring-color' as string]: 'var(--fg-link)' }}
            />
          </form>
          <span className="ml-auto sm:ml-0"><ThemeToggle /></span>

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
        {/* 任务 4-1：引导浮层可以关掉，那就必须能找回来。
            先清掉「已看过」的两处痕迹（localStorage + 会话变量），再用 ?boot=1 强制弹一次 ——
            光靠清 key 不够：已经有做题记录的老用户不满足「首访」条件，只有 ?boot=1 能压过它。
            用 Link 而不是 button：与页脚其余入口同一套尺寸口径，不会踩窄屏点击目标 <24px 的线。 */}
        <Link
          data-role="onboarding-replay"
          to="/?boot=1"
          onClick={() => resetOnboarding()}
          className="underline decoration-dotted"
          style={{ color: 'var(--fg-muted)' }}
        >
          🧭 重看新手引导
        </Link>
      </footer>
      <OnboardingOverlay />
    </div>
  )
}