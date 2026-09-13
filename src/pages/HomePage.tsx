/**
 * 首页（任务 4-1 改版）。
 *
 * 改版前这里挂的是「项目硬约束 + 实施阶段 1–10」两张表 —— 那是给开发者看的开工清单，
 * 而且阶段状态还停在「阶段 1 进行中」，站点其实早已全线建成：对学生是纯噪音，对开发者是过期信息。
 * 现在这一页只回答学生关心的四件事：
 *   ① 这站能干什么（三大板块 + 规模数字，数字来自构建期计数文件，绝不硬编码）
 *   ② 我现在该从哪儿开始（学习路径主线 / 每日一题 / 随机练习）
 *   ③ 我练到哪了（进度概览，全部由 localStorage 现算，没有记录就给引导而不是空白）
 *   ④ 还有哪些工具（3D 馆 / 游乐场 / 速查手册 / 错误博物馆 / 错题重练）
 *
 * 体积红线：首页在主 chunk 里，所以**不 fetch 任何大文件** ——
 * 规模数字只拉 <1 KB 的 search/totals.json，进度全部来自本地 store；
 * 727 KB 的搜索语料、判分层、three.js 一律留在各自的路由级 lazy chunk 里。
 * 计数拉不到就整块不显示（宁可少几个数字，也不编一个）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { APP_NAME, judge, sections } from '../app/config'
import { loadTotals } from '../modules/search/totals'
import type { SearchTotals } from '../modules/search/totals'
import { statusOf, useProgress } from '../modules/problems/progress/store'
import { inWrongBook } from '../modules/problems/progress/wrongbook'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

/** 板块卡片右下角的规模数字：全部来自 totals.json，一个都不写死 */
const SECTION_COUNT = (t: SearchTotals, path: string): string | null => {
  if (path === '/problems') return t.problem ? `${t.problem} 道题` : null
  if (path === '/knowledge') return t.knowledge ? `${t.knowledge} 张卡片` : null
  if (path === '/viz') {
    const n = (t.viz ?? 0) + (t.viz3d ?? 0)
    return n ? `${t.viz ?? 0} 个 2D + ${t.viz3d ?? 0} 个 3D` : null
  }
  return null
}

/** 工具与更多入口（与 AppShell 第二排导航同源，这里给一句话说明，导航只给名字） */
const TOOLS = [
  { to: '/viz3d', emoji: '🧊', title: '3D 可视化馆', desc: '二叉树 / 链表 / 内存沙盘 / 调用栈，立体看清算法' },
  { to: '/playground', emoji: '🧪', title: '代码游乐场', desc: '自由写 C 代码真机运行，支持 stdin 与多编译器' },
  { to: '/cheatsheet', emoji: '📑', title: '速查手册', desc: 'printf 格式符、优先级、ASCII、关键字、库函数' },
  { to: '/bugs', emoji: '🐛', title: '错误博物馆', desc: '野指针、越界、泄漏…每段代码都能运行看后果' },
  { to: '/review', emoji: '🔁', title: '错题重练', desc: 'Leitner 五箱间隔重复，按遗忘曲线安排复习' },
  { to: '/progress', emoji: '📈', title: '我的进度', desc: '章节掌握度、错题本、收藏、笔记、导入导出' },
]

const PROMISES = [
  ['纯静态、无后端', '整站可部署在 GitHub Pages，进度只存在你自己的浏览器 localStorage 里'],
  ['标准 C99', '禁用 C++ 语法、教材类C伪码与 gets / conio.h 这类非标准内容'],
  ['代码题实机验证', `每道代码题都经 ${judge.godboltCompiler} 真实编译执行并比对输出后才标「已验证」`],
  ['三板块双向关联', '知识卡片 ⇄ 演示 ⇄ 题目互相跳转，学完就能看，看完就能练'],
]

export function HomePage() {
  const navigate = useNavigate()
  const records = useProgress((s) => s.records)
  const [totals, setTotals] = useState<SearchTotals | null>(null)
  const [term, setTerm] = useState('')

  // 规模计数：<1 KB，拉失败就整块不显示（不硬编码、不编数字）
  useEffect(() => {
    let alive = true
    loadTotals()
      .then((t) => { if (alive) setTotals(t) })
      .catch(() => { if (alive) setTotals(null) })
    return () => { alive = false }
  }, [])

  /** 进度概览全部由本地记录现算，口径与 ProgressPage 的 computeStats 一致（passed / attempted / 在册错题） */
  const ov = useMemo(() => {
    let passed = 0
    let attempted = 0
    let wrongBook = 0
    let starred = 0
    let noted = 0
    let attempts = 0
    let wrongCount = 0
    let lastAt = 0
    for (const r of Object.values(records)) {
      const st = statusOf(r)
      if (st === 'passed') passed += 1
      else if (st === 'attempted') attempted += 1
      if (inWrongBook(r)) wrongBook += 1
      if (r.starred) starred += 1
      if (r.note.trim().length > 0) noted += 1
      attempts += r.attempts
      wrongCount += r.wrongCount
      if (r.lastAt > lastAt) lastAt = r.lastAt
    }
    // 分母为 0 → null（UI 显示「—」而不是假的 0%）；有分母则夹到 [0,1]，绝不出负正确率
    const accuracy = attempts > 0 ? Math.min(1, Math.max(0, (attempts - wrongCount) / attempts)) : null
    return { passed, attempted, done: passed + attempted, wrongBook, starred, noted, accuracy, lastAt }
  }, [records])

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = term.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
  }

  const tiles: { label: string; value: string; to?: string }[] = [
    { label: '做过的题', value: String(ov.done), to: '/progress' },
    { label: '已通过', value: String(ov.passed), to: '/problems?status=passed' },
    { label: '机器判分正确率', value: ov.accuracy === null ? '—' : `${Math.round(ov.accuracy * 100)}%`, to: '/progress' },
    { label: '在册错题', value: String(ov.wrongBook), to: '/review' },
    { label: '收藏', value: String(ov.starred), to: '/progress' },
    { label: '写了笔记', value: String(ov.noted), to: '/progress' },
  ]

  return (
    <div className="space-y-8">
      {/* ── ① Hero：一句话讲清这站是什么 + 全站搜索 + 规模 ───────────────────── */}
      <section
        data-role="home-hero"
        className="rounded-2xl border p-6 sm:p-8"
        style={{ borderColor: 'var(--border)', background: 'linear-gradient(135deg, var(--bg-elev) 0%, var(--bg) 70%)' }}
      >
        <h1 className="m-0 text-3xl font-semibold sm:text-4xl">{APP_NAME}</h1>
        <p className="m-0 mt-2 max-w-2xl text-sm sm:text-base" style={muted}>
          不是单纯的刷题站，而是「学 — 懂 — 练」三板块联动的 C 语言与数据结构学习平台：
          知识卡片讲清概念，分步演示让你看见它怎么跑，题目立刻检验你会不会用，三者双向跳转。
        </p>

        <form role="search" onSubmit={onSearch} className="mt-5 flex flex-wrap gap-2" data-role="home-search-form">
          <label htmlFor="home-search" className="sr-only">全站搜索</label>
          <input
            id="home-search"
            type="search"
            value={term}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => setTerm(e.target.value)}
            placeholder="搜一搜：printf、指针、递归、链表 插入、malloc…"
            data-role="home-search-input"
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)', ['--tw-ring-color' as string]: 'var(--fg-link)' }}
          />
          <button
            type="submit"
            data-role="home-search-go"
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            style={{ borderColor: 'var(--fg-link)', background: 'var(--fg-link)', color: 'var(--bg)' }}
          >
            🔍 全站搜索
          </button>
        </form>

        {totals && (
          <ul className="m-0 mt-4 flex flex-wrap gap-x-4 gap-y-1 p-0 text-xs" style={muted} data-role="home-scale">
            <li className="list-none"><strong style={{ color: 'var(--fg)' }}>{totals.problem ?? 0}</strong> 道题</li>
            <li className="list-none"><strong style={{ color: 'var(--fg)' }}>{totals.knowledge ?? 0}</strong> 张知识卡片</li>
            <li className="list-none"><strong style={{ color: 'var(--fg)' }}>{(totals.viz ?? 0) + (totals.viz3d ?? 0)}</strong> 个演示（含 {totals.viz3d ?? 0} 个 3D）</li>
            <li className="list-none"><strong style={{ color: 'var(--fg)' }}>{totals.bug ?? 0}</strong> 件错误展品</li>
            <li className="list-none"><strong style={{ color: 'var(--fg)' }}>{totals.ref ?? 0}</strong> 条速查条目</li>
          </ul>
        )}
      </section>

      {/* ── ② 三大板块：学 / 懂 / 练（保留原 data-role 与链接结构，验收脚本靠它认门）── */}
      <section className="grid gap-4 sm:grid-cols-3" data-role="home-sections" aria-label="三大板块">
        {sections.map((s) => (
          <Link
            key={s.path}
            to={s.path}
            className="rounded-xl border p-5 transition hover:-translate-y-0.5"
            style={{ ...panel, borderColor: 'var(--border)', textDecoration: 'none', color: 'inherit' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-3xl" aria-hidden="true">{s.emoji}</div>
              <span
                className="rounded-full border px-2.5 py-1 text-lg font-semibold leading-none"
                style={{ borderColor: 'var(--fg-link)', color: 'var(--fg-link)' }}
                aria-hidden="true"
              >
                {s.intent}
              </span>
            </div>
            <div className="mt-3 font-semibold">{s.title}</div>
            <div className="mt-1 text-sm" style={muted}>{s.desc}</div>
            <div className="mt-3 text-xs" style={{ color: 'var(--fg-link)' }} data-role="home-section-count">
              {totals ? (SECTION_COUNT(totals, s.path) ?? '进入板块') : '进入板块 →'}
            </div>
          </Link>
        ))}
      </section>

      {/* ── ③ 学习路径主线入口：不知道从哪开始的人走这条 ─────────────────────── */}
      <section
        data-role="home-path-cta"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border p-5"
        style={{ ...panel, borderColor: 'var(--fg-link)' }}
      >
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lg font-semibold">🗺️ 不知道从哪开始？走学习路径</h2>
          <p className="m-0 mt-1 text-sm" style={muted}>
            闯关式主线：C 语言 12 关 + 数据结构 8 关，每关「① 学知识卡片 → ② 看可视化演示 → ③ 练推荐题目」，
            本章做够题才解锁下一关。也可以打开自由模式随便逛。
          </p>
        </div>
        <Link
          to="/path"
          data-role="home-path-go"
          className="rounded-lg border px-4 py-2 text-sm font-medium"
          style={{ borderColor: 'var(--fg-link)', background: 'var(--fg-link)', color: 'var(--bg)', textDecoration: 'none' }}
        >
          进入学习路径
        </Link>
      </section>

      {/* ── ④ 进度概览：有记录给数字，没记录给引导（绝不是一片空白）────────────── */}
      <section className="rounded-xl border p-5" style={panel} data-role="home-progress" aria-label="我的进度概览">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-lg font-semibold">📈 我的进度</h2>
          <Link to="/progress" className="text-xs underline decoration-dotted" style={{ color: 'var(--fg-link)' }}>
            查看完整统计与错题本
          </Link>
        </div>

        {ov.done === 0 ? (
          <div className="mt-3 text-sm" style={muted} data-role="home-progress-empty">
            <p className="m-0">本机还没有做题记录（进度存在你自己的浏览器里，换设备不会跟过来）。</p>
            <ol className="m-0 mt-2 list-decimal space-y-1 pl-5">
              <li>从「每日一题」或学习路径的第一关开始，先做一道试试判分</li>
              <li>做完的题目会自动出现在这里，错题自动进错题本并安排间隔复习</li>
              <li>想先看再练，就去可视化演示里挑一个算法播放</li>
            </ol>
          </div>
        ) : (
          <>
            <ul className="m-0 mt-3 grid grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-6" data-role="home-progress-tiles">
              {tiles.map((t) => (
                <li key={t.label} className="list-none rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                  <div className="text-xl font-semibold" style={{ color: 'var(--fg)' }} data-role="home-stat-value">{t.value}</div>
                  <div className="mt-0.5 text-xs" style={muted}>{t.label}</div>
                  {t.to && (
                    <Link to={t.to} className="mt-1 inline-block text-xs underline decoration-dotted" style={{ color: 'var(--fg-link)' }}>
                      去看看
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <p className="m-0 mt-3 text-xs" style={muted}>
              {ov.lastAt > 0 ? `上次练习：${new Date(ov.lastAt).toLocaleString('zh-CN')}` : '还没有带时间戳的练习记录'}
              {ov.wrongBook > 0 ? ` · 有 ${ov.wrongBook} 道题在册错题，去「错题重练」按遗忘曲线复习` : ' · 错题本是空的'}
            </p>
          </>
        )}
      </section>

      {/* ── ⑤ 快速开始（data-role 与链接保持不变：整站回归脚本认这三个把手）────── */}
      <section className="rounded-xl border p-5 text-sm" style={panel} data-role="quick-start">
        <h2 className="m-0 font-semibold">⚡ 快速开始</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to="/problems?pick=daily" data-role="home-pick-daily" className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)', textDecoration: 'none' }}>📅 每日一题</Link>
          <Link to="/problems?pick=random" data-role="home-pick-random" className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)', textDecoration: 'none' }}>🎲 随机练习</Link>
          <Link to="/problems?status=todo" className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)', textDecoration: 'none' }}>📝 只做没做过的</Link>
          <Link to="/search" className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)', textDecoration: 'none' }}>🔍 全站搜索</Link>
        </div>
        <p className="m-0 mt-2 text-xs" style={muted}>
          每日一题按本地日期固定，同一天刷新不变；随机练习每点一次换一道新题。
          快捷键：任何时候按 <kbd className="rounded border px-1" style={{ borderColor: 'var(--border)' }}>Ctrl</kbd>+<kbd className="rounded border px-1" style={{ borderColor: 'var(--border)' }}>K</kbd> 或 <kbd className="rounded border px-1" style={{ borderColor: 'var(--border)' }}>/</kbd> 直接跳到搜索框。
        </p>
      </section>

      {/* ── ⑥ 工具与更多入口 ─────────────────────────────────────────────── */}
      <section aria-label="工具与更多入口">
        <h2 className="m-0 mb-2 text-lg font-semibold">🧰 工具与更多</h2>
        <ul className="m-0 grid gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3" data-role="home-tools">
          {TOOLS.map((t) => (
            <li key={t.to} className="list-none">
              <Link
                to={t.to}
                data-role="home-tool"
                className="block h-full rounded-xl border p-4 transition hover:-translate-y-0.5"
                style={{ ...panel, borderColor: 'var(--border)', textDecoration: 'none', color: 'inherit' }}
              >
                <div className="font-semibold"><span aria-hidden="true">{t.emoji}</span> {t.title}</div>
                <div className="mt-1 text-xs" style={muted}>{t.desc}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── ⑦ 本站承诺 + 编译后端的诚实说明（保留 ADR 结论，删掉过期的实施阶段表）── */}
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-lg font-semibold">✅ 本站承诺</h2>
          <ul className="m-0 space-y-2 p-0 text-sm" data-role="home-promises">
            {PROMISES.map(([t, d]) => (
              <li key={t} className="list-none rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="font-medium">{t}</div>
                <div className="mt-0.5 text-xs" style={muted}>{d}</div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">关于在线编译后端</h2>
          <div className="rounded-xl border p-4 text-sm" style={{ ...panel, borderColor: 'var(--border)' }}>
            <p className="m-0" style={muted}>
              代码执行走 Godbolt Compiler Explorer 公共接口，浏览器直连、无需 key。
              实测其策略是服务端排队而非限流，故本站并发上限压到 {judge.maxConcurrency}，多组测试用例严格串行。
              判分口径固定 <code>{judge.userArguments}</code>，软超时 {Math.round(judge.timeoutMs / 1000)} s
              （必须大于服务端 ~20 s 的执行时限，否则死循环会被误判成「后端不可用」）。
              后端不可用时自动进入降级模式：读构建期预存的真实输出供自评，
              <strong style={{ color: 'var(--fg)' }}>不计正确率、不标已验证、绝不伪造「通过」</strong>。
              选型证据见 <code>docs/adr/0001-judge-backend.md</code>。
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
