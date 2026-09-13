/**
 * 3D 舞台：Canvas + 灯光 + 地面网格 + 轨道控制器。所有 3D 场景共用这一个壳。
 *
 * 关键参数为什么这么定：
 *   frameloop="demand" —— 见 widgets.tsx 顶部说明，静止时不烧 GPU；
 *   dpr={[1, 1.75]}    —— 4K/视网膜屏上封顶 1.75 倍，再高对线框+色块场景看不出差别，
 *                         却把填充率翻四倍（移动端最先撑不住的就是这个）；
 *   shadows 关闭       —— 本场景是「示意图」不是「渲染图」，阴影只会拖慢帧率、
 *                         还会让深色主题下的色块糊成一团；层次靠灯光方向 + 间距表达。
 *
 * OrbitControls 必须 makeDefault：这样 drei 内部组件（以及未来若加的 Bounds）
 * 才能共享同一个控制器，不会出现两套相机互相打架。
 */
import type { ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { sceneTheme } from './palette'
import type { Vec3 } from './widgets'

export interface Stage3DProps {
  dark: boolean
  children: ReactNode
  camera?: { position: Vec3; fov?: number }
  target?: Vec3
  /** 地面网格边长与分格数；null = 不画地面（例如调用栈场景不需要地板） */
  grid?: { size: number; divisions: number; y?: number } | null
  /** 相机可缩放范围，防止学生滚轮把场景缩没 */
  distance?: [number, number]
  ariaLabel: string
}

/**
 * 性能探针：把当前场景的 mesh 数 / draw call / 三角形数挂到 window.__VIZ3D_STATS__，
 * 供 scripts/acceptance-viz3d-ui.mjs 校验「单个演示不超过 200 个 mesh」的硬预算。
 *
 * 之所以常驻生产代码而不是只在 dev 里挂：成本是每帧一次 scene.traverse（几十个结点，微秒级），
 * 而且 frameloop="demand" 下它只在真正重绘时跑；换来的是这条性能红线可以被自动化验收守住，
 * 不会在某次「顺手加个装饰」之后悄悄爆掉。
 */
function StatsProbe() {
  const { scene, gl } = useThree()
  useFrame(() => {
    let meshes = 0
    scene.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) meshes += 1 })
    const w = window as unknown as { __VIZ3D_STATS__?: { meshes: number; calls: number; triangles: number } }
    w.__VIZ3D_STATS__ = { meshes, calls: gl.info.render.calls, triangles: gl.info.render.triangles }
  })
  return null
}

export function Stage3D({
  dark,
  children,
  camera = { position: [0, 7, 16], fov: 45 },
  target = [0, 0, 0],
  grid = { size: 40, divisions: 40, y: -0.02 },
  distance = [4, 90],
  ariaLabel,
}: Stage3DProps) {
  const theme = sceneTheme(dark)
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ position: camera.position, fov: camera.fov ?? 45, near: 0.1, far: 400 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      // 3D 画布对读屏软件是黑箱，必须给可聚焦的替代说明（任务 4·无障碍）
      role="img"
      aria-label={ariaLabel}
      style={{ background: theme.background, touchAction: 'none' }}
    >
      <color attach="background" args={[theme.background]} />
      <hemisphereLight args={[dark ? '#8fa4c4' : '#ffffff', dark ? '#0b1120' : '#94a3b8', dark ? 0.75 : 0.95]} />
      <directionalLight position={[8, 14, 10]} intensity={dark ? 1.0 : 1.15} />
      <directionalLight position={[-10, 6, -8]} intensity={dark ? 0.35 : 0.3} />
      {grid ? (
        <gridHelper
          args={[grid.size, grid.divisions, theme.grid, theme.grid]}
          position={[0, grid.y ?? -0.02, 0]}
        />
      ) : null}
      {children}
      <StatsProbe />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.14}
        target={target}
        minDistance={distance[0]}
        maxDistance={distance[1]}
        maxPolarAngle={Math.PI * 0.495}
      />
    </Canvas>
  )
}
