/**
 * 3D 内存类场景的共享零件（memory3d / callstack3d / matrixcube3d 三个场景共用）。
 *
 * 为什么单独抽一层：这三个场景画的都是「内存格 + 地址 + 指针连线」，差别只在**怎么排**。
 * 把「格子长什么样」收口在这里，三个场景就不会各画一套，也不会出现同一个 role
 * 在两个场景里两种颜色（07 规范二·E 的语义色一致性）。
 *
 * 两个实现选择：
 *   1. 指针连线用自采样的二次贝塞尔（arcPoints）交给 drei <Line>，不用 QuadraticBezierLine：
 *      本场景的连线是静态的（位置变化由 Mover 负责），少一层 ref/动画管理，弧高也完全可控；
 *   2. 值标签一律带半透明底板 chip，而不是直接把字贴在盒面上：
 *      盒子颜色本身承载 role 语义（红=危险、绿=已就位），字压在色块上对比度不可控，
 *      加 chip 后深浅两套主题都稳定可读（任务 4·无障碍的对比度要求）。
 */
import { Edges, Line } from '@react-three/drei'
import { Quaternion, Vector3 } from 'three'
import type { MemoryCell } from '../viz/types'
import { roleHex, type SceneTheme } from './palette'
import { TextLabel, type Vec3 } from './widgets'

/** 默认内存格尺寸（世界单位）。三个场景按需覆盖，但比例保持一致 */
export const CELL = { w: 1.75, h: 0.95, d: 1.2 } as const

/** 地址串 → 数值。非 0x 形式（占位符 '——'）返回 NaN，调用方必须自己处理 NaN */
export function parseAddr(address: string): number {
  const hex = /^0x([0-9a-fA-F]+)$/.exec(address.trim())?.[1]
  return hex ? Number.parseInt(hex, 16) : Number.NaN
}

/** 目标串归一化：a[0] / a0 / A0 视为同一个键（空格与方括号不参与匹配） */
export function normalizeKey(text: string): string {
  return text.replace(/[\s[\]()]/g, '').toLowerCase()
}

/**
 * value 写成「→ 目标」表示一条指针，返回目标串。
 * NULL / 0 明确返回 null：语义是「不指向任何东西」，画一条线反而是错的
 * （野指针演示的最后一步正是要让学生看见连线消失）。
 */
export function pointerTargetOf(value: string): string | null {
  const m = /→\s*(.+)$/.exec(value)
  if (!m) return null
  const t = (m[1] ?? '').trim()
  if (!t || /^null$/i.test(t) || t === '0') return null
  return t
}

/** note 里的「函数名 · 说明」前缀：调用栈场景把前半当帧名，后半当变量说明 */
export function stripFramePrefix(note: string | undefined): string {
  if (!note) return ''
  const i = note.indexOf('·')
  return i >= 0 ? note.slice(i + 1).trim() : note.trim()
}

/** 3D 标签最长字数：再长就该由步骤解说承担，不该由场景承担 */
export function clampText(text: string, max = 18): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** 二次贝塞尔采样。lift = 弧顶相对两端较高者的抬升量 */
export function arcPoints(from: Vec3, to: Vec3, lift: number, segments = 14): Vec3[] {
  const mid: Vec3 = [
    (from[0] + to[0]) / 2,
    Math.max(from[1], to[1]) + lift,
    (from[2] + to[2]) / 2,
  ]
  const pts: Vec3[] = []
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const c = t * t
    pts.push([
      a * from[0] + b * mid[0] + c * to[0],
      a * from[1] + b * mid[1] + c * to[1],
      a * from[2] + b * mid[2] + c * to[2],
    ])
  }
  return pts
}

export interface CellBoxProps {
  cell: MemoryCell
  theme: SceneTheme
  dark: boolean
  size?: { w: number; h: number; d: number }
  /** 主标签（盒子正上方）。缺省 = note 剥掉帧前缀，再退到 key */
  name?: string
  showAddress?: boolean
  showNote?: boolean
  /** 当前处理单元格：外加一圈高亮线框，旋转视角时不会被别的盒子挡住 */
  emphasis?: boolean
}

/**
 * 一个内存格：盒子（颜色 = role）+ 描边 + 值 chip + 主标签 + 地址 + note。
 * 5 个对象，是三个内存场景 mesh 预算的基本单位（18 格 × 5 = 90，仍低于 200 红线）。
 */
export function CellBox({
  cell,
  theme,
  dark,
  size,
  name,
  showAddress = true,
  showNote = true,
  emphasis = false,
}: CellBoxProps) {
  const w = size?.w ?? CELL.w
  const h = size?.h ?? CELL.h
  const d = size?.d ?? CELL.d
  const fromNote = stripFramePrefix(cell.note)
  const label = clampText(name ?? (fromNote || cell.key), 20)
  const chip = dark ? 'rgba(11,17,32,0.78)' : 'rgba(255,255,255,0.82)'
  return (
    <group>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshLambertMaterial color={roleHex(cell.role)} />
        <Edges color={theme.nodeEdge} />
      </mesh>
      {emphasis ? (
        <mesh>
          <boxGeometry args={[w + 0.16, h + 0.16, d + 0.16]} />
          <meshBasicMaterial color={theme.link} wireframe transparent opacity={0.55} toneMapped={false} />
        </mesh>
      ) : null}
      <TextLabel
        text={clampText(cell.value, 16)}
        position={[0, 0, d / 2 + 0.05]}
        color={theme.text}
        height={h * 0.4}
        bold
        background={chip}
      />
      <TextLabel text={label} position={[0, h / 2 + 0.28, 0]} color={theme.text} height={0.27} bold={emphasis} />
      {showAddress ? (
        <TextLabel text={cell.address} position={[0, -h / 2 - 0.26, 0]} color={theme.frameBox} height={0.22} />
      ) : null}
      {showNote && fromNote && fromNote !== label ? (
        <TextLabel
          text={clampText(fromNote, 18)}
          position={[0, -h / 2 - 0.58, 0]}
          color={theme.text}
          height={0.22}
          background={chip}
        />
      ) : null}
    </group>
  )
}

/**
 * 一条指针连线：弧线 + 箭头 + 可选标注。
 * 箭头朝向用「最后一段采样的切线」而不是两端连线方向 —— 贝塞尔末端是斜的，
 * 用弦向会让箭头明显歪出弧线。
 */
export function PointerArc({
  from,
  to,
  color,
  label,
  lift = 1.5,
  opacity = 0.92,
  lineWidth = 2.2,
}: {
  from: Vec3
  to: Vec3
  color: string
  label?: string
  lift?: number
  opacity?: number
  lineWidth?: number
}) {
  const span = Math.hypot(to[0] - from[0], to[2] - from[2])
  const pts = arcPoints(from, to, lift + span * 0.16)
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  if (!last || !prev) return null
  const dir = new Vector3(last[0] - prev[0], last[1] - prev[1], last[2] - prev[2]).normalize()
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)
  return (
    <group>
      <Line points={pts} color={color} lineWidth={lineWidth} transparent opacity={opacity} />
      <mesh position={last} quaternion={quat}>
        <coneGeometry args={[0.13, 0.38, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {label ? (
        <TextLabel
          text={label}
          position={[
            (from[0] + to[0]) / 2,
            Math.max(from[1], to[1]) + lift + span * 0.16 + 0.3,
            (from[2] + to[2]) / 2,
          ]}
          color={color}
          height={0.26}
          bold
          depthTest={false}
          renderOrder={5}
        />
      ) : null}
    </group>
  )
}

/** 分区底板 + 标题：内存沙盘与调用栈帧共用的「一块区域」外观 */
export function ZonePlate({
  width,
  depth,
  theme,
  title,
  titleY,
  accent,
  position = [0, 0, 0],
}: {
  width: number
  depth: number
  theme: SceneTheme
  title: string
  titleY: number
  accent?: string
  position?: Vec3
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[width, 0.12, depth]} />
        <meshLambertMaterial color={accent ?? theme.grid} transparent opacity={accent ? 0.55 : 0.42} />
      </mesh>
      <TextLabel
        text={clampText(title, 26)}
        position={[0, titleY, 0]}
        color={accent ?? theme.text}
        height={0.38}
        bold
        background={accent ? undefined : null}
      />
    </group>
  )
}
