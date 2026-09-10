/**
 * R5 内存格渲染器（覆盖：指针与地址、数组内存布局、函数调用栈、多级指针、
 * 值传递 vs 地址传递并排对比）——本站差异化优势，C 语言学习者价值最高。
 *
 * 用 HTML+CSS 画（不是 SVG）：内存格本质是「地址|值」的表格，DOM 排版比 SVG 更清晰、
 * 更省代码，且同样吃 CSS 变量做深浅色适配。多个 region 横向并排，正好用于
 * 「值传递 vs 地址传递」这类左右对照。每个 cell 左侧一条 role 色带，值可写成「→ x」表示指针。
 */
import type { CSSProperties } from 'react'
import { ROLE_COLOR } from './BarRenderer'
import { COUNTER_LABELS } from '../types'
import type { VizRendererProps } from '../types'

const regionBox: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const cellBox: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)' }

export function MemoryRenderer({ step, compact = false }: VizRendererProps) {
  const snap = step.snapshot
  if (snap.kind !== 'memory') return null
  const counters = snap.counters ?? {}
  const counterEntries = Object.entries(counters)

  return (
    <div className="space-y-3">
      {counterEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {counterEntries.map(([k, v]) => (
            <span key={k} data-counter={k} data-value={v} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs" style={cellBox}>
              <span style={{ color: 'var(--fg-muted)' }}>{COUNTER_LABELS[k] ?? k}</span><b>{v}</b>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        {snap.regions.map((region) => (
          <div key={region.key} data-role="mem-region" data-key={region.key} className="min-w-[12rem] flex-1 rounded-lg border p-2" style={regionBox}>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-sm font-semibold">{region.title}</span>
              {region.note && <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>{region.note}</span>}
            </div>
            <div className="space-y-1">
              {region.cells.map((cell) => {
                const role = cell.role ?? 'idle'
                return (
                  <div key={cell.key} data-role="mem-cell" data-key={cell.key}
                    className="flex items-stretch overflow-hidden rounded border" style={{ ...cellBox, borderColor: role === 'idle' ? 'var(--border)' : ROLE_COLOR[role] }}>
                    <span className="w-1.5 shrink-0" style={{ background: ROLE_COLOR[role], transition: 'background 300ms ease' }} />
                    <span className="px-2 py-1 font-mono text-[11px]" style={{ color: 'var(--fg-muted)' }}>{cell.address}</span>
                    <span className={"flex-1 px-2 py-1 font-mono " + (compact ? 'text-xs' : 'text-sm')} style={{ fontWeight: 600 }}>{cell.value}</span>
                    {cell.note && <span className="px-2 py-1 font-mono text-[11px]" style={{ color: 'var(--fg-muted)' }}>{cell.note}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}