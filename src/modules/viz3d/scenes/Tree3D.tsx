/**
 * 3D 二叉树（scene: tree3d，快照 kind: tree）。
 *
 * 布局是整个场景的成败关键，这里刻意**不用**常见的「径向 / 力导向」布局，理由是稳定性：
 *   x = 中序遍历槽位。BST 插入只会新增叶子，已有结点的中序槽位不变 —— 于是插入时
 *       整棵树纹丝不动，只有新结点长出来。径向布局则每插一个结点全树重排，
 *       学生的空间记忆每步都被清空，教学效果反而更差。
 *   y = 深度。层与层等高，一眼看出树高与是否退化成链。
 *   z = 左右子树方向的累积偏移（左孩子往 -z，右孩子往 +z，随深度衰减）。
 *       这一维就是「3D 比 2D 多给的信息」：旋转视角时，某结点的整棵左子树
 *       在纵深上整体偏向一侧，子树边界不需要画框就能看出来。
 *
 * 空孩子也占一个中序槽位：这样「左子树为空」会表现为一段真实的横向空隙，
 * 而不是让右子树贴上来假装平衡 —— 二叉树的左右是有区别的，布局必须诚实。
 *
 * 递归分两趟而不是一趟：第一趟定坐标（必须先走完左子树才知道本结点的中序槽位，
 * 所以当下拿不到父坐标），第二趟按 key 回填 parent 与中序序号。n ≤ 50，成本可忽略，
 * 换来的是「布局」与「父子关系」两件互不耦合的事，改一个不会碰坏另一个。
 *
 * mesh 预算：n 个球 + 2n 个标签 + (n-1) 条边 + 深度环 ≤ 4n + 8，n ≤ 31 时最多 132 个。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { TreeNodeViz, TreeSnapshot } from '../../viz/types'
import type { Scene3DProps } from '../types'
import { roleHex, sceneTheme } from '../palette'
import { Mover, TextLabel, type Vec3 } from '../widgets'

const SLOT_W = 1.55
const LEVEL_H = 1.95
const Z_STEP = 2.3
const TOP_Y = 5.2

interface Laid {
  key: string
  label: string
  role?: TreeNodeViz['role']
  pos: Vec3
  parent: Vec3 | null
  depth: number
  /** 中序序号（1-based），显示在结点下方 */
  slot: number
}

interface Raw {
  key: string
  label: string
  role?: TreeNodeViz['role']
  pos: Vec3
  depth: number
}

function layoutTree(root: TreeNodeViz | null): { nodes: Laid[]; slots: number; maxDepth: number } {
  const raw: Raw[] = []
  let cursor = 0
  let maxDepth = 0

  const walk = (n: TreeNodeViz | null, depth: number, z: number): void => {
    if (!n) {
      cursor += 1 // 空孩子占一个槽位
      return
    }
    const kids = n.children ?? []
    const damp = 1 / (1 + 0.42 * depth)
    walk(kids[0] ?? null, depth + 1, z - Z_STEP * damp)
    const slot = cursor
    cursor += 1
    raw.push({
      key: n.key,
      label: n.label,
      role: n.role,
      pos: [slot * SLOT_W, TOP_Y - depth * LEVEL_H, z],
      depth,
    })
    maxDepth = Math.max(maxDepth, depth)
    // 三叉及以上（哈夫曼合并树等）也要落位：第 3 个起沿 +z 继续排，不静默丢结点
    for (let i = 1; i < kids.length; i += 1) {
      walk(kids[i] ?? null, depth + 1, z + Z_STEP * damp * (1 + 0.6 * (i - 1)))
    }
  }
  walk(root, 0, 0)

  const byKey = new Map<string, Vec3>(raw.map((r) => [r.key, r.pos]))
  const parentOf = new Map<string, string | null>()
  const slotOf = new Map<string, number>()
  let counter = 0
  const walk2 = (n: TreeNodeViz | null, parentKey: string | null): void => {
    if (!n) return
    const kids = n.children ?? []
    walk2(kids[0] ?? null, n.key)
    counter += 1
    slotOf.set(n.key, counter)
    parentOf.set(n.key, parentKey)
    for (let i = 1; i < kids.length; i += 1) walk2(kids[i] ?? null, n.key)
  }
  walk2(root, null)

  const nodes: Laid[] = raw.map((r) => {
    const pk = parentOf.get(r.key)
    return { ...r, parent: pk ? byKey.get(pk) ?? null : null, slot: slotOf.get(r.key) ?? 0 }
  })
  return { nodes, slots: Math.max(cursor, 1), maxDepth }
}

export function Tree3D({ step, dark }: Scene3DProps) {
  const snap = step.snapshot as TreeSnapshot
  const theme = sceneTheme(dark)
  const { nodes, slots, maxDepth } = useMemo(() => layoutTree(snap.root), [snap])

  const offsetX = -((slots - 1) / 2) * SLOT_W

  return (
    <group>
      {/* 深度参考环：每层一圈，旋转时用来判断「这是第几层」 */}
      {Array.from({ length: maxDepth + 1 }, (_, d) => {
        const r = 1.1 + d * 1.35
        return (
          <mesh key={`ring${d}`} position={[0, TOP_Y - d * LEVEL_H, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[r, r + 0.04, 72]} />
            <meshBasicMaterial color={theme.grid} transparent opacity={0.35} toneMapped={false} />
          </mesh>
        )
      })}

      {nodes.map((nd) =>
        nd.parent ? (
          <Line
            key={`e${nd.key}`}
            points={[
              [nd.parent[0] + offsetX, nd.parent[1], nd.parent[2]],
              [nd.pos[0] + offsetX, nd.pos[1], nd.pos[2]],
            ]}
            color={nd.role && nd.role !== 'idle' ? roleHex(nd.role) : theme.nodeEdge}
            lineWidth={nd.role && nd.role !== 'idle' ? 2.8 : 1.6}
            transparent
            opacity={nd.role && nd.role !== 'idle' ? 0.95 : 0.55}
          />
        ) : null,
      )}

      {nodes.map((nd) => {
        const active = Boolean(nd.role && nd.role !== 'idle')
        return (
          <Mover key={nd.key} position={[nd.pos[0] + offsetX, nd.pos[1], nd.pos[2]]} speed={14}>
            <mesh>
              <sphereGeometry args={[active ? 0.52 : 0.42, 22, 18]} />
              <meshLambertMaterial color={roleHex(nd.role)} />
            </mesh>
            <TextLabel text={nd.label} position={[0, 0, 0]} color={dark ? '#0b1120' : '#ffffff'} height={0.3} bold={active} />
            <TextLabel text={String(nd.slot)} position={[0, -0.8, 0]} color={theme.nodeEdge} height={0.24} />
          </Mover>
        )
      })}
    </group>
  )
}

/** 相机取景随树的宽/高走：退化链表要退远，矮胖树可以贴近 */
export function tree3DCamera(slots: number, maxDepth: number): { position: Vec3; target: Vec3 } {
  const width = Math.max(9, slots * SLOT_W)
  const height = Math.max(7, (maxDepth + 1) * LEVEL_H)
  const centerY = TOP_Y - (maxDepth * LEVEL_H) / 2
  const z = Math.min(78, Math.max(width * 1.15, height * 1.5) + 9)
  return { position: [0, centerY + z * 0.22, z], target: [0, centerY, 0] }
}
