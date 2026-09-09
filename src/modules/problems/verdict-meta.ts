/**
 * 判分状态 → 中文标签 / 颜色的唯一映射（阶段 4 各 Renderer 共用）。
 *
 * src/pages/JudgeLabPage.tsx 里有一份同名常量，那是阶段 2 的判分实测台，
 * 阶段 4 判分器进刷题页后会被移除；届时以本文件为准，不要再新增第三份。
 */
import type { ResultState } from '../../judge/types'

export const STATE_LABEL: Record<ResultState, string> = {
  accepted: '✓ 通过',
  'wrong-answer': '✗ 输出不符',
  'compile-error': '✗ 编译错误',
  'runtime-error': '✗ 运行崩溃',
  timeout: '✗ 运行超时',
  truncated: '✗ 输出截断',
  degraded: '⚠ 降级自评',
  'backend-unavailable': '⚠ 后端不可用',
}

export const STATE_COLOR: Record<ResultState, string> = {
  accepted: 'var(--color-viz-sorted)',
  'wrong-answer': 'var(--color-viz-swap)',
  'compile-error': 'var(--color-viz-swap)',
  'runtime-error': 'var(--color-viz-swap)',
  timeout: 'var(--color-viz-swap)',
  truncated: 'var(--color-viz-swap)',
  degraded: 'var(--color-viz-compare)',
  'backend-unavailable': 'var(--color-viz-compare)',
}

/**
 * true = 这个状态不代表「学生答错」，不得计入正确率、不得置 verified。
 * 后端抖动（5xx / 网络 / 超时中止）属「未判定」，AGENTS.md 二·5 有明文。
 */
export function isInconclusive(state: ResultState): boolean {
  return state === 'degraded' || state === 'backend-unavailable' || state === 'truncated'
}