/**
 * R1 柱状图渲染器（覆盖：8 种排序、数组增删改查、二分/顺序查找、字符串匹配）。
 *
 * 纯 SVG + CSS transition（规范一：不引重型动画库）。柱子按下标定位（key=index），
 * 交换时两根柱子的高度/颜色在原位过渡，读起来就是「值在移动」。所有颜色走 CSS 变量
 * （--color-viz-*），深浅色主题自适应；compact 供对比模式的小面板用。
 */
import type { CSSProperties } from 'react'
import { COUNTER_LABELS } from '../types'
import type { VizRendererProps, VizRole } from '../types'

export const ROLE_COLOR: Record<VizRole, string> = {
  idle: 'var(--color-viz-idle)',
  compare: 'var(--color-viz-compare)',
  swap: 'var(--color-viz-swap)',
  sorted: 'var(--color-viz-sorted)',
  pivot: 'var(--color-viz-pivot)',
  active: 'var(--color-viz-active)',
}

const chip: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)' }
const rectTransition: CSSProperties = {
  transition: 'height 300ms ease, y 300ms ease, x 300ms ease, fill 300ms ease',
}

export function BarRenderer({ step, compact = false }: VizRendererProps) {
  const snap = step.snapshot
  if (snap.kind !== 'bar') return null
  const values = snap.values
  const n = values.length
  const counters = snap.counters ?? {}
  const counterEntries = Object.entries(counters)

  const slot = compact ? 26 : 46
  const padX = 10
  const topPad = compact ? 14 : 20
  const plotH = compact ? 84 : 170
  const barW = Math.round(slot * 0.6)
  const W = padX * 2 + Math.max(1, n) * slot
  const axisY = topPad + plotH
  const maxV = n > 0 ? Math.max(1, ...values) : 1

  // 指针标签按 index 分列堆叠（low/mid 可能落在同一下标）
  const stackRow = new Map<number, number>()
  let maxStack = 0
  const pointers = (snap.pointers ?? []).filter((p) => p.index >= 0 && p.index < n)
  for (const p of pointers) {
    const r = stackRow.get(p.index) ?? 0
    stackRow.set(p.index, r + 1)
    if (r + 1 > maxStack) maxStack = r + 1
  }
  const indexRowH = compact ? 12 : 16
  const ptrRowH = compact ? 12 : 15
  const ptrAreaH = maxStack > 0 ? 4 + maxStack * ptrRowH : 0
  const H = axisY + indexRowH + ptrAreaH + 6
  const seen = new Map<number, number>()

  const svgH = compact ? 150 : 280

  return (
    <div className="space-y-2">
      {counterEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {counterEntries.map(([k, v]) => (
            <span
              key={k}
              data-counter={k}
              data-value={v}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs"
              style={chip}
            >
              <span style={{ color: 'var(--fg-muted)' }}>{COUNTER_LABELS[k] ?? k}</span>
              <b>{v}</b>
            </span>
          ))}
        </div>
      )}
      {n === 0 ? (
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>（空数组）</p>
      ) : (
        <svg
          data-role="bar-chart"
          width="100%"
          height={svgH}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="柱状图演示"
        >
          {/* 基线 */}
          <line x1={padX} y1={axisY} x2={W - padX} y2={axisY} stroke="var(--border)" strokeWidth={1} />
          {values.map((v, i) => {
            const h = Math.max(2, Math.round((v / maxV) * plotH))
            const x = padX + i * slot + (slot - barW) / 2
            const y = axisY - h
            const role = snap.roles[i] ?? 'idle'
            return (
              <g key={i}>
                <rect
                  data-role="viz-bar"
                  data-index={i}
                  data-value={v}
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={ROLE_COLOR[role]}
                  stroke={role === 'idle' ? 'transparent' : 'var(--fg)'}
                  strokeWidth={role === 'idle' ? 0 : 1}
                  style={rectTransition}
                />
                {!compact && (
                  <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={11} fill="var(--fg)" className="font-mono">
                    {v}
                  </text>
                )}
                <text x={x + barW / 2} y={axisY + indexRowH - 3} textAnchor="middle" fontSize={compact ? 9 : 11} fill="var(--fg-muted)" className="font-mono">
                  {i}
                </text>
              </g>
            )
          })}
          {pointers.map((p, k) => {
            const row = seen.get(p.index) ?? 0
            seen.set(p.index, row + 1)
            const cx = padX + p.index * slot + slot / 2
            const cy = axisY + indexRowH + 4 + row * ptrRowH + ptrRowH / 2
            return (
              <text
                key={`${p.label}-${k}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                fontSize={compact ? 9 : 11}
                fontWeight={700}
                fill="var(--color-brand)"
                className="font-mono"
                style={{ transition: 'x 300ms ease' }}
              >
                {p.label}
              </text>
            )
          })}
        </svg>
      )}
      {!compact && (
        <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {(['idle', 'compare', 'swap', 'pivot', 'sorted'] as VizRole[]).map((r) => (
            <span key={r} className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: ROLE_COLOR[r] }} />
              {r === 'idle' ? '未处理' : r === 'compare' ? '比较中' : r === 'swap' ? '交换/移动' : r === 'pivot' ? '基准/在队' : '已就位'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}