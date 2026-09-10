/**
 * 步骤模型 / 时间轴导航（阶段 7 · Viz 内核）。
 *
 * 类型（VizStep / VizSnapshot）在 types.ts；本文件只管「一条步骤数组上怎么移动光标」。
 * 设计原则（07_可视化演示规范.md 三·2）：后退 = 下标回退，快照是完整状态，绝不做逆运算。
 * 全部是纯函数：同样的 (index, count) 必得同样的结果，便于单测、便于 Player 与对比页共用。
 */
import type { VizStep } from './types'

/** count 为 0（空演示）时任何下标都夹到 0，避免出现 -1 / NaN 传进渲染器 */
export function clampStep(index: number, count: number): number {
  if (count <= 0) return 0
  if (!Number.isFinite(index)) return 0
  if (index < 0) return 0
  if (index > count - 1) return count - 1
  return Math.floor(index)
}

export const goFirst = (): number => 0
export const goLast = (count: number): number => clampStep(count - 1, count)
export const goPrev = (index: number, count: number): number => clampStep(index - 1, count)
export const goNext = (index: number, count: number): number => clampStep(index + 1, count)
/** 进度条 / 跳到任意步：外部传进来的原始值先夹到合法区间 */
export const seek = (index: number, count: number): number => clampStep(index, count)

export const canGoPrev = (index: number): boolean => index > 0
export const canGoNext = (index: number, count: number): boolean => index < count - 1

/** 进度比例 0..1（count<=1 时恒为 1，进度条拉满，避免除零） */
export function ratio(index: number, count: number): number {
  if (count <= 1) return 1
  return clampStep(index, count) / (count - 1)
}

/**
 * 只读时间轴视图：把「步骤数组 + 当前下标」打包成一个便于渲染的对象。
 * Player 与对比页都用它取当前步 / 判断按钮是否禁用，不在组件里散落 clamp 逻辑。
 */
export interface StepTimeline {
  readonly steps: readonly VizStep[]
  readonly index: number
  readonly count: number
  readonly current: VizStep | null
  readonly atStart: boolean
  readonly atEnd: boolean
  readonly progress: number
}

export function makeTimeline(steps: readonly VizStep[], index: number): StepTimeline {
  const count = steps.length
  const i = clampStep(index, count)
  return {
    steps,
    index: i,
    count,
    current: count > 0 ? (steps[i] ?? null) : null,
    atStart: i <= 0,
    atEnd: i >= count - 1,
    progress: ratio(i, count),
  }
}
