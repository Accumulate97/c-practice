/**
 * 学习路径页（任务 3-2）：/#/path —— 闯关式主线，按章节递进：学卡片 → 做例题 → 解锁下一关。
 *
 * 关卡内容全部现算（见 modules/path/levels.ts 文件头），本页只负责：
 *   ① 读三份索引 → buildPath；② 读进度 → levelStates / levelProgress；③ 渲染两条轨道的关卡地图。
 * 进度来自 useProgress（zustand + localStorage），做完题回到本页状态即时刷新，不需要额外同步。
 * 「自由模式」开关写 cpractice:path:v1，打开后所有关卡解锁 —— 页面上如实标注，不做隐性放行。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { loadKnowledgeIndex } from '../modules/knowledge/data/loader'
import { buildPath, levelProgress, levelStates, pathSummary, recommendProblems, TRACKS, TRACK_LABEL } from '../modules/path/levels'
import type { LevelState, PathLevel } from '../modules/path/levels'
import { loadIndex } from '../modules/problems/data/loader'
import { useProgress } from '../modules/problems/progress/store'
import { difficultyStars, typeLabel } from '../modules/problems/type-meta'
import { loadVizIndex } from '../modules/viz/data/loader'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const FREE_KEY = 'cpractice:path:v1'

const STATE_META: Record<LevelState, { icon: string; label: string; color: string }> = {
  cleared: { icon: '✅', label: '已通关', color: 'var(--fg-ok)' },
  current: { icon: '▶', label: '进行中', color: 'var(--fg-link)' },
  open: { icon: '🔓', label: '已解锁', color: 'var(--fg)' },
  locked: { icon: '🔒', label: '未解锁', color: 'var(--fg-muted)' },
}

function readFree(): boolean {
  try {
    const raw = localStorage.getItem(FREE_KEY)
    return raw ? JSON.parse(raw)?.freeMode === true : false
  } catch {
    return false
  }
}

export function PathPage() {
  const records = useProgress((s) => s.records)
  const [levels, setLevels] = useState<PathLevel[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [free, setFree] = useState<boolean>(readFree)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([loadIndex(), loadKnowledgeIndex(), loadVizIndex()]).then(
      ([p, k, v]) => {
        if (!alive) return
        setLevels(buildPath(p, k, v.demos))
      },
      (e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const states = useMemo(() => (levels ? levelStates(levels, records, free) : []), [levels, records, free])
  const summary = useMemo(() => (levels ? pathSummary(levels, states, records) : null), [levels, states, records])

  // 首次算完自动展开「进行中」的关卡：一进来就能看到该做什么，而不是面对 20 个折叠条
  useEffect(() => {
    if (!levels || booted) return
    setBooted(true)
    const cur = levels.filter((_, i) => states[i] === 'current').map((l) => l.key)
    setOpen(new Set(cur.length ? cur : [levels[0]?.key ?? '']))
  }, [levels, states, booted])

  const toggleFree = () => {
    const next = !free
    setFree(next)
    try {
      localStorage.setItem(FREE_KEY, JSON.stringify({ freeMode: next }))
    } catch {
      /* 隐私模式写不进 localStorage：本次会话内仍然生效，刷新后回到顺序解锁 */
    }
  }

  const jumpTo = (key: string) => {
    setOpen((prev) => new Set([...prev, key]))
    requestAnimationFrame(() => document.getElementById(`path-lv-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }

  if (err) {
    return (
      <div className="space-y-3" data-role="path-page">
        <h1 className="text-2xl font-semibold">🗺️ 学习路径</h1>
        <p className="rounded-md border px-3 py-2 text-sm" style={{ ...panel, borderColor: 'var(--fg-bad)', color: 'var(--fg-bad)' }} data-role="path-error">
          索引加载失败：{err}
        </p>
      </div>
    )
  }

  if (!levels || !summary) {
    return (
      <div className="space-y-3" data-role="path-page">
        <h1 className="text-2xl font-semibold">🗺️ 学习路径</h1>
        <p className="text-sm" style={muted} data-role="path-loading">正在编排关卡（读题目 / 卡片 / 演示索引）…</p>
      </div>
    )
  }

  const current = levels.find((_, i) => states[i] === 'current')

  return (
    <div className="space-y-5" data-role="path-page">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">🗺️ 学习路径</h1>
        <p className="text-sm" style={muted}>
          按章节闯关：先读知识卡片，再做本章题目，通过 {levels[0]?.target ?? 3} 题以上即通关并解锁下一关。
          两条轨道（C 语言 / 数据结构）各自独立解锁。
        </p>
      </header>

      <section className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4" style={panel} aria-label="路径总览">
        <Stat label="已通关" value={`${summary.cleared} / ${summary.levels}`} sub="关卡" />
        <Stat label="主线已通过" value={`${summary.passed} 题`} sub={`题库共 ${summary.problems} 题`} />
        <Stat label="配套卡片" value={`${summary.cards} 张`} sub="知识汇总" />
        <Stat label="配套演示" value={`${summary.demos} 个`} sub="2D 可视化" />
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" style={panel}>
        <button
          type="button"
          role="switch"
          aria-checked={free}
          data-role="path-free-mode"
          onClick={toggleFree}
          className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', background: free ? 'var(--bg)' : 'transparent' }}
        >
          <span aria-hidden="true">{free ? '🔓' : '🔒'}</span>
          自由模式：{free ? '开（全部关卡已解锁）' : '关（顺序解锁）'}
        </button>
        {current ? (
          <button
            type="button"
            data-role="path-continue"
            onClick={() => jumpTo(current.key)}
            className="min-h-10 rounded-md border px-3 py-2 text-sm font-medium"
            style={{ borderColor: 'var(--border)' }}
          >
            ▶ 继续闯关：{current.chapter}
          </button>
        ) : (
          <p className="text-sm" style={muted} data-role="path-all-clear">
            🎉 全部关卡已通关。可以去 <Link className="underline" style={{ color: 'var(--fg-link)' }} to="/problems">题库</Link> 挑战剩下的题，或到{' '}
            <Link className="underline" style={{ color: 'var(--fg-link)' }} to="/review">错题重练</Link> 巩固。
          </p>
        )}
        <p className="text-xs sm:ml-auto" style={muted}>
          通关口径：本章「做对过」的题数 ≥ 目标题数（每关 3–12 题，按章内题量 15% 取整）。
        </p>
      </div>

      {TRACKS.map((track) => {
        const rows = levels.map((l, i) => ({ l, i })).filter((x) => x.l.track === track)
        const cleared = rows.filter((x) => states[x.i] === 'cleared').length
        return (
          <section key={track} className="space-y-2" aria-labelledby={`path-track-${track}`} data-role="path-track" data-track={track}>
            <h2 id={`path-track-${track}`} className="flex flex-wrap items-baseline gap-2 text-lg font-semibold">
              <span>{track === 'c' ? '📘' : '📗'} {TRACK_LABEL[track]}</span>
              <span className="text-xs font-normal" style={muted}>
                {rows.length} 关 · 已通关 {cleared}
              </span>
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm" style={muted} data-role="path-empty">这条轨道还没有关卡数据。</p>
            ) : (
              <ol className="space-y-2">
                {rows.map(({ l, i }) => (
                  <LevelRow
                    key={l.key}
                    level={l}
                    state={states[i] ?? 'locked'}
                    open={open.has(l.key)}
                    onToggle={() =>
                      setOpen((prev) => {
                        const next = new Set(prev)
                        if (next.has(l.key)) next.delete(l.key)
                        else next.add(l.key)
                        return next
                      })
                    }
                  />
                ))}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div data-role="path-stat">
      <p className="text-xs" style={muted}>{label}</p>
      <p className="text-xl font-semibold" style={{ color: 'var(--fg)' }}>{value}</p>
      <p className="text-xs" style={muted}>{sub}</p>
    </div>
  )
}

function LevelRow({ level, state, open, onToggle }: { level: PathLevel; state: LevelState; open: boolean; onToggle: () => void }) {
  const records = useProgress((s) => s.records)
  const prog = levelProgress(level, records)
  const meta = STATE_META[state]
  const locked = state === 'locked'
  const detailId = `path-lv-${level.key}`
  const rec = locked ? [] : recommendProblems(level, records, 6)

  return (
    <li id={detailId} className="rounded-lg border p-3" style={{ ...panel, borderColor: state === 'current' ? 'var(--fg-link)' : 'var(--border)' }} data-role="path-level" data-state={state} data-key={level.key}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg" aria-hidden="true">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            第 {level.order} 关 · {level.chapter}
            <span className="ml-2 text-xs font-normal" style={{ color: meta.color }} data-role="path-level-state">
              {meta.label}
            </span>
          </h3>
          <p className="text-xs" style={muted}>
            卡片 {level.cards.length} · 题目 {level.problems.length} · 演示 {level.demos.length} · 小节 {level.sections.length}
          </p>
          <div
            className="mt-1.5 h-2 w-full overflow-hidden rounded"
            style={{ background: 'var(--bg)' }}
            role="progressbar"
            aria-valuenow={prog.passed}
            aria-valuemin={0}
            aria-valuemax={prog.target}
            aria-label={`第 ${level.order} 关 ${level.chapter}：已通过 ${prog.passed} 题，目标 ${prog.target} 题`}
          >
            <div className="h-full rounded" style={{ width: `${prog.percent}%`, background: prog.cleared ? 'var(--fg-ok)' : 'var(--fg-link)' }} />
          </div>
          <p className="mt-1 text-xs" style={muted} data-role="path-progress">
            已通过 {prog.passed} / {prog.target} 题 · 做过 {prog.attempted} / {level.problems.length} 题
          </p>
        </div>
        <button
          type="button"
          data-role="path-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`path-detail-${level.key}`}
          className="min-h-10 min-w-16 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open ? (
        <div id={`path-detail-${level.key}`} className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--border)' }} data-role="path-detail">
          {locked ? (
            <p className="text-sm" style={muted} data-role="path-locked-hint">
              🔒 这一关还没解锁：先通关本轨道的上一关（通过它的目标题数即可），或打开上方的「自由模式」直接学。
            </p>
          ) : (
            <>
              <Block title={`① 学 · 知识卡片（${level.cards.length}）`} count={level.cards.length} empty="本章还没有配套知识卡片。">
                <ul className="grid gap-1 sm:grid-cols-2">
                  {level.cards.map((c) => (
                    <li key={c.id}>
                      <Link to={`/knowledge/${c.id}`} className="block rounded border px-2 py-1.5 text-xs hover:underline" style={{ borderColor: 'var(--border)', color: 'var(--fg-link)' }} data-role="path-card-link">
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Block>

              {level.demos.length > 0 ? (
                <Block title={`② 看 · 可视化演示（${level.demos.length}）`} count={level.demos.length} empty="">
                  <ul className="flex flex-wrap gap-1">
                    {level.demos.map((d) => (
                      <li key={d.id}>
                        <Link to={`/viz/${d.id}`} className="block rounded border px-2 py-1.5 text-xs hover:underline" style={{ borderColor: 'var(--border)', color: 'var(--fg-link)' }} data-role="path-viz-link">
                          🎬 {d.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Block>
              ) : null}

              <Block title={`③ 练 · 推荐题目（${rec.length}）`} count={rec.length} empty="本章题目全部做对过了 🎉 可以去题库挑更难的。">
                <ul className="space-y-1">
                  {rec.map((p) => {
                    const r = records[p.id]
                    const tried = !!r && (r.attempts > 0 || r.selfAssessed)
                    return (
                      <li key={p.id}>
                        <Link
                          to={`/problems/p/${p.id}`}
                          className="flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs hover:underline"
                          style={{ borderColor: 'var(--border)' }}
                          data-role="path-problem-link"
                        >
                          <span style={{ color: 'var(--fg-link)' }} className="min-w-0 flex-1 truncate">{p.title}</span>
                          <span style={muted}>{typeLabel(p.type)}</span>
                          <span style={muted} aria-label={`难度 ${p.difficulty} 星`}>{difficultyStars(p.difficulty)}</span>
                          <span style={{ color: tried ? 'var(--fg-warn)' : 'var(--fg-muted)' }}>{tried ? '做过未对' : '未做'}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </Block>

              <p className="text-xs">
                <Link to={`/problems?chapter=${encodeURIComponent(level.chapter)}`} className="underline" style={{ color: 'var(--fg-link)' }} data-role="path-all-problems">
                  本章全部 {level.problems.length} 题 →
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}

function Block({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  const showEmpty = count === 0 && empty !== ''
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold" style={{ color: 'var(--fg)' }}>{title}</h4>
      {showEmpty ? <p className="text-xs" style={muted} data-role="path-block-empty">{empty}</p> : children}
    </div>
  )
}
