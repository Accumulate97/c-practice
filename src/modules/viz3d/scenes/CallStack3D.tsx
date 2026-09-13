/**
 * 3D 函数调用栈（scene: callstack3d，快照 kind: memory）。
 *
 * 这是「递归」最容易被讲糊的地方：书上写「每层调用都有自己的 n」，
 * 学生脑子里却只有一个 n 在变。3D 栈把每层栈帧画成一块真实的板，
 * 压入时板从上方落下来、弹出时板消失，`fact(5)…fact(1)` 五个 n 同时在场，
 * 「同名不同物」不再需要解释。SP 标记随栈顶上下移动，回退过程一眼可辨。
 *
 * 三种排布（splitFrames 判定），因为语料里 regions 的语义并不统一：
 *   tower-of-regions —— regions ≥ 3 且每个 region 就是一个栈帧（mem3d-recursion：
 *                       main / fact(5) / … / fact(1)），竖直堆叠成一座塔；
 *   grouped          —— 只有 1 个 region，帧信息藏在 note 前缀「func · 说明」里
 *                       （memory-call-stack），按前缀分帧后同样堆成塔；
 *   side-by-side     —— 2 个 region 且它们是**两种情形的对比**而不是两层栈帧
 *                       （memory-swap-call 的值传递 vs 地址传递），并排各画一帧。
 *                       把对比硬堆成塔会得到「swap 的两个场景互为调用者」的错误暗示，
 *                       所以宁可并排 —— 布局可以朴素，语义不能错。
 *
 * 帧序一律按「帧内最大地址降序」：栈向低地址生长，高地址 = 栈底。
 * 这样 tower-of-regions 与 grouped 两条路径共用同一条排序规则，不必各写一套。
 *
 * mesh 预算：每格 4 个对象（盒 + 描边 + 值 chip + 变量名），每帧 5 个（底板 + 背板 +
 * 帧名 + 基址 + 备注），加坐标轴与 SP 标记 7 个。最大语料 6 帧 × 3 格 = 18 格
 * → 72 + 30 + 7 ≈ 109，低于 200 红线。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { MemoryCell, MemoryRegion, MemorySnapshot } from '../../viz/types'
import type { CameraHint, Scene3DProps } from '../types'
import { sceneTheme } from '../palette'
import { Mover, TextLabel, type Vec3 } from '../widgets'
import { CellBox, clampText, parseAddr } from '../parts'

const CW = 1.5
const CH = 0.8
const CD = 1.05
const GX = 0.24
/** 帧间距：留出变量名标签与下一帧底板之间的高度 */
const FRAME_H = 2.4
const SIDE_GAP = 3.2

export type StackMode = 'tower-of-regions' | 'grouped' | 'side-by-side'

export interface Frame {
  key: string
  title: string
  note?: string
  cells: MemoryCell[]
  active: boolean
  /** 帧内最大地址；NaN 归 -1（占位帧排到最上） */
  addr: number
  width: number
}

export interface StackLayout {
  mode: StackMode
  frames: Frame[]
  maxWidth: number
  totalWidth: number
  height: number
}

function frameAddr(cells: MemoryCell[]): number {
  let best = Number.NaN
  for (const c of cells) {
    const a = parseAddr(c.address)
    if (!Number.isNaN(a) && (Number.isNaN(best) || a > best)) best = a
  }
  return Number.isNaN(best) ? -1 : best
}

function frameWidth(n: number): number {
  return Math.max(2.6, n * (CW + GX) + 1.0)
}

function mkFrame(key: string, title: string, cells: MemoryCell[], note?: string): Frame {
  const sorted = [...cells].sort((a, b) => {
    const da = parseAddr(a.address)
    const db = parseAddr(b.address)
    if (Number.isNaN(da) || Number.isNaN(db)) return 0
    return da - db
  })
  const active = /栈顶/.test(note ?? '') || sorted.some((c) => c.role === 'active')
  return { key, title: title || key, note, cells: sorted, active, addr: frameAddr(sorted), width: frameWidth(sorted.length) }
}

/** 判定排布方式并切帧（纯函数：场景与相机取景共用） */
export function splitFrames(regions: MemoryRegion[]): StackLayout {
  let mode: StackMode
  let frames: Frame[]

  if (regions.length >= 3) {
    mode = 'tower-of-regions'
    frames = regions.map((r) => mkFrame(r.key, r.title, r.cells, r.note))
  } else if (regions.length === 1 && regions[0]) {
    const region = regions[0]
    const groups = new Map<string, MemoryCell[]>()
    for (const c of region.cells) {
      const note = c.note ?? ''
      const i = note.indexOf('·')
      const func = i > 0 ? note.slice(0, i).trim() : ''
      const key = func || region.key
      const bucket = groups.get(key)
      if (bucket) bucket.push(c)
      else groups.set(key, [c])
    }
    mode = groups.size > 1 ? 'grouped' : 'side-by-side'
    frames = [...groups.entries()].map(([func, cells]) =>
      mkFrame(func, func || region.title, cells, region.note),
    )
  } else {
    mode = 'side-by-side'
    frames = regions.map((r) => mkFrame(r.key, r.title, r.cells, r.note))
  }

  if (mode !== 'side-by-side') frames.sort((a, b) => b.addr - a.addr)

  const maxWidth = frames.reduce((m, f) => Math.max(m, f.width), 0)
  const totalWidth =
    mode === 'side-by-side'
      ? frames.reduce((s, f) => s + f.width, 0) + SIDE_GAP * Math.max(0, frames.length - 1)
      : maxWidth
  const height = mode === 'side-by-side' ? FRAME_H : Math.max(FRAME_H, frames.length * FRAME_H)
  return { mode, frames, maxWidth, totalWidth, height }
}

/** 帧在场景中的位置：塔式沿 Y 堆叠，并排沿 X 铺开 */
function frameOrigin(layout: StackLayout, index: number): Vec3 {
  if (layout.mode === 'side-by-side') {
    const self = layout.frames[index]
    if (!self) return [0, 0, 0]
    let x = -layout.totalWidth / 2
    for (let i = 0; i < index; i += 1) x += (layout.frames[i]?.width ?? 0) + SIDE_GAP
    return [x + self.width / 2, 0, 0]
  }
  return [0, index * FRAME_H, 0]
}

export function CallStack3D({ step, dark }: Scene3DProps) {
  const snap = step.snapshot as MemorySnapshot
  const regions = snap.regions ?? []
  const theme = sceneTheme(dark)
  const layout = useMemo(() => splitFrames(regions), [regions])
  const tower = layout.mode !== 'side-by-side'
  const topY = tower ? Math.max(0, layout.frames.length - 1) * FRAME_H : 0
  const axisX = -(layout.maxWidth / 2) - 2.0

  return (
    <group>
      {layout.frames.map((f, i) => {
        const origin = frameOrigin(layout, i)
        const depth = CD + 1.6
        return (
          <Mover key={f.key} position={origin}>
            {/* 帧底板：active 帧用主题链接色，一眼认出「现在在执行哪一层」 */}
            <mesh position={[0, 0.06, 0]}>
              <boxGeometry args={[f.width, 0.12, depth]} />
              <meshLambertMaterial color={f.active ? theme.link : theme.grid} transparent opacity={f.active ? 0.5 : 0.34} />
            </mesh>
            {/* 背板：把「这一组格子属于同一帧」围出来，旋转视角时不会跟邻帧串味 */}
            <mesh position={[0, FRAME_H * 0.34, -depth / 2 + 0.06]}>
              <boxGeometry args={[f.width, FRAME_H * 0.6, 0.08]} />
              <meshLambertMaterial color={f.active ? theme.link : theme.frameBox} transparent opacity={f.active ? 0.28 : 0.14} />
            </mesh>
            <TextLabel
              text={clampText(f.title, 22)}
              position={[0, FRAME_H * 0.66, -depth / 2 + 0.2]}
              color={f.active ? theme.link : theme.text}
              height={0.4}
              bold
            />
            <TextLabel
              text={Number.isNaN(parseAddr(f.cells[0]?.address ?? '')) ? '地址：—' : `基址 ${f.cells[0]?.address ?? ''}`}
              position={[f.width / 2 + 1.0, 0.5, 0]}
              color={theme.frameBox}
              height={0.26}
            />
            {f.note ? (
              <TextLabel
                text={clampText(f.note, 22)}
                position={[-f.width / 2 - 1.2, 0.5, 0]}
                color={f.active ? theme.link : theme.text}
                height={0.26}
              />
            ) : null}
            {f.cells.map((c, k) => (
              <group key={`${f.key}:${c.key}`} position={[(k - (f.cells.length - 1) / 2) * (CW + GX), CH / 2 + 0.16, 0]}>
                <CellBox
                  cell={c}
                  theme={theme}
                  dark={dark}
                  size={{ w: CW, h: CH, d: CD }}
                  showAddress={false}
                  showNote={false}
                  emphasis={c.role === 'active' || c.role === 'compare'}
                />
              </group>
            ))}
          </Mover>
        )
      })}

      {tower ? (
        <group>
          {/* 栈轴：方向感由它给 —— 下=高地址=栈底，上=低地址=栈顶 */}
          <Line
            points={[[axisX, -0.4, 0], [axisX, topY + FRAME_H * 0.8, 0]]}
            color={theme.frameBox}
            lineWidth={1.6}
            transparent
            opacity={0.7}
          />
          <mesh position={[axisX, topY + FRAME_H * 0.85, 0]}>
            <coneGeometry args={[0.14, 0.42, 12]} />
            <meshBasicMaterial color={theme.frameBox} toneMapped={false} />
          </mesh>
          <TextLabel text="低地址 · 栈顶方向" position={[axisX, topY + FRAME_H * 0.85 + 0.55, 0]} color={theme.frameBox} height={0.28} />
          <TextLabel text="高地址 · 栈底" position={[axisX, -0.85, 0]} color={theme.frameBox} height={0.28} />
          {/* SP 标记：压栈上移、弹栈下移，Mover 让它平滑滑动而不是瞬跳 */}
          <Mover position={[axisX + 1.1, topY + 0.55, 0]} speed={6}>
            <TextLabel text="SP →" position={[0, 0, 0]} color={theme.link} height={0.36} bold />
          </Mover>
        </group>
      ) : null}
    </group>
  )
}

/** 塔式看高度取景，并排看宽度取景；两种模式的相机姿态差别很大，不能共用一套 */
export function callStack3DCamera(regions: MemoryRegion[]): CameraHint {
  const layout = splitFrames(regions)
  if (layout.mode === 'side-by-side') {
    const z = Math.min(56, Math.max(12, layout.totalWidth * 0.95 + 8))
    return { position: [0, z * 0.34, z], target: [0, 1.0, 0] }
  }
  const h = layout.height
  const z = Math.min(64, Math.max(13, h * 1.15 + layout.maxWidth * 0.6 + 7))
  return { position: [layout.maxWidth * 0.22, h * 0.55 + 2.2, z], target: [0, h * 0.42, 0] }
}
