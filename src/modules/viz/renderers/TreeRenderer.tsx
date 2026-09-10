/**
 * R3 树渲染器（覆盖：二叉树遍历、BST、堆、AVL、哈夫曼）。
 *
 * 布局用「叶子计数器 + 内部结点取子树中点」的经典 tidy tree：
 *   叶子按遍历顺序占一个 x 槽，父节点 x = 首尾子节点中点，y = 深度。
 * children 里的 null 占位直接跳过（保持二叉树左右形态由生成器负责）。
 * 先画边再画结点，结点用圆圈 + 值，role 决定描边色（CSS 变量，深浅色自适应）。
 */
import { ROLE_COLOR } from './BarRenderer'
import type { TreeNodeViz, VizRendererProps } from '../types'

interface Pos { x: number; y: number }

export function TreeRenderer({ step, compact = false }: VizRendererProps) {
  const snap = step.snapshot
  if (snap.kind !== 'tree') return null
  const root = snap.root

  const pos = new Map<string, Pos>()
  const parentOf = new Map<string, string>()
  let cursor = 0
  let maxY = 0

  const place = (node: TreeNodeViz, depth: number, parent: string | null): void => {
    if (parent != null) parentOf.set(node.key, parent)
    if (depth > maxY) maxY = depth
    const kids = node.children.filter((c): c is TreeNodeViz => c != null)
    if (kids.length === 0) {
      pos.set(node.key, { x: cursor++, y: depth })
      return
    }
    for (const k of kids) place(k, depth + 1, node.key)
    const first = pos.get(kids[0]!.key)
    const last = pos.get(kids[kids.length - 1]!.key)
    const fx = first ? first.x : 0
    const lx = last ? last.x : 0
    pos.set(node.key, { x: (fx + lx) / 2, y: depth })
  }
  if (root) place(root, 0, null)

  const slotX = compact ? 34 : 48
  const slotY = compact ? 40 : 56
  const padX = 22
  const padY = 22
  const r = compact ? 12 : 16
  const maxX = cursor > 0 ? cursor - 1 : 0
  const W = padX * 2 + maxX * slotX + r * 2
  const H = padY * 2 + maxY * slotY + r * 2
  const px = (p: Pos): number => padX + p.x * slotX + r
  const py = (p: Pos): number => padY + p.y * slotY + r

  const counters = snap.counters ?? {}
  const counterEntries = Object.entries(counters)

  // 收集所有结点，画边（父→子）再画结点
  const all: TreeNodeViz[] = []
  const collect = (node: TreeNodeViz): void => {
    all.push(node)
    for (const c of node.children) if (c != null) collect(c)
  }
  if (root) collect(root)

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
      {!root ? (
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>（空树）</p>
      ) : (
        <svg data-role="tree" width="100%" height={compact ? 150 : 260} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="树演示">
          {all.map((nd) => {
            const p = pos.get(nd.key)
            const pk = parentOf.get(nd.key)
            if (!p || !pk) return null
            const pp = pos.get(pk)
            if (!pp) return null
            return <line key={`e-${nd.key}`} x1={px(pp)} y1={py(pp)} x2={px(p)} y2={py(p)} stroke="var(--border)" strokeWidth={1.5} />
          })}
          {all.map((nd) => {
            const p = pos.get(nd.key)
            if (!p) return null
            const role = nd.role ?? 'idle'
            return (
              <g key={nd.key} data-role="tree-node" data-key={nd.key}>
                <circle cx={px(p)} cy={py(p)} r={r} fill="var(--bg-elev)"
                  stroke={role === 'idle' ? 'var(--border)' : ROLE_COLOR[role]}
                  strokeWidth={role === 'idle' ? 1.5 : 3} style={{ transition: 'stroke 300ms ease' }} />
                <text x={px(p)} y={py(p) + 4} textAnchor="middle" fontSize={compact ? 11 : 13} fontWeight={700} fill="var(--fg)" className="font-mono">{nd.label}</text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}