/**
 * 演示列表页（阶段 7 · 任务 1）：/#/viz。
 *
 * 与题目列表页同一套纪律：
 *   · 纯静态无后端 —— 数据只来自 public/data/viz/index.json（12 条 / 3 KB），
 *     完整 steps 留在 {id}.json，由详情页按需 fetch，列表页不为它付一分钱流量；
 *   · 索引加载失败可重试（loader 内部失败即清缓存），不把网络故障当「没有演示」；
 *   · 分组顺序取自 registry.CATEGORY_LABELS，与 5 套渲染器的分类口径同源，不留第二份表。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { groupByCategory, loadVizIndex } from '../modules/viz/data/loader'
import type { VizIndex, VizIndexEntry } from '../modules/viz/data/loader'
import { CATEGORY_LABELS, categoryLabel, rendererFor } from '../modules/viz/registry'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS)

/** 已登记的分类按登记顺序排，未登记的排最后（按字母），避免新增分类时顺序随机 */
function byCategoryOrder(a: string, b: string): number {
  const ia = CATEGORY_ORDER.indexOf(a)
  const ib = CATEGORY_ORDER.indexOf(b)
  const wa = ia === -1 ? CATEGORY_ORDER.length : ia
  const wb = ib === -1 ? CATEGORY_ORDER.length : ib
  return wa - wb || a.localeCompare(b)
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; index: VizIndex }

export function VizListPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadVizIndex().then(
      (index) => { if (alive) setPhase({ kind: 'ready', index }) },
      (error: unknown) => {
        if (alive) setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [reloadKey])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">🎬 可视化演示</h1>
        <p className="mt-1 text-sm" style={muted}>
          算法写成生成器逐步产出状态快照，可播放 / 单步 / 后退 / 跳到任意步；
          5 套通用渲染器（柱状图 · 节点链 · 树 · 图 · 内存格）覆盖全部演示。
        </p>
      </header>

      {phase.kind === 'loading' && (
        <p className="text-sm" style={muted}>正在加载演示索引…</p>
      )}

      {phase.kind === 'error' && (
        <section className="rounded-xl border p-6" style={panel}>
          <p className="text-sm font-semibold">演示索引加载失败</p>
          <p className="mt-1 text-sm" style={muted}>{phase.message}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
          >
            重试
          </button>
        </section>
      )}

      {phase.kind === 'ready' && <Ready index={phase.index} />}
    </div>
  )
}

function Ready({ index }: { index: VizIndex }) {
  const groups = groupByCategory(index).sort((a, b) => byCategoryOrder(a.category, b.category))
  const sortCount = index.demos.filter((d) => d.category === 'sort').length

  if (index.count === 0) {
    return (
      <p className="rounded-xl border p-6 text-sm" style={{ ...panel, ...muted }}>
        演示语料还没生成，请先跑 npm run gen:viz 与 npm run build:index。
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {sortCount >= 2 && (
        <Link
          to="/viz/compare"
          data-role="viz-compare-entry"
          className="block rounded-xl border p-4 transition-colors hover:border-[var(--color-brand)]"
          style={panel}
        >
          <p className="text-sm font-semibold">⚖️ 多算法对比模式</p>
          <p className="mt-1 text-xs" style={muted}>
            同屏并排 2–4 个排序算法，同一组输入、同步步进，直接比比较次数与交换次数（已生成 {sortCount} 种排序）。
          </p>
        </Link>
      )}

      {groups.map((group) => (
        <section key={group.category} className="space-y-2">
          <h2 className="text-sm font-semibold" style={muted}>
            {categoryLabel(group.category)}
            <span className="ml-2 font-normal">（{group.items.length} 个演示）</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => <DemoCard key={item.id} item={item} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function DemoCard({ item }: { item: VizIndexEntry }) {
  return (
    <Link
      to={`/viz/${item.id}`}
      data-role="viz-card"
      data-demo={item.id}
      className="block rounded-xl border p-4 transition-colors hover:border-[var(--color-brand)]"
      style={panel}
    >
      <p className="text-sm font-semibold">{item.title}</p>
      <p className="mt-1 text-xs" style={muted}>{item.chapter}</p>
      <p className="mt-2 flex flex-wrap gap-1 text-xs" style={muted}>
        <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--border)' }}>
          {rendererFor(item.renderer).label}
        </span>
        <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--border)' }}>
          {item.steps} 步
        </span>
        {item.relatedProblems.length > 0 && (
          <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--border)' }}>
            关联 {item.relatedProblems.length} 题
          </span>
        )}
      </p>
    </Link>
  )
}