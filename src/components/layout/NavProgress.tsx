/**
 * 路由级加载进度条（任务 4-3）。
 *
 * 为什么需要：router.tsx 里每条路由都是 lazy() + HydrateFallback，而 HydrateFallback
 * 只在**首次加载**时渲染。客户端点导航切页时 React Router 会阻塞在动态 import 上，
 * 页面纹丝不动 —— 进 3D 馆那一下要下 885 KB 的 three.js，慢网下就是「点了没反应」。
 *
 * 口径与 LoadingBar 一致：不编百分比，只如实表达「正在加载」。
 * 延迟 120ms 再显示：命中缓存的切换是瞬间的，闪一下进度条反而像页面在抖。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigation } from 'react-router-dom'

const SHOW_AFTER_MS = 120

export function NavProgress() {
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const [shown, setShown] = useState(false)
  const timer = useRef(0)

  useEffect(() => {
    if (!busy) {
      setShown(false)
      return
    }
    timer.current = window.setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => window.clearTimeout(timer.current)
  }, [busy])

  return (
    <>
      <div
        className="nav-progress"
        data-role="nav-progress"
        data-busy={shown ? '1' : '0'}
        aria-hidden="true"
      >
        <div className="nav-progress-bar" />
      </div>
      {/* 视觉进度条是 aria-hidden 的，加载状态必须另有一条可被感知的通道 */}
      <p role="status" className="sr-only">
        {busy ? '正在载入下一个页面…' : ''}
      </p>
    </>
  )
}
