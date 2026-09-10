/**
 * R2 节点链渲染器（覆盖：单/双链表插删、栈、队列、循环链表）。
 *
 * 结点按 nodes 顺序横向排布；edge.to===null 画成悬空的 ∧（NULL）。
 * 目标在右侧 → 直线箭头（next）；目标在左侧 → 下方弧线（循环/前驱），
 * 这样单链表、循环链表、双链表都能用同一套画法。颜色走 CSS 变量，深浅色自适应。
 * 教学重点是「指针修改顺序」，故 pointers（head/p/new…）单独画在结点上方。
 */
import { ROLE_COLOR } from './BarRenderer'
import type { VizRendererProps } from '../types'

export function NodeChainRenderer({ step, compact = false }: VizRendererProps) {
  const snap = step.snapshot
  if (snap.kind !== 'nodechain') return null
  const nodes = snap.nodes
  const n = nodes.length
  const idx = new Map<string, number>()
  nodes.forEach((nd, i) => idx.set(nd.key, i))

  const slotW = compact ? 82 : 116
  const boxW = slotW - (compact ? 16 : 22)
  const boxH = compact ? 40 : 54
  const padX = 12
  const topPad = 30
  const midY = topPad + boxH / 2
  const W = padX * 2 + Math.max(1, n) * slotW
  const x = (i: number): number => padX + i * slotW + (slotW - boxW) / 2

  const hasBack = snap.edges.some((e) => {
    const a = idx.get(e.from)
    const b = e.to == null ? -1 : idx.get(e.to)
    return a != null && b != null && b <= a
  })
  const H = topPad + boxH + (hasBack ? 64 : 26)

  const counters = snap.counters ?? {}
  const counterEntries = Object.entries(counters)

  return (
    <div className="space-y-2">
      {counterEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {counterEntries.map(([k, v]) => (
            <span key={k} data-counter={k} data-value={v} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <span style={{ color: 'var(--fg-muted)' }}>{k}</span><b>{v}</b>
            </span>
          ))}
        </div>
      )}
      <svg data-role="node-chain" width="100%" height={compact ? 130 : 190} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="节点链演示">
        <defs>
          <marker id="nc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
          </marker>
        </defs>
        {/* 指针标签（画在结点上方） */}
        {(snap.pointers ?? []).map((p, k) => {
          const ti = p.node == null ? -1 : idx.get(p.node) ?? -1
          const cx = ti >= 0 ? x(ti) + boxW / 2 : padX + k * slotW + slotW / 2
          return (
            <g key={`ptr-${k}`}>
              <text x={cx} y={12} textAnchor="middle" fontSize={compact ? 9 : 11} fontWeight={700} fill="var(--color-brand)" className="font-mono">{p.label}</text>
              {ti >= 0 && <line x1={cx} y1={15} x2={cx} y2={topPad - 2} stroke="var(--color-brand)" strokeWidth={1} />}
              {ti < 0 && <text x={cx} y={topPad - 2} textAnchor="middle" fontSize={9} fill="var(--fg-muted)" className="font-mono">NULL</text>}
            </g>
          )
        })}
        {/* 边（先画，结点压在上面） */}
        {snap.edges.map((e, k) => {
          const fi = idx.get(e.from)
          if (fi == null) return null
          const color = e.role ? ROLE_COLOR[e.role] : 'var(--fg-muted)'
          if (e.to == null) {
            const sx = x(fi) + boxW
            return (
              <g key={`e-${k}`}>
                <line x1={sx} y1={midY} x2={sx + 12} y2={midY} stroke={color} strokeWidth={1.5} markerEnd="url(#nc-arrow)" />
                <text x={sx + 20} y={midY + 3} fontSize={compact ? 10 : 12} fill="var(--fg-muted)" className="font-mono">∧</text>
              </g>
            )
          }
          const ti = idx.get(e.to)
          if (ti == null) return null
          if (ti > fi) {
            const sx = x(fi) + boxW
            const tx = x(ti)
            return (
              <g key={`e-${k}`}>
                <line x1={sx} y1={midY} x2={tx - 2} y2={midY} stroke={color} strokeWidth={1.5} markerEnd="url(#nc-arrow)" />
                {e.label && <text x={(sx + tx) / 2} y={midY - 4} textAnchor="middle" fontSize={9} fill="var(--fg-muted)" className="font-mono">{e.label}</text>}
              </g>
            )
          }
          // 回指（循环/前驱）：下方弧线
          const sx = x(fi) + boxW / 2
          const tx = x(ti) + boxW / 2
          const dip = topPad + boxH + 22
          return (
            <g key={`e-${k}`}>
              <path d={`M ${sx} ${topPad + boxH} Q ${sx} ${dip} ${(sx + tx) / 2} ${dip} Q ${tx} ${dip} ${tx} ${topPad + boxH}`} fill="none" stroke={color} strokeWidth={1.5} markerEnd="url(#nc-arrow)" />
              {e.label && <text x={(sx + tx) / 2} y={dip + 12} textAnchor="middle" fontSize={9} fill="var(--fg-muted)" className="font-mono">{e.label}</text>}
            </g>
          )
        })}
        {/* 结点 */}
        {nodes.map((nd, i) => {
          const role = nd.role ?? 'idle'
          const fields = nd.fields ? Object.entries(nd.fields) : []
          return (
            <g key={nd.key} data-role="chain-node" data-key={nd.key}>
              <rect x={x(i)} y={topPad} width={boxW} height={boxH} rx={4}
                fill="var(--bg-elev)" stroke={role === 'idle' ? 'var(--border)' : ROLE_COLOR[role]}
                strokeWidth={role === 'idle' ? 1 : 2.5} style={{ transition: 'stroke 300ms ease' }} />
              <text x={x(i) + boxW / 2} y={topPad + (fields.length ? 20 : boxH / 2 + 4)} textAnchor="middle" fontSize={compact ? 12 : 15} fontWeight={700} fill="var(--fg)" className="font-mono">{nd.label}</text>
              {fields.map(([fk, fv], r) => (
                <text key={fk} x={x(i) + boxW / 2} y={topPad + 33 + r * 11} textAnchor="middle" fontSize={9} fill="var(--fg-muted)" className="font-mono">{fk}={fv}</text>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}