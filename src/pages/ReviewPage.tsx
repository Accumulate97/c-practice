/**
 * 错题重练页（/review，任务 3-5）。
 *
 * 三块内容：① 规则与状态条（五箱统计 + 今日到期数）；② 到队列队（含逾期），
 * 每张卡给「去重做」深链 + 「这次做对了 / 还是错了」两个自评按钮；③ 未来队列预览（只读）。
 *
 * ── 与判分的关系（诚实口径）──────────────────────────────────────────────
 * 本页不判分、不改进度记录：机器判分事实（做对 / 做错）由复习引擎自动消费移箱，
 * 手动按钮只服务两类场景 —— 纸面重做、以及简答 / 自评题没有机器结论时的自报。
 * 收录与错题本同源：错题本在册 = 复习在册；出册不删卡（现在对了 ≠ 记住了），
 * 按箱号继续排期，5 号箱再做对才毕业。
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { loadIndex, type ProblemIndex, type ProblemIndexEntry } from '../modules/problems/data/loader'
import { useProgress } from '../modules/problems/progress/store'
import { wrongCountLabel } from '../modules/problems/progress/wrongbook'
import {
  BOX_INTERVALS_DAYS, MAX_BOX,
  loadReviewState, saveReviewState,
} from '../modules/review/schema'
import type { ReviewState } from '../modules/review/schema'
import {
  boxStats, dueCards, manualDemote, manualPromote, syncWithProgress, upcomingCards,
} from '../modules/review/engine'
import type { ReviewChange } from '../modules/review/engine'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

type Phase =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; index: ProblemIndex; byId: Map<string, ProblemIndexEntry> }

const DAY = 24 * 60 * 60 * 1000

/** 到期时刻 → 人话（逾期 n 天 / 今天到期 / 明天到期 / n 天后 / 具体日期） */
function dueLabel(dueAt: number, now: number): string {
  const diffDays = Math.ceil((dueAt - now) / DAY)
  if (diffDays <= 0) {
    const over = Math.floor((now - dueAt) / DAY)
    return over >= 1 ? `已逾期 ${over} 天` : '今天到期'
  }
  if (diffDays === 1) return '明天到期'
  if (diffDays <= 30) return `${diffDays} 天后到期`
  return `${new Date(dueAt).toLocaleDateString('zh-CN')} 到期`
}

function summarize(changes: ReviewChange[]): string {
  const n = (k: ReviewChange['kind']) => changes.filter((c) => c.kind === k).length
  const parts: string[] = []
  if (n('added')) parts.push(`新收录 ${n('added')} 题`)
  if (n('machine-passed')) parts.push(`实判做对升箱 ${n('machine-passed')} 题`)
  if (n('machine-failed')) parts.push(`实判做错回 1 号箱 ${n('machine-failed')} 题`)
  if (n('graduated')) parts.push(`毕业 ${n('graduated')} 题`)
  return parts.length ? `已按你的判分记录自动更新：${parts.join('，')}。` : ''
}

export function ReviewPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [state, setState] = useState<ReviewState | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const records = useProgress((s) => s.records)

  useEffect(() => {
    let alive = true
    loadIndex()
      .then((index) => {
        if (!alive) return
        setPhase({ kind: 'ready', index, byId: new Map(index.problems.map((p) => [p.id, p])) })
      })
      .catch((e: unknown) => {
        if (alive) setPhase({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
      })
    return () => { alive = false }
  }, [])

  // 挂载 + 判分记录变化 → 与进度同步（幂等；无变化不写盘）
  useEffect(() => {
    if (phase.kind !== 'ready') return
    const now = Date.now()
    const loaded = loadReviewState(now)
    if (loaded.issue) setIssue(loaded.issue)
    const res = syncWithProgress(loaded.state, phase.index, records, now)
    setState(res.state)
    if (res.changed) {
      const err = saveReviewState(res.state)
      if (err) setIssue(err)
      const msg = summarize(res.changes)
      if (msg) setNotice(msg)
    }
  }, [phase, records])

  const titleOf = (id: string): string =>
    phase.kind === 'ready' ? (phase.byId.get(id)?.title ?? id) : id

  function act(kind: 'promote' | 'demote', id: string): void {
    // 不走 setState 函数式 updater：StrictMode 会双调用 updater，
    // 里面藏 setNotice / localStorage 写盘这类副作用会被执行两次
    if (!state) return
    const now = Date.now()
    const res = kind === 'promote' ? manualPromote(state, id, now) : manualDemote(state, id, now)
    const err = saveReviewState(res.state)
    if (err) setIssue(err)
    if (kind === 'promote') {
      setNotice(res.graduated
        ? `🎓「${titleOf(id)}」通过 ${MAX_BOX} 号箱复查，毕业了。之后若再做错会重新收录。`
        : `⬆️「${titleOf(id)}」升到 ${res.card?.box ?? '?'} 号箱，${res.card ? dueLabel(res.card.dueAt, now) : ''}。`)
    } else {
      setNotice(`⬇️「${titleOf(id)}」回到 1 号箱，留在今天的队列里 —— 建议现在就去重做。`)
    }
    setState(res.state)
  }

  const stats = useMemo(() => (state ? boxStats(state) : []), [state])
  const now = Date.now()
  const due = useMemo(() => (state ? dueCards(state, now) : []), [state, now])
  const upcoming = useMemo(() => (state ? upcomingCards(state, now) : []), [state, now])
  const total = state ? Object.keys(state.cards).length : 0

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-2">
        <h1 className="m-0 text-xl font-bold">🔁 错题重练</h1>
        <p className="m-0 text-sm" style={muted} data-role="review-rules">
          按遗忘曲线安排重练：错题本在册的题自动收录进 1 号箱，每做对一次升一箱，
          复习间隔 {BOX_INTERVALS_DAYS.join(' / ')} 天；做错（实判或自评）无条件回 1 号箱；
          {MAX_BOX} 号箱再做对即毕业。做对做错的机器判分记录会自动移箱，无需手动打卡 ——
          本页只做计划，不改任何判分数据。
        </p>
      </header>

      {issue && (
        <p className="m-0 rounded-lg border px-3 py-2 text-xs" role="status" data-role="review-issue"
          style={{ ...panel, borderColor: 'var(--fg-warn)', color: 'var(--fg-warn)' }}>
          ⚠️ {issue}
        </p>
      )}
      {notice && (
        <p className="m-0 rounded-lg border px-3 py-2 text-xs" role="status" data-role="review-notice" style={panel}>
          {notice}
          <button type="button" className="ml-2 min-h-6 underline" style={muted} aria-label="关闭提示"
            onClick={() => setNotice(null)}>关闭</button>
        </p>
      )}

      {phase.kind === 'loading' && (
        <div data-role="skeleton" aria-busy="true" aria-label="复习计划加载中">
          <p className="text-sm" style={muted}>正在编排复习计划…</p>
        </div>
      )}
      {phase.kind === 'failed' && (
        <p className="text-sm" role="alert" style={{ color: 'var(--fg-bad)' }} data-role="review-load-failed">
          题库索引加载失败：{phase.message}
        </p>
      )}

      {phase.kind === 'ready' && state && (
        <>
          <section className="rounded-lg border p-3" style={panel} aria-label="复习状态统计">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <strong className="text-sm" data-role="review-due-count">
                今日待复习 {due.length} 张 / 在册 {total} 张
              </strong>
              {stats.map((s) => (
                <span key={s.box} data-role="review-stat" data-box={s.box}
                  className="rounded-full border px-2 py-0.5"
                  style={{ borderColor: 'var(--border)' }}
                  title={`${s.box} 号箱间隔 ${BOX_INTERVALS_DAYS[s.box - 1]} 天`}>
                  {s.box} 号箱 × {s.count}
                </span>
              ))}
            </div>
          </section>

          <section aria-label="到期复习队列" className="space-y-2">
            <h2 className="m-0 text-base font-semibold">📌 该复习了（含逾期）</h2>
            {due.length === 0 && total === 0 && (
              <div className="rounded-lg border p-4 text-sm" style={panel} data-role="review-empty" data-variant="no-cards">
                <p className="m-0" style={muted}>
                  还没有收录任何错题。做错的题（机器判分确证失败，或简答题自评未通过）会进错题本，
                  下次打开本页自动收录到这里。现在去 <Link className="underline" to="/problems">题目列表</Link> 练一轮吧。
                </p>
              </div>
            )}
            {due.length === 0 && total > 0 && (
              <div className="rounded-lg border p-4 text-sm" style={panel} data-role="review-empty" data-variant="none-due">
                <p className="m-0" style={muted}>
                  今天没有到期的复习。下一张：{upcoming[0] ? `「${titleOf(upcoming[0].id)}」${dueLabel(upcoming[0].card.dueAt, now)}` : '（无）'}。
                  间隔重复的意义就是不天天见 —— 到点再来。
                </p>
              </div>
            )}
            {due.map(({ id, card }) => {
              const entry = phase.kind === 'ready' ? phase.byId.get(id) : undefined
              const record = records[id]
              return (
                <article key={id} data-role="review-card" data-id={id}
                  className="min-w-0 rounded-lg border p-3" style={{ ...panel, background: 'var(--bg)' }}>
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Link data-role="review-problem-link" className="min-w-0 font-semibold underline" style={{ color: 'var(--fg-link)' }}
                      to={`/problems/p/${id}`}>
                      {entry?.title ?? id}
                    </Link>
                    <span className="text-xs" style={muted}>
                      {entry ? `${entry.section} · ${entry.chapter}` : '（已不在题库索引中）'}
                      {record ? ` · ${wrongCountLabel(record)}` : ''}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={muted}>
                    <span data-role="review-box">箱 {card.box} / {MAX_BOX}</span>
                    <span data-role="review-due">{dueLabel(card.dueAt, now)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link data-role="review-go" to={`/problems/p/${id}`}
                      className="min-h-8 rounded-md border px-3 py-1.5 text-xs no-underline"
                      style={{ borderColor: 'var(--fg-link)', color: 'var(--fg-link)' }}>
                      ✍️ 去重做
                    </Link>
                    <button type="button" data-role="review-promote" onClick={() => act('promote', id)}
                      className="min-h-8 rounded-md border px-3 py-1.5 text-xs"
                      style={{ borderColor: 'var(--fg-ok)', color: 'var(--fg-ok)' }}>
                      ✅ 这次做对了（升箱）
                    </button>
                    <button type="button" data-role="review-demote" onClick={() => act('demote', id)}
                      className="min-h-8 rounded-md border px-3 py-1.5 text-xs"
                      style={{ borderColor: 'var(--fg-bad)', color: 'var(--fg-bad)' }}>
                      ❌ 还是错了（回 1 号箱）
                    </button>
                  </div>
                </article>
              )
            })}
          </section>

          {upcoming.length > 0 && (
            <section aria-label="未来复习队列" className="space-y-1" data-role="review-upcoming">
              <h2 className="m-0 text-base font-semibold">🗓 之后的安排（{upcoming.length} 张）</h2>
              <ul className="m-0 space-y-1 p-0 text-xs">
                {upcoming.slice(0, 12).map(({ id, card }) => (
                  <li key={id} data-role="review-upcoming-card" data-id={id} className="min-w-0" style={muted}>
                    <Link className="underline" style={{ color: 'var(--fg-link)' }} to={`/problems/p/${id}`}>{titleOf(id)}</Link>
                    {' · '}箱 {card.box} · {dueLabel(card.dueAt, now)}
                  </li>
                ))}
                {upcoming.length > 12 && <li style={muted}>…另有 {upcoming.length - 12} 张，到期会自动排上来。</li>}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
