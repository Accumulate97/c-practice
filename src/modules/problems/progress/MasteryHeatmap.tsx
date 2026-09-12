/**
 * 掌握度热力图（阶段 D2）：章节 × 题型 一格一色，鼠标悬停看确切数字。
 * 数据全部来自 heatmap.ts（口径与「按章节/按题型」两张表同源），本组件只渲染。
 * 颜色是图形信息（3:1 即可），文字对比度仍守 AA；数字直接写在格子里，
 * 色觉障碍用户不靠颜色也能读出 passed/total。
 */
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { ProblemIndex } from '../data/loader'
import type { ProgressMap } from './schema'
import { computeHeatmap, cellTitle } from './heatmap'
import type { HeatCell } from './heatmap'
import { typeLabel } from '../type-meta'

const muted: CSSProperties = { color: 'var(--fg-muted)' }

/** level → 背景色。0 档不用纯透明，避免与 'none'（真没题）混淆 */
function cellBackground(level: HeatCell['level']): string {
  switch (level) {
    case 'none': return 'transparent'
    case 0: return 'color-mix(in srgb, var(--fg-muted) 12%, transparent)'
    case 1: return 'color-mix(in srgb, var(--fg-bad) 32%, transparent)'
    case 2: return 'color-mix(in srgb, var(--fg-warn) 42%, transparent)'
    case 3: return 'color-mix(in srgb, var(--color-viz-sorted) 45%, transparent)'
    case 4: return 'color-mix(in srgb, var(--color-viz-sorted) 78%, transparent)'
  }
}

const LEGEND: { level: HeatCell['level']; text: string }[] = [
  { level: 4, text: '全部通过' },
  { level: 3, text: '通过 ≥50%' },
  { level: 2, text: '通过 <50%' },
  { level: 1, text: '做过未通过' },
  { level: 0, text: '未开始' },
  { level: 'none', text: '本章无此题型' },
]

export function MasteryHeatmap({ index, records }: { index: ProblemIndex; records: ProgressMap }) {
  const data = useMemo(() => computeHeatmap(index, records), [index, records])

  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }} data-role="mastery-heatmap" data-rows={String(data.rows.length)} data-cols={String(data.types.length)}>
      <h2 className="text-sm font-semibold">🔥 掌握度热力图（章节 × 题型）</h2>
      <p className="mt-1 text-xs" style={muted}>
        每格数字 = 已通过 / 该格题数（通过口径与上方统计表一致：曾经全绿即算）。颜色越绿掌握越好，红=做过还没通过，灰=未开始。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table
            className="border-collapse text-xs"
            data-role="heatmap-table"
            aria-label="章节 × 题型掌握度热力图：每格数字为已通过题数 / 该格总题数"
          >
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 px-2 py-1 text-left font-medium" style={{ background: 'var(--bg-elev)', color: 'var(--fg-muted)' }}>章节 \ 题型</th>
              {data.types.map((t) => (
                <th key={t} scope="col" className="px-2 py-1 text-center font-medium whitespace-nowrap" style={{ color: 'var(--fg-muted)' }}>{typeLabel(t)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.key} data-role="heatmap-row" data-chapter={row.key}>
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap px-2 py-1 text-left font-normal" style={{ background: 'var(--bg-elev)' }} title={row.key}>{row.label}</th>
                {data.types.map((t) => {
                  const c = row.cells.get(t)!
                  return (
                    <td
                      key={t}
                      className="px-1 py-1 text-center whitespace-nowrap"
                      data-role="heatmap-cell"
                      data-type={t}
                      data-level={String(c.level)}
                      data-passed={String(c.passed)}
                      data-total={String(c.total)}
                      title={cellTitle(row.label, t, c)}
                      style={{ background: cellBackground(c.level), border: '1px solid var(--border)', borderRadius: 4, minWidth: 44 }}
                    >
                      {c.level === 'none' ? <span style={muted}>–</span> : `${c.passed}/${c.total}`}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={muted} data-role="heatmap-legend">
        {LEGEND.map((item) => (
          <span key={String(item.level)} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: cellBackground(item.level), border: '1px solid var(--border)' }} />
            {item.text}
          </span>
        ))}
      </div>
    </section>
  )
}
