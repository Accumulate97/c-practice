/**
 * 3D 图（scene: graph3d，快照 kind: graph）—— 力导向立体布局 + DFS/BFS 扩散。
 *
 * 语料里的 node.x / node.y 是给 2D 渲染器的 0–100 归一化平面坐标。3D 馆不复用它当最终位置，
 * 而是跑一遍**确定性**力导向，把结点摊到三维空间里；平面坐标只作为弱锚点参与迭代，
 * 让 3D 布局与学生在 2D 馆看到的形状大致同构（不至于认不出是同一张图）。
 *
 * 为什么必须确定性：语料的每一步是完整快照，步间结点集合不变；若布局带随机数，
 * 每切一步整张图就重排一次，DFS/BFS 的「扩散方向」根本没法看。
 * 所以初值由 key 的 FNV-1a 哈希决定，同 key 永远同初值 → 同布局。
 *
 * 3D 相对 2D 多给的信息：DFS 递归深入时，前沿结点会沿纵深方向推进，
 * 「一条路走到底再回溯」在立体空间里是一条明显折向远处的路径；
 * BFS 的「一圈一圈」则表现为以起点为球心的壳层扩张。
 *
 * mesh 预算：n 球 + n 标签 + e 线 + e 权值标签 + 有向箭头锥 ≤ 4e + 2n，n ≤ 12 时 ≤ 110 个。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { Quaternion, Vector3 } from 'three'
import type { GraphEdgeViz, GraphNodeViz, GraphSnapshot } from '../../viz/types'
import type { Scene3DProps } from '../types'
import { roleHex, sceneTheme } from '../palette'
import { Mover, TextLabel, type Vec3 } from '../widgets'

const ITER = 280
const IDEAL = 5.2

/** FNV-1a：把字符串 key 变成 [0,1) 的稳定伪随机数 */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function forceLayout3D(nodes: GraphNodeViz[], edges: GraphEdgeViz[]): Map<string, Vec3> {
  const idx = new Map<string, number>()
  nodes.forEach((n, i) => idx.set(n.key, i))
  // 初值：球面均匀散布（斐波那契球 + 哈希抖动），半径与结点数相关
  const pos = nodes.map((n, i) => {
    const ga = Math.PI * (3 - Math.sqrt(5))
    const y = 1 - (i / Math.max(1, nodes.length - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const th = ga * i + hash01(n.key, 1) * 0.9
    const rad = IDEAL * Math.cbrt(Math.max(4, nodes.length)) * 0.62
    return new Vector3(Math.cos(th) * r * rad, y * rad * 0.72, Math.sin(th) * r * rad)
  })
  // 平面坐标锚点：x → x，y → z（y 在 3D 里留给高度）
  const anchor = nodes.map((n) => new Vector3(((n.x ?? 50) - 50) * 0.14, 0, ((n.y ?? 50) - 50) * 0.14))
  const disp = nodes.map(() => new Vector3())

  for (let it = 0; it < ITER; it += 1) {
    const temp = IDEAL * 0.42 * (1 - it / ITER) + 0.02
    for (let i = 0; i < pos.length; i += 1) disp[i]?.set(0, 0, 0)
    // 斥力：全对，n ≤ 12 → 最多 66 对，成本可忽略
    for (let i = 0; i < pos.length; i += 1) {
      const pi = pos[i]
      const ni = nodes[i]
      if (!pi || !ni) continue
      for (let j = i + 1; j < pos.length; j += 1) {
        const pj = pos[j]
        const nj = nodes[j]
        if (!pj || !nj) continue
        const d = pi.clone().sub(pj)
        let len = d.length()
        if (len < 1e-4) { d.set(hash01(ni.key, 7) - 0.5, hash01(nj.key, 9) - 0.5, 0.3); len = d.length() }
        d.multiplyScalar((IDEAL * IDEAL) / len / len)
        disp[i]?.add(d)
        disp[j]?.sub(d)
      }
    }
    // 引力：沿边收拢
    for (const e of edges) {
      const a = idx.get(e.from)
      const b = idx.get(e.to)
      if (a === undefined || b === undefined) continue
      const pa = pos[a]
      const pb = pos[b]
      if (!pa || !pb) continue
      const d = pa.clone().sub(pb)
      const len = Math.max(1e-4, d.length())
      d.multiplyScalar((len * len) / IDEAL / len)
      disp[a]?.sub(d)
      disp[b]?.add(d)
    }
    // 锚点 + 位移限幅 + 压扁高度（图太「立」会让标签互相遮挡）
    for (let i = 0; i < pos.length; i += 1) {
      const p = pos[i]
      const an = anchor[i]
      const dp = disp[i]
      if (!p || !an || !dp) continue
      dp.add(an.clone().sub(p).multiplyScalar(0.055))
      const l = dp.length()
      if (l > 0) p.add(dp.multiplyScalar(Math.min(l, temp) / l))
      p.y *= 0.94
    }
  }
  // 归一：质心搬到原点，最大半径缩放到可读范围
  const c = pos.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / Math.max(1, pos.length))
  pos.forEach((p) => p.sub(c))
  const maxR = Math.max(0.001, ...pos.map((p) => p.length()))
  const target = IDEAL * Math.cbrt(Math.max(4, nodes.length)) * 0.92
  const out = new Map<string, Vec3>()
  nodes.forEach((n, i) => {
    const src = pos[i]
    if (!src) return
    const p = src.clone().multiplyScalar(target / maxR)
    out.set(n.key, [p.x, p.y * 0.86 + 2.6, p.z])
  })
  return out
}

export function Graph3D({ step, dark }: Scene3DProps) {
  const snap = step.snapshot as GraphSnapshot
  const theme = sceneTheme(dark)
  const nodes = snap.nodes ?? []
  const edges = snap.edges ?? []
  // 布局只依赖拓扑（key 集合 + 边集合），与 role 无关 —— 所以切换步骤时图不会重排
  const topoKey = nodes.map((n) => n.key).join('|') + '#' + edges.map((e) => `${e.from}>${e.to}`).join('|')
  const layout = useMemo(() => forceLayout3D(nodes, edges), [topoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const labelBg = dark ? 'rgba(11,17,32,0.78)' : 'rgba(255,255,255,0.82)'

  return (
    <group>
      {edges.map((e, i) => {
        const a = layout.get(e.from)
        const b = layout.get(e.to)
        if (!a || !b) return null
        const hot = Boolean(e.role && e.role !== 'idle')
        const color = e.role ? roleHex(e.role) : theme.nodeEdge
        const va = new Vector3(...a)
        const vb = new Vector3(...b)
        const dir = vb.clone().sub(va)
        const len = Math.max(0.001, dir.length())
        dir.multiplyScalar(1 / len)
        const start = va.clone().add(dir.clone().multiplyScalar(0.52))
        const end = vb.clone().sub(dir.clone().multiplyScalar(e.directed ? 0.72 : 0.52))
        const mid = start.clone().add(end).multiplyScalar(0.5)
        return (
          <group key={`e${i}`}>
            <Line points={[[start.x, start.y, start.z], [end.x, end.y, end.z]]} color={color} lineWidth={hot ? 3 : 1.5} transparent opacity={hot ? 0.98 : 0.5} />
            {e.directed ? (
              <mesh
                position={[end.x, end.y, end.z]}
                quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)}
              >
                <coneGeometry args={[0.17, 0.46, 14]} />
                <meshBasicMaterial color={color} transparent opacity={hot ? 1 : 0.6} toneMapped={false} />
              </mesh>
            ) : null}
            {e.weight !== undefined ? (
              <TextLabel
                text={String(e.weight)}
                position={[mid.x, mid.y + 0.3, mid.z]}
                color={hot ? color : theme.text}
                height={0.28}
                bold={hot}
                background={labelBg}
                depthTest={false}
                renderOrder={4}
              />
            ) : null}
          </group>
        )
      })}

      {nodes.map((n) => {
        const p = layout.get(n.key) ?? [0, 2.6, 0]
        const active = Boolean(n.role && n.role !== 'idle')
        return (
          <Mover key={n.key} position={p} speed={10}>
            <mesh>
              <sphereGeometry args={[active ? 0.62 : 0.5, 24, 18]} />
              <meshLambertMaterial color={roleHex(n.role)} />
            </mesh>
            <TextLabel text={n.label} position={[0, 0, 0]} color={dark ? '#0b1120' : '#ffffff'} height={0.32} bold={active} />
            {active ? (
              // 前沿/已访问的结点加一圈光环：旋转视角时被挡住也能靠光环认出来
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.86, 0.035, 8, 40]} />
                <meshBasicMaterial color={roleHex(n.role)} toneMapped={false} transparent opacity={0.85} />
              </mesh>
            ) : null}
          </Mover>
        )
      })}
    </group>
  )
}

export function graph3DCamera(n: number): { position: Vec3; target: Vec3 } {
  const r = IDEAL * Math.cbrt(Math.max(4, n)) * 0.92
  const d = Math.min(70, r * 3.1 + 8)
  return { position: [d * 0.42, d * 0.62, d], target: [0, 2.6, 0] }
}
