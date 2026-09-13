/**
 * 3D 场景调色板。
 *
 * 为什么是字面色值而不是 CSS 变量：three.js 的材质颜色走 WebGL uniform，
 * 吃不了 var(--color-viz-*)。色值与 src/styles/global.css 的 --color-viz-* 令牌
 * 一一对齐（那六个令牌在深浅两套主题下取值相同，所以这里不必跟主题切换），
 * **改令牌必须同步改这张表**，否则 2D / 3D 两个馆会出现同一语义两种颜色。
 */
import type { VizRole } from '../viz/types'

export const ROLE_HEX: Record<VizRole, string> = {
  idle: '#94a3b8',
  compare: '#f59e0b',
  swap: '#ef4444',
  sorted: '#10b981',
  pivot: '#3b82f6',
  active: '#8b5cf6',
}

/** 未标 role 的元素按 idle 上色（与 2D 渲染器口径一致） */
export function roleHex(role?: VizRole): string {
  return role ? ROLE_HEX[role] : ROLE_HEX.idle
}

/** 图例：3D 场景右下角的语义色说明，键顺序即展示顺序 */
export const LEGEND: { role: VizRole; label: string }[] = [
  { role: 'idle', label: '未处理' },
  { role: 'compare', label: '比较中' },
  { role: 'swap', label: '交换/危险' },
  { role: 'sorted', label: '已就位' },
  { role: 'pivot', label: '基准/在队' },
  { role: 'active', label: '当前处理' },
]

/** 场景级中性色：随明暗主题二选一，由 Stage3D 统一注入 */
export interface SceneTheme {
  background: string
  grid: string
  text: string
  nodeEdge: string
  link: string
  frameBox: string
}

export const LIGHT_SCENE: SceneTheme = {
  background: '#eef2f7',
  grid: '#c3ccd9',
  text: '#0f172a',
  nodeEdge: '#334155',
  link: '#0ea5e9',
  frameBox: '#94a3b8',
}

export const DARK_SCENE: SceneTheme = {
  background: '#0b1120',
  grid: '#2b344a',
  text: '#e2e8f0',
  nodeEdge: '#cbd5e1',
  link: '#38bdf8',
  frameBox: '#475569',
}

export function sceneTheme(dark: boolean): SceneTheme {
  return dark ? DARK_SCENE : LIGHT_SCENE
}
