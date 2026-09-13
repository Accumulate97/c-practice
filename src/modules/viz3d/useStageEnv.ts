/**
 * 3D 舞台的环境探针：主题 / WebGL 可用性 / 窄屏。
 *
 * 三件事都不属于任何具体场景，但每个 3D 页面都要问一遍，所以收口在这里：
 *
 * 1. 主题只**读 DOM**（document.documentElement.dataset.theme），不订阅 zustand store。
 *    app/theme.ts 的 applyTheme 已经把结果写进 DOM，且 auto 模式跟随系统时也走同一条路；
 *    3D 侧订阅 DOM 属性变化就能同时覆盖「用户点切换」与「系统换深浅色」两种来源，
 *    不必把 theme store 的 auto 判定逻辑再抄一遍（抄了就迟早漂移）。
 *
 * 2. WebGL 探测放在用户点击之后（演示页 mount 时）而不是列表页，避免进列表页就创建 GL 上下文。
 *    探测失败不给空白画布，直接降级到 2D 渲染器并说明原因 —— 降级必须诚实（AGENTS.md 二·5 的同一精神）。
 *
 * 3. 窄屏降级：手机竖屏上 OrbitControls 的拖拽会和页面滚动抢手势，3D 反而更难用，
 *    所以默认切到 2D 视图，同时给一个「仍要看 3D」的开关把选择权还给学生。
 */
import { useEffect, useState } from 'react'

export function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const el = document.documentElement
    const sync = (): void => setDark(el.dataset.theme === 'dark')
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

/** WebGL 是否可用。探测过程会真实创建上下文，失败一律当不可用（不抛错） */
export function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return false
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return true
  } catch {
    return false
  }
}

/** 媒体查询订阅：初始值同步取，之后跟随变化（旋转屏幕 / 拖动窗口都会触发） */
export function useMedia(query: string, fallback = false): boolean {
  const [match, setMatch] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return fallback
    return window.matchMedia(query).matches
  })
  useEffect(() => {
    if (!window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = (): void => setMatch(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return match
}

/** 窄屏阈值：与 global.css 的 lg 断点（1024px）之间留一段余量，平板横屏仍走 3D */
export const NARROW_QUERY = '(max-width: 900px)'

export function useNarrow(): boolean {
  return useMedia(NARROW_QUERY)
}
