/**
 * 多算法对比页（阶段 7 · 任务 3）：/#/viz/compare。
 *
 * 同屏并排 2–4 个排序算法，**同步步进**：一个共享的 usePlayback 光标驱动所有面板，
 * 每个面板各自用 makeTimeline(demo.steps, sharedIndex) 夹到自己的步数范围内 ——
 * 步数少的算法走完后停在末步（画面上标「已结束」），不是把它的步数强行拉长。
 *
 * 为什么这样比才有意义：所有排序语料共用同一组输入（algorithms/index.ts 的 SORT_INPUT），
 * 同数据同规模，比较次数 / 交换次数才可比。
 *
 * 语料按需加载：只 fetch 被勾选的演示（8 个排序全量约 214 KB，默认 4 个约 114 KB），
 * loader 内部已有单飞 + 缓存，来回勾选不会重复请求。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { makeTimeline } from '../modules/viz/Step'
import { SPEEDS, usePlayback } from '../modules/viz/Player'
import { BarRenderer } from '../modules/viz/renderers/BarRenderer'
import { loadDemo, loadVizIndex } from '../modules/viz/data/loader'
import type { VizIndexEntry } from '../modules/viz/data/loader'
import { COUNTER_LABELS } from '../modules/viz/types'
import type { VizDemo } from '../modules/viz/types'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const btn: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }
const btnActive: CSSProperties = { borderColor: 'var(--color-brand)', background: 'var(--color-brand)', color: '#fff' }

const MIN_PANELS = 2
const MAX_PANELS = 4
/** 默认对比这四个：教学上最常考、复杂度梯度最清楚（O(n²) 两个 + O(n log n) 两个） */
const DEFAULT_IDS = ['sort-bubble', 'sort-selection', 'sort-insertion', 'sort-quick']

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: VizIndexEntry[] }

export function VizComparePage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [selected, setSelected] = useState<string[]>([])
  const [loaded, setLoaded] = useState<Record<string, VizDemo>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadedIds = useRef(new Set<string>())
  const [reloadKey, setReloadKey] = useState(0)

  // ① 取索引里的排序类演示（category === 'sort'），默认勾上 DEFAULT_IDS
  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadVizIndex().then(
      (index) => {
        if (!alive) return
        const items = index.demos.filter((d) => d.category === 'sort')
        setPhase({ kind: 'ready', items })
        const preferred = DEFAULT_IDS.filter((id) => items.some((d) => d.id === id))
        setSelected(preferred.length >= MIN_PANELS ? preferred.slice(0, MAX_PANELS) : items.slice(0, MAX_PANELS).map((d) => d.id))
      },
      (error: unknown) => {
        if (alive) setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [reloadKey])

  // ② 勾选变化时补拉缺的语料（已拉过的直接命中 loader 缓存，这里再拦一层避免重复 setState）
  useEffect(() => {
    const missing = selected.filter((id) => !loadedIds.current.has(id))
    if (missing.length === 0) return
    let alive = true
    for (const id of missing) loadedIds.current.add(id)
    Promise.all(missing.map((id) => loadDemo(id))).then(
      (demos) => {
        if (!alive) return
        setLoaded((prev) => {
          const next = { ...prev }
          for (const d of demos) next[d.id] = d
          return next
        })
      },
      (error: unknown) => {
        if (!alive) return
        for (const id of missing) loadedIds.current.delete(id)
        setLoadError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { alive = false }
  }, [selected])

  const items = phase.kind === 'ready' ? phase.items : []
  // 面板顺序按索引顺序（不按点击顺序），换勾选时画面位置不跳
  const panels = items.filter((it) => selected.includes(it.id)).map((it) => loaded[it.id]).filter((d): d is VizDemo => d != null)
  const maxSteps = panels.reduce((m, d) => Math.max(m, d.steps.length), 1)
  const pb = usePlayback(maxSteps)

  const toggle = (id: string): void => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.length > MIN_PANELS ? prev.filter((x) => x !== id) : prev
      return prev.length < MAX_PANELS ? [...prev, id] : prev
    })
  }

  if (phase.kind === 'loading') return <p className="text-sm" style={muted}>正在加载演示索引…</p>

  if (phase.kind === 'error') {
    return (
      <section className="rounded-xl border p-6" style={panel}>
        <p className="text-sm font-semibold">演示索引加载失败</p>
        <p className="mt-1 text-sm" style={muted}>{phase.message}</p>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mt-3 rounded-md border px-3 py-1.5 text-sm" style={btn}>
          重试
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Link to="/viz" className="text-sm underline" style={muted}>← 返回演示列表</Link>
        <h1 className="text-2xl font-semibold">⚖️ 多算法对比</h1>
        <p className="text-sm" style={muted}>
          同一组输入 [{panels[0]?.meta.input?.join(', ') ?? '…'}] 并排跑，共享一条时间轴同步步进；
          走完的算法停在末步，比较次数 / 交换次数直接可比。
        </p>
      </header>

      {items.length < MIN_PANELS ? (
        <p className="rounded-xl border p-6 text-sm" style={{ ...panel, ...muted }}>
          排序类演示不足 {MIN_PANELS} 个，无法对比（当前 {items.length} 个）。请先跑 npm run gen:viz。
        </p>
      ) : (
        <>
          <section className="rounded-xl border p-3" style={panel}>
            <p className="mb-2 text-xs" style={muted}>
              选择并排算法（{selected.length} / {MAX_PANELS}，至少 {MIN_PANELS} 个）
            </p>
            <div className="flex flex-wrap gap-2">
              {items.map((it) => {
                const on = selected.includes(it.id)
                const blocked = !on && selected.length >= MAX_PANELS
                return (
                  <button
                    key={it.id}
                    type="button"
                    data-role="cmp-pick"
                    data-demo={it.id}
                    data-on={on ? '1' : '0'}
                    aria-pressed={on}
                    disabled={blocked}
                    onClick={() => toggle(it.id)}
                    className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                    style={on ? btnActive : btn}
                  >
                    {it.title}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border p-3" style={panel}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-role="cmp-reset" aria-label="重置" onClick={() => { pb.reset() }} className="rounded-md border px-3 py-1.5 text-sm" style={btn}>⏮ 重置</button>
              <button type="button" data-role="cmp-prev" aria-label="上一步" disabled={pb.index <= 0} onClick={() => { pb.pause(); pb.prev() }} className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" style={btn}>◀ 上一步</button>
              <button
                type="button"
                data-role="cmp-play"
                aria-label={pb.playing ? '暂停' : '播放'}
                onClick={() => { if (pb.playing) pb.pause(); else { if (pb.index >= maxSteps - 1) pb.seekTo(0); pb.play() } }}
                className="rounded-md border px-4 py-1.5 text-sm font-medium"
                style={pb.playing ? btnActive : btn}
              >
                {pb.playing ? '⏸ 暂停' : '▶ 播放'}
              </button>
              <button type="button" data-role="cmp-next" aria-label="下一步" disabled={pb.index >= maxSteps - 1} onClick={() => { pb.pause(); pb.next() }} className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" style={btn}>下一步 ▶</button>
              <button type="button" data-role="cmp-last" aria-label="末步" disabled={pb.index >= maxSteps - 1} onClick={() => { pb.pause(); pb.last() }} className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" style={btn}>末步 ⏭</button>
              <span className="ml-auto flex items-center gap-1 text-sm" style={muted}>
                速度
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-label={`速度 ${s}x`} onClick={() => pb.setSpeed(s)} className="rounded-md border px-2 py-1 text-xs" style={pb.speed === s ? btnActive : btn}>
                    {s}x
                  </button>
                ))}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                aria-label="进度"
                min={0}
                max={Math.max(0, maxSteps - 1)}
                value={pb.index}
                onChange={(e) => { pb.pause(); pb.seekTo(Number(e.target.value)) }}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-full"
                style={{ background: 'var(--border)' }}
              />
              <span data-role="cmp-step" className="whitespace-nowrap font-mono text-xs" style={muted}>
                步骤 {pb.index + 1} / {maxSteps}
              </span>
            </div>
          </section>

          {loadError && (
            <p className="rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--fg-bad)', color: 'var(--fg-bad)' }}>
              语料加载失败：{loadError}
            </p>
          )}

          {panels.length === 0 && (
            <p className="text-sm" style={muted}>正在加载所选演示的语料…</p>
          )}

          <div className="grid gap-4 lg:grid-cols-2" data-role="cmp-grid">
            {panels.map((demo) => <ComparePanel key={demo.id} demo={demo} index={pb.index} />)}
          </div>
        </>
      )}
    </div>
  )
}

function ComparePanel({ demo, index }: { demo: VizDemo; index: number }) {
  const timeline = makeTimeline(demo.steps, index)
  const step = timeline.current
  const ended = index >= demo.steps.length
  const counters = (step?.snapshot.counters ?? {}) as Record<string, number>

  return (
    <section className="rounded-xl border p-3" style={panel} data-role="cmp-panel" data-demo={demo.id}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <Link to={`/viz/${demo.id}`} className="text-sm font-semibold hover:underline">{demo.title}</Link>
        <span className="whitespace-nowrap font-mono text-xs" style={muted}>
          {Math.min(index + 1, demo.steps.length)} / {demo.steps.length} 步
        </span>
      </header>

      {step ? <BarRenderer demo={demo} step={step} compact /> : (
        <p className="text-sm" style={muted}>（本演示暂无步骤）</p>
      )}

      <p className="mt-2 flex flex-wrap gap-1 text-xs" style={muted}>
        {Object.entries(counters).map(([k, v]) => (
          <span key={k} className="rounded border px-1.5 py-0.5 font-mono" style={{ borderColor: 'var(--border)' }} data-counter={k} data-value={v}>
            {COUNTER_LABELS[k] ?? k} {v}
          </span>
        ))}
        {ended && demo.steps.length > 0 && (
          <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--fg-ok)', color: 'var(--fg-ok)' }} data-role="cmp-ended">
            已结束，停在末步
          </span>
        )}
      </p>

      <p className="mt-1 line-clamp-2 text-xs" style={muted} data-role="cmp-desc">{step?.description ?? '—'}</p>
    </section>
  )
}