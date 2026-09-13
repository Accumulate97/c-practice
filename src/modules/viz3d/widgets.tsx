/**
 * 3D 共享部件：平滑位移 Mover + 画布文字标签 TextLabel。
 *
 * 两个决定值得记一笔：
 *
 * 1. frameloop="demand" + Mover 主动 invalidate。
 *    R3F 默认每帧重画，可 3D 馆绝大多数时间是「停在某一步不动」的 ——
 *    让 GPU 空转 60fps 只为画一张静止的图，笔记本上就是白烧电。
 *    demand 模式下只有 React 重渲染 / OrbitControls 交互 / Mover 未收敛时才画一帧，
 *    收敛后 Mover 停止 invalidate，画面彻底静止。动画手感保留，功耗降到零。
 *
 * 2. 文字用 CanvasTexture 贴到 sprite，不用 drei <Text>。
 *    troika 默认字体要走 CDN，GitHub Pages + 弱网会让整个场景卡在字体加载；
 *    sprite 天然朝向相机，学生无论怎么旋转都读得到标签，不需要 Billboard。
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group } from 'three'
import { labelTexture } from './labelTexture'

export type Vec3 = [number, number, number]

/** 收敛阈值：小于这个距离直接吸附到目标，避免无限逼近导致的永久重绘 */
const EPS = 0.0015

/**
 * 把 children 平滑移动到 position。挂载时直接落在目标位（不从原点飞入），
 * 之后每次 position 变化都指数逼近 —— 与 2D 渲染器的 CSS transition 同一手感。
 */
export function Mover({
  position,
  children,
  speed = 9,
}: {
  position: Vec3
  children: ReactNode
  speed?: number
}) {
  const ref = useRef<Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  const settled = useRef(true)

  useLayoutEffect(() => {
    const g = ref.current
    if (!g) return
    const dx = position[0] - g.position.x
    const dy = position[1] - g.position.y
    const dz = position[2] - g.position.z
    if (dx * dx + dy * dy + dz * dz > EPS * EPS) {
      settled.current = false
      invalidate()
    }
  }, [position, invalidate])

  useFrame((_, delta) => {
    const g = ref.current
    if (!g || settled.current) return
    // delta 夹到 50ms：切标签页回来时 delta 可能是几秒，不夹会让 k 直接等于 1（瞬移）
    const k = 1 - Math.exp(-speed * Math.min(delta, 0.05))
    g.position.x += (position[0] - g.position.x) * k
    g.position.y += (position[1] - g.position.y) * k
    g.position.z += (position[2] - g.position.z) * k
    const dx = position[0] - g.position.x
    const dy = position[1] - g.position.y
    const dz = position[2] - g.position.z
    if (dx * dx + dy * dy + dz * dz <= EPS * EPS) {
      g.position.set(position[0], position[1], position[2])
      settled.current = true
    } else {
      invalidate()
    }
  })

  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  )
}

export interface TextLabelProps {
  text: string
  position: Vec3
  color: string
  /** 标签高度（世界单位）；宽度按贴图纵横比自动算，绝不拉扁文字 */
  height?: number
  background?: string | null
  size?: number
  bold?: boolean
  /** 是否遮挡深度：连线上的小标注关掉深度测试才不会被柱子挡住 */
  depthTest?: boolean
  renderOrder?: number
}

export function TextLabel({
  text,
  position,
  color,
  height = 0.34,
  background = null,
  size = 44,
  bold = false,
  depthTest = true,
  renderOrder = 0,
}: TextLabelProps) {
  const tex = useMemo(() => labelTexture(text, { color, size, bold, background }), [text, color, size, bold, background])
  const aspect = tex.image ? (tex.image as { width: number; height: number }).width / (tex.image as { width: number; height: number }).height : 2
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={renderOrder}>
      <spriteMaterial map={tex} transparent depthTest={depthTest} depthWrite={false} toneMapped={false} />
    </sprite>
  )
}

/** 语义色小圆点 + 文字，用于 3D 场景内的图例牌（挂在场景角落） */
export function LegendChip({ position, color, label }: { position: Vec3; color: string; label: string }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <TextLabel text={label} position={[0.22 + label.length * 0.09, 0, 0]} color={color} height={0.26} bold />
    </group>
  )
}
