/**
 * 3D 结点链（scene: chain3d，快照 kind: nodechain）—— 链表 / 栈 / 队列共用。
 *
 * 一个场景两种朝向，由数据自己决定而不是由页面传参：
 *   · 栈（id 含 stack）竖直堆叠，栈顶在上 —— LIFO「只在顶端进出」这件事
 *     用竖直方向表达远比横向直观，学生一眼就懂为什么栈不能从中间抽；
 *   · 链表 / 队列横向排列 —— 队列的队头队尾天然是左右两端。
 *
 * 3D 相对 2D 多给的信息：结点画成有厚度的盒子，字段（data / next）作为盒面上的
 * 独立小格；指针连线是空间中的实体箭头，插入删除时「先接后断」的先后次序
 * 可以用两根不同颜色的箭头同时在场，2D 平面图里这两根线会叠在一起。
 *
 * mesh 预算：每结点 1 盒 + 1~4 标签 + 每边 1 线 1 锥 ≈ 6/结点，n ≤ 14 时 ≤ 90 个。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { Quaternion, Vector3 } from 'three'
import type { ChainNode, NodeChainSnapshot } from '../../viz/types'
import type { Scene3DProps } from '../types'
import { roleHex, sceneTheme } from '../palette'
import { Mover, TextLabel, type Vec3 } from '../widgets'
import { isVerticalChain } from '../layoutRules'

const H_GAP = 2.75
const V_GAP = 1.5
const BOX: Vec3 = [1.85, 1.05, 1.05]

const sub = (a: Vec3, b: Vec3): Vector3 => new Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** 带箭头的有向连线：箭头用圆锥，朝向由四元数算，不假设轴对齐（插入操作会出现斜线） */
function Arrow({ from, to, color, opacity = 0.95, width = 2 }: { from: Vec3; to: Vec3; color: string; opacity?: number; width?: number }) {
  const { quat, head, mid } = useMemo(() => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    dir.normalize()
    return {
      quat: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir),
      head: b.clone().sub(dir.clone().multiplyScalar(Math.min(0.5, len * 0.35))),
      mid: a.clone().add(dir.clone().multiplyScalar(Math.max(0.1, len - Math.min(0.5, len * 0.35)))),
    }
  }, [from, to])
  return (
    <group>
      <Line points={[from, [mid.x, mid.y, mid.z]]} color={color} lineWidth={width} transparent opacity={opacity} />
      <mesh position={[head.x, head.y, head.z]} quaternion={quat}>
        <coneGeometry args={[0.15, 0.42, 14]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
      </mesh>
    </group>
  )
}

function nodePos(i: number, total: number, vertical: boolean): Vec3 {
  if (vertical) {
    // 栈：数组第 0 项是栈顶，放在最高处
    return [0, 3.4 - i * V_GAP, 0]
  }
  return [(i - (total - 1) / 2) * H_GAP, 1.3, 0]
}

export function Chain3D({ demo, step, dark }: Scene3DProps) {
  const snap = step.snapshot as NodeChainSnapshot
  const theme = sceneTheme(dark)
  const vertical = isVerticalChain(demo.id)
  const nodes = snap.nodes ?? []
  const edges = snap.edges ?? []
  const pointers = snap.pointers ?? []

  const posOf = useMemo(() => {
    const m = new Map<string, Vec3>()
    nodes.forEach((n: ChainNode, i: number) => m.set(n.key, nodePos(i, nodes.length, vertical)))
    return m
  }, [nodes, vertical])

  const labelBg = dark ? 'rgba(11,17,32,0.78)' : 'rgba(255,255,255,0.82)'

  return (
    <group>
      {nodes.map((nd, i) => {
        const pos = posOf.get(nd.key) ?? nodePos(i, nodes.length, vertical)
        const active = Boolean(nd.role && nd.role !== 'idle')
        const fields = Object.entries(nd.fields ?? {})
        return (
          <Mover key={nd.key} position={pos} speed={11}>
            <mesh>
              <boxGeometry args={BOX} />
              <meshLambertMaterial color={roleHex(nd.role)} transparent opacity={active ? 1 : 0.92} />
            </mesh>
            <TextLabel text={nd.label} position={[0, 0, BOX[2] / 2 + 0.02]} color={dark ? '#0b1120' : '#ffffff'} height={0.34} bold={active} />
            {/* 字段格：data / next 等，排在盒子上方，让「结点内部结构」可见 */}
            {fields.map(([k, v], fi) => (
              <TextLabel
                key={k}
                text={`${k}=${v}`}
                position={[(fi - (fields.length - 1) / 2) * 1.05, BOX[1] / 2 + 0.3, 0]}
                color={theme.text}
                height={0.24}
                background={labelBg}
              />
            ))}
          </Mover>
        )
      })}

      {edges.map((e, i) => {
        const from = posOf.get(e.from)
        if (!from) return null
        const color = e.role ? roleHex(e.role) : theme.link
        // to === null：悬空的 ∧（NULL）。画一小截断线 + 标记，别让学生以为连线丢了
        if (e.to === null) {
          const dir: Vec3 = vertical ? [0, -1, 0] : [1, 0, 0]
          const end: Vec3 = [from[0] + dir[0] * 1.15, from[1] + dir[1] * 1.05, from[2]]
          return (
            <group key={`null${i}`}>
              <Line points={[from, end]} color={color} lineWidth={1.8} dashed dashSize={0.16} gapSize={0.12} transparent opacity={0.8} />
              <TextLabel text="∧ NULL" position={[end[0] + (vertical ? 0.62 : 0.1), end[1] - (vertical ? 0.05 : 0.34), end[2]]} color={color} height={0.26} bold background={labelBg} />
            </group>
          )
        }
        const to = posOf.get(e.to)
        if (!to) return null
        // 起止都按盒子表面缩进，避免箭头锥体埋进盒子内部
        const d = sub(to, from)
        const len = Math.max(0.001, d.length())
        const u = d.multiplyScalar(1 / len)
        const a: Vec3 = [from[0] + u.x * 0.95, from[1] + u.y * 0.58, from[2] + u.z * 0.58]
        const b: Vec3 = [to[0] - u.x * 0.95, to[1] - u.y * 0.58, to[2] - u.z * 0.58]
        return (
          <group key={`e${i}`}>
            <Arrow from={a} to={b} color={color} width={e.role && e.role !== 'idle' ? 2.6 : 1.8} />
            {e.label ? (
              <TextLabel text={e.label} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.34, (a[2] + b[2]) / 2]} color={color} height={0.24} bold background={labelBg} depthTest={false} renderOrder={5} />
            ) : null}
          </group>
        )
      })}

      {/* 外部指针（head / tail / p / rear）：浮在结点上方，用竖线指回目标 */}
      {pointers.map((p, i) => {
        const target = p.node ? posOf.get(p.node) : undefined
        const anchor: Vec3 = target ?? (vertical ? [0, 3.4 - nodes.length * V_GAP - 0.6, 0] : [(i - (pointers.length - 1) / 2) * H_GAP, -0.6, 0])
        const up: Vec3 = vertical ? [1.9, anchor[1], anchor[2]] : [anchor[0], anchor[1] + 1.55, anchor[2]]
        return (
          <group key={`pt${i}`}>
            <Mover position={up} speed={11}>
              <TextLabel text={p.label} position={[0, 0, 0]} color={theme.link} height={0.34} bold background={labelBg} />
            </Mover>
            <Line points={[up, anchor]} color={theme.link} lineWidth={1.5} transparent opacity={0.7} />
            {!target ? <TextLabel text="NULL" position={[up[0], up[1] - 0.4, up[2]]} color={theme.link} height={0.24} /> : null}
          </group>
        )
      })}

      {/* 栈的底托：竖直朝向时给一块「栈底」板，强化「有底、只能从顶上拿」的直觉 */}
      {vertical && nodes.length > 0 ? (
        <mesh position={[0, 3.4 - (nodes.length - 1) * V_GAP - 0.95, 0]}>
          <boxGeometry args={[2.6, 0.16, 1.8]} />
          <meshLambertMaterial color={theme.grid} />
        </mesh>
      ) : null}
    </group>
  )
}

export function chain3DCamera(n: number, vertical: boolean): { position: Vec3; target: Vec3 } {
  if (vertical) {
    const h = Math.max(5, n * V_GAP + 3)
    return { position: [0, h * 0.42, Math.min(34, h * 1.5 + 6)], target: [0, h * 0.3, 0] }
  }
  const w = Math.max(8, n * H_GAP)
  const z = Math.min(48, w * 0.95 + 6)
  return { position: [0, z * 0.4, z], target: [0, 1.2, 0] }
}
