/**
 * 3D 可视化馆的类型层（任务 2）。
 *
 * 核心决定：**不新造快照模型**。3D 馆复用 2D 馆同一套 VizDemo / VizStep / VizSnapshot
 * 语料（AGENTS.md 要求「复用现有 Step 状态快照模型」），因此步骤回放、单步、重置的
 * 语义与 2D 完全一致；3D 只换「怎么画」，不换「画什么」。
 *
 * 3D 独有的两件事：
 *   1. Scene3DKind —— 一个快照 kind 可以对应多种 3D 画法（memory 快照既能画成
 *      分区沙盘，也能画成调用栈帧堆叠或矩阵立方体），所以场景由 catalog 显式指定；
 *   2. dark —— three.js 吃不了 CSS 变量，明暗主题只能作为 prop 传进材质。
 */
import type { VizDemo, VizStep } from '../viz/types'

export type Scene3DKind =
  | 'bars3d'
  | 'chain3d'
  | 'tree3d'
  | 'graph3d'
  | 'memory3d'
  | 'callstack3d'
  | 'matrixcube3d'

export interface Scene3DProps {
  demo: VizDemo
  step: VizStep
  dark: boolean
}

/** 场景自报的相机初始位姿：不同结构的 demo 需要的取景差别很大 */
export interface CameraHint {
  position: [number, number, number]
  target: [number, number, number]
}


/**
 * 3D HUD 的统计键中文名：先查 2D 的 COUNTER_LABELS（viz/types.ts），查不到再查这张表。
 * 放在 types.ts 而不是 generators.ts —— 后者是 20 KB 的语料生成器，
 * 演示页只为了几个标签把它整个拖进 3D chunk 不划算。
 */
export const COUNTER_LABELS_3D: Record<string, string> = {
  pointerWrites: '指针写入次数',
  leakedBlocks: '泄漏堆块数',
  bytesLost: '泄漏字节数',
  stackDepth: '当前栈深',
  visited: '已访问元素',
}

/** HUD 取值顺序固定：2D 表优先，3D 表兜底，都没有就原样显示键名（与 2D 渲染器口径一致） */
export function counterLabel(key: string, base: Record<string, string>): string {
  return base[key] ?? COUNTER_LABELS_3D[key] ?? key
}

/**
 * 场景中文名。放在 types.ts（three-free）而不是 sceneRegistry.ts：
 * 列表页要在卡片上标出「这是哪种 3D 画法」，而 sceneRegistry 间接 import three，
 * 列表页一旦碰它，路由级 lazy 就失效了（首页/列表页零 3D 体积是硬约束）。
 */
export const SCENE_LABELS: Record<Scene3DKind, string> = {
  bars3d: '3D 柱阵',
  chain3d: '3D 结点链',
  graph3d: '3D 图',
  tree3d: '3D 树',
  memory3d: '3D 内存沙盘',
  callstack3d: '3D 调用栈',
  matrixcube3d: '3D 内存立方体',
}

export function sceneLabel(kind: Scene3DKind): string {
  return SCENE_LABELS[kind] ?? kind
}
