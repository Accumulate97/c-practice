/**
 * 移动端代码编辑器适配（任务 4-2）。真机视角的三个坑，桌面浏览器一个都碰不到：
 *
 * 1. iOS 聚焦缩放：Safari 在聚焦「字号 < 16px」的可编辑元素时会把整页放大，
 *    且失焦后不自动缩回。本站编辑器默认 13px，手机上点一下代码区整页就糊在 150% 里。
 *    所以触屏设备（pointer: coarse）一律抬到 16px。
 * 2. 软键盘遮挡：iOS 上键盘弹出时 layout viewport 不变、只有 visualViewport 缩小，
 *    而 CodeMirror 自带的 scrollIntoView 只看 layout viewport —— 光标会被键盘盖住，
 *    学生看不到自己正在打的那一行。这里监听 visualViewport，光标落到可视区外时滚页面
 *    （不是滚编辑器内部：编辑器内部滚到头也顶不开键盘）。
 * 3. 没有物理键盘：Mod-Enter 一类快捷键在手机上等于不存在，运行只能靠按钮；
 *    底部留白保证「最后一行」也能被顶到键盘上方，不必先插空行才看得见。
 *
 * 为什么用 CSS 变量而不是再造一份 EditorView.theme：CodeMirror 的样式模块是运行时注入
 * head 的，同特异度下它排在我们后面必然覆盖；而写在宿主元素 style 上的自定义属性
 * 永远由 DOM 说了算，且旋转屏幕 / 桌面-触屏切换时不必销毁重建编辑器（重建会丢掉 undo 栈）。
 */
import { useEffect, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'

export const COARSE_QUERY = '(pointer: coarse)'

/** 触屏设备？Node / 老浏览器一律当否（构建期与验收脚本都会走到这里，不能抛） */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia(COARSE_QUERY).matches } catch { return false }
}

/** 省流量模式（Chrome/Android 的 Data Saver）。「非必需的大下载」之前必须问一句 */
export function saveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return c?.saveData === true
}

/**
 * 把移动端适配挂到一个已经建好的 CodeMirror 视图上。
 * viewRef 只在「把光标滚回可视区」时用；hostRef 是承载编辑器的 div（CSS 变量写在它上面）。
 */
export function useMobileEditor(
  viewRef: RefObject<EditorView | null>,
  hostRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mq = window.matchMedia ? window.matchMedia(COARSE_QUERY) : null
    const apply = (): void => {
      const coarse = !!mq?.matches
      host.style.setProperty('--cp-code-fs', coarse ? '16px' : '13px')
      host.style.setProperty('--cp-code-lh', coarse ? '26px' : '20px')
      host.style.setProperty('--cp-gutter-fs', coarse ? '13px' : '12px')
      host.style.setProperty('--cp-code-pad-b', coarse ? '6rem' : '0px')
    }
    apply()
    mq?.addEventListener?.('change', apply)

    let raf = 0
    const revealCursor = (): void => {
      const view = viewRef.current
      const vv = window.visualViewport
      if (!view || !vv || view.hasFocus !== true) return
      let coords: { top: number; bottom: number } | null = null
      try { coords = view.coordsAtPos(view.state.selection.main.head) } catch { coords = null }
      if (!coords) return
      const top = vv.offsetTop
      const bottom = vv.offsetTop + vv.height
      if (coords.bottom > bottom - 12) {
        window.scrollBy({ top: coords.bottom - bottom + 24, behavior: 'smooth' })
      } else if (coords.top < top + 8) {
        window.scrollBy({ top: coords.top - top - 24, behavior: 'smooth' })
      }
    }
    const schedule = (): void => {
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(revealCursor)
    }
    const vv0 = window.visualViewport
    vv0?.addEventListener?.('resize', schedule)
    vv0?.addEventListener?.('scroll', schedule)

    return () => {
      mq?.removeEventListener?.('change', apply)
      if (raf !== 0) cancelAnimationFrame(raf)
      const v = window.visualViewport
      v?.removeEventListener?.('resize', schedule)
      v?.removeEventListener?.('scroll', schedule)
    }
  }, [viewRef, hostRef])
}
