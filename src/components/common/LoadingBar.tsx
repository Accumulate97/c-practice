/**
 * 诚实的加载进度（任务 4-3）。
 *
 * 用在两处：① 路由级 lazy 的切换期（AppShell 里的 NavProgress，覆盖 three.js 那 885 KB）；
 * ② 3D 舞台 Suspense 的兜底。
 *
 * 不编百分比：浏览器不暴露动态 import 的下载进度，画一个假的「60%」卡在那里，
 * 比什么都不显示更让人以为站点挂了。这里只表达两件事——「在加载」与「已经等了多久」，
 * 后者是真的（本地计时），超过阈值就补一句可操作的建议，而不是继续假装在算。
 */
import { useEffect, useState } from 'react'

interface Props {
  /** 一句话说清在等什么 */
  label: string
  /** 慢下来之后补的那句建议；不填则不补 */
  slowHint?: string
  /** 超过这个毫秒数算「慢」，默认 4000 */
  slowAfterMs?: number
  role?: string
}

export function LoadingBar({ label, slowHint, slowAfterMs = 4000, role = 'loading' }: Props) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), slowAfterMs)
    return () => window.clearTimeout(t)
  }, [slowAfterMs])
  return (
    <div data-role={role} className="flex h-full w-full flex-col items-start justify-center gap-2 p-3">
      <p role="status" className="text-sm" style={{ color: 'var(--fg-muted)' }}>{label}</p>
      <div aria-hidden="true" data-busy="1" className="nav-progress w-full" style={{ position: 'static' }}>
        <div className="nav-progress-bar" />
      </div>
      {slow && slowHint ? (
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>{slowHint}</p>
      ) : null}
    </div>
  )
}
