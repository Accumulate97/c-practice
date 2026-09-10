/**
 * R4 图渲染器（覆盖：DFS/BFS、最短路径、最小生成树、拓扑排序）。
 *
 * 结点坐标是 0–100 归一化值，这里映射到 viewBox（生成器只管相对布局，渲染器管缩放）。
 * 有向边画箭头（marker），无向边画直线；weight 标在中点。role 决定结点描边与边颜色。
 * 边先画、结点压在上面，避免箭头被圆圈盖住。
 */
import { ROLE_COLOR } from './BarRenderer'
import type { VizRendererProps } from '../types'

export function GraphRenderer({ step, compact = false }: VizRendererProps) {
  const snap = step.snapshot
  if (snap.kind !== 'graph') return null
  const nodes = snap.nodes
  const key2 = new Map<string, { x: number; y: number }>()

  const VW = 100
  const VH = 100
  const r = compact ? 4 : 5.5
  for (const nd of nodes) key2.set(nd.key, { x: nd.x, y: nd.y })

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
      <svg data-role="graph" width="100%" height={compact ? 150 : 300} viewBox={`-6 -6 ${VW + 12} ${VH + 12}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="图演示">
        <defs>
          <marker id="g-arrow" markerWidth="6" markerHeight="6" refX="4.5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="context-stroke" />
          </marker>
        </defs>
        {snap.edges.map((e, k) => {
          const a = key2.get(e.from)
          const b = key2.get(e.to)
          if (!a || !b) return null
          const color = e.role ? ROLE_COLOR[e.role] : 'var(--border)'
          // 有向边：箭头缩到目标圆边上，避免被盖住
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.max(0.001, Math.hypot(dx, dy))
          const ux = dx / len
          const uy = dy / len
          const sx = a.x + ux * r
          const sy = a.y + uy * r
          const tx = b.x - ux * (r + (e.directed ? 2 : 0))
          const ty = b.y - uy * (r + (e.directed ? 2 : 0))
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          return (
            <g key={`e-${k}`}>
              <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={color} strokeWidth={e.role ? 1.6 : 1}
                markerEnd={e.directed ? 'url(#g-arrow)' : undefined} style={{ transition: 'stroke 300ms ease' }} />
              {e.weight != null && (
                <text x={mx} y={my - 1.5} textAnchor="middle" fontSize={3.4} fill="var(--fg-muted)" className="font-mono">{e.weight}</text>
              )}
            </g>
          )
        })}
        {nodes.map((nd) => {
          const role = nd.role ?? 'idle'
          return (
            <g key={nd.key} data-role="graph-node" data-key={nd.key}>
              <circle cx={nd.x} cy={nd.y} r={r} fill="var(--bg-elev)"
                stroke={role === 'idle' ? 'var(--border)' : ROLE_COLOR[role]}
                strokeWidth={role === 'idle' ? 0.8 : 1.8} style={{ transition: 'stroke 300ms ease' }} />
              <text x={nd.x} y={nd.y + 1.4} textAnchor="middle" fontSize={compact ? 3.4 : 4} fontWeight={700} fill="var(--fg)" className="font-mono">{nd.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}