/**
 * 3D 舞台的「重」半边：整个站点里**只有这个模块**（及其下游）静态 import three。
 *
 * 为什么单独拆一个文件出来：Viz3DDemoPage 用 React.lazy 动态引入它，于是
 *   · 窄屏用户（自动降级 2D）、WebGL 不可用的用户，一个字节 3D 代码都不会下载；
 *   · 3D 运行时（three + fiber + drei ≈ 885 KB / gzip 235 KB）只在真正要看立体视图时才拉。
 * 若把 Stage3D / sceneRegistry / labelTexture 直接 import 进页面，它们会随页面 chunk 一起
 * 变成静态依赖，窄屏降级就只是「不渲染」而省不下流量（2026-09-13 验收抓到的正是这个）。
 *
 * 相机取景用 initialCamera（按整段演示里规模最大的一步算），不用第 0 步 ——
 * BST 插入这类演示第 0 步只有一个结点，拿它取景会等树长满后装不下。
 */
import { useEffect, useMemo } from 'react'
import type { VizDemo } from '../viz/types'
import { Stage3D } from './Stage3D'
import { initialCamera, sceneFor } from './sceneRegistry'
import { disposeLabelCache } from './labelTexture'
import type { Scene3DKind } from './types'

export interface Stage3DSceneProps {
  scene: Scene3DKind
  demo: VizDemo
  /** 当前步序号（由 2D 馆的 Player 驱动，3D 只负责画） */
  stepIndex: number
  dark: boolean
  /** 变化即强制重建 Canvas，用于「⟳ 重置视角」 */
  viewKey: number
}

export function Stage3DScene({ scene, demo, stepIndex, dark, viewKey }: Stage3DSceneProps) {
  const cam = useMemo(() => initialCamera(scene, demo), [scene, demo])
  const Scene = useMemo(() => sceneFor(scene), [scene])
  const step = demo.steps[stepIndex]

  // 离开 3D 就释放标签贴图：CanvasTexture 由 GPU 侧持有，反复进出会把显存吃满
  useEffect(() => () => disposeLabelCache(), [])

  if (!step) return null
  return (
    <Stage3D
      key={viewKey}
      dark={dark}
      camera={{ position: cam.position, fov: 45 }}
      target={cam.target}
      grid={scene === 'callstack3d' ? null : { size: 46, divisions: 46, y: -0.02 }}
      ariaLabel={`3D 演示 ${demo.title}，第 ${stepIndex + 1} 步，共 ${demo.steps.length} 步；可拖拽旋转、滚轮缩放`}
    >
      <Scene demo={demo} step={step} dark={dark} />
    </Stage3D>
  )
}

export default Stage3DScene
