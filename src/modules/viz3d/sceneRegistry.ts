/**
 * 3D 场景注册表（kind → 组件 + 相机取景）。
 *
 * 与 2D 馆 registry.ts 同一口径：页面只按 catalog 里的 scene 取组件，不认识任何具体场景。
 * 新增一种 3D 画法 = 写一个 scene 文件 + 在这里登记两行，页面一行都不用改。
 *
 * ⚠️ 本文件经由各 scene 间接 import 了 three / fiber / drei，所以**只允许被 3D 演示页
 * 这条 lazy 路由引用**。列表页与首页要的是 catalog.ts（纯数据、零 3D 体积）——
 * 一旦这里被静态 import，路由级 lazy 就白做了（AGENTS.md 任务 2「3D 库必须 lazy」）。
 *
 * 写成 .ts（无 JSX）与 2D 的 registry.ts 同理：scripts/ 侧的 Node 类型擦除加载器
 * 可以安全 ssrLoadModule 引用它做一致性校验（验收脚本要断言 catalog 的 scene 都登记了）。
 *
 * cameraFor 只读快照的形状信息（元素个数 / 分区跨度 / 树的槽位数），不读颜色与 role ——
 * 取景只跟「有多少东西」有关，跟「哪一步」无关，这样单步切换不会让相机乱跳。
 */
import type { ComponentType } from 'react'
import type {
  BarSnapshot,
  GraphSnapshot,
  MemorySnapshot,
  NodeChainSnapshot,
  TreeSnapshot,
  VizDemo,
  VizStep,
} from '../viz/types'
import type { CameraHint, Scene3DKind, Scene3DProps } from './types'
import { cellCount, isVerticalChain, treeStats } from './layoutRules'
import { Bars3D, bars3DCamera } from './scenes/Bars3D'
import { Chain3D, chain3DCamera } from './scenes/Chain3D'
import { Graph3D, graph3DCamera } from './scenes/Graph3D'
import { Tree3D, tree3DCamera } from './scenes/Tree3D'
import { Memory3D, memory3DCamera } from './scenes/Memory3D'
import { CallStack3D, callStack3DCamera } from './scenes/CallStack3D'
import { MatrixCube3D, matrixCube3DCamera } from './scenes/MatrixCube3D'

export const SCENES: Record<Scene3DKind, ComponentType<Scene3DProps>> = {
  bars3d: Bars3D,
  chain3d: Chain3D,
  graph3d: Graph3D,
  tree3d: Tree3D,
  memory3d: Memory3D,
  callstack3d: CallStack3D,
  matrixcube3d: MatrixCube3D,
}


export function sceneFor(kind: Scene3DKind): ComponentType<Scene3DProps> {
  return SCENES[kind] ?? Bars3D
}


/** 初始取景。快照 kind 与 scene 不是一对一（memory 快照对应三种 3D 画法），故按 scene 分派 */
export function cameraFor(kind: Scene3DKind, demo: VizDemo, step: VizStep | undefined): CameraHint {
  const snap = step?.snapshot
  const memoryRegions = snap && snap.kind === 'memory' ? (snap as MemorySnapshot).regions ?? [] : []
  switch (kind) {
    case 'bars3d': {
      const n = snap && snap.kind === 'bar' ? (snap as BarSnapshot).values.length : 10
      return bars3DCamera(n)
    }
    case 'chain3d': {
      const n = snap && snap.kind === 'nodechain' ? (snap as NodeChainSnapshot).nodes.length : 6
      return chain3DCamera(n, isVerticalChain(demo.id))
    }
    case 'graph3d': {
      const n = snap && snap.kind === 'graph' ? (snap as GraphSnapshot).nodes.length : 6
      return graph3DCamera(n)
    }
    case 'tree3d': {
      const root = snap && snap.kind === 'tree' ? (snap as TreeSnapshot).root : null
      const stats = treeStats(root)
      return tree3DCamera(Math.max(stats.slots, 1), stats.depth)
    }
    case 'callstack3d':
      return callStack3DCamera(memoryRegions)
    case 'matrixcube3d':
      return matrixCube3DCamera(memoryRegions)
    case 'memory3d':
    default:
      return memory3DCamera(memoryRegions)
  }
}

/**
 * 规模度量：只跟「这一步有多少东西」有关，与 role / 颜色无关。
 * 调用栈场景把帧数放在十位、格子数放在个位，保证「帧更多的步」永远排在前面 ——
 * 取景看的是塔高，塔高只由帧数决定。
 */
function sizeMetric(kind: Scene3DKind, step: VizStep): number {
  const s = step.snapshot
  switch (kind) {
    case 'bars3d':
      return s.kind === 'bar' ? s.values.length : 0
    case 'chain3d':
      return s.kind === 'nodechain' ? s.nodes.length : 0
    case 'graph3d':
      return s.kind === 'graph' ? s.nodes.length : 0
    case 'tree3d':
      return s.kind === 'tree' ? treeStats(s.root).slots : 0
    case 'callstack3d':
      return s.kind === 'memory' ? s.regions.length * 100 + cellCount(s.regions) : 0
    case 'matrixcube3d':
    case 'memory3d':
    default:
      return s.kind === 'memory' ? cellCount(s.regions) : 0
  }
}

/** 整段演示里规模最大的一步：相机取景用它，不用第 0 步 */
export function fullestStep(kind: Scene3DKind, demo: VizDemo): VizStep | undefined {
  let best: VizStep | undefined
  let bestScore = -1
  for (const st of demo.steps) {
    const score = sizeMetric(kind, st)
    if (score > bestScore) {
      bestScore = score
      best = st
    }
  }
  return best
}

/** 进页面时的初始取景（用户随后可以自由旋转缩放，OrbitControls 不受这里约束） */
export function initialCamera(kind: Scene3DKind, demo: VizDemo): CameraHint {
  return cameraFor(kind, demo, fullestStep(kind, demo))
}
