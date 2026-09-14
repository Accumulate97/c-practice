/**
 * 首访引导（任务 4-1）。
 *
 * 触发条件（四个都成立才浮出来，任何一个不成立就永远不打扰）：
 *   ① 就在首页 /；② localStorage 里没有任何做题记录；③ 没被关掉过；④ URL 没带 ?noboot=1。
 * 第 ④ 条是给验收脚本与深链留的开关：a11y 专项、stage10、search 三套验收都用全新浏览器
 * 上下文访问首页，它们要量的是首页本身，不该被一层浮层干扰。
 *
 * 为什么**不做**全屏模态 + 遮罩：
 *   - 遮罩会把首页整块挡住，而首页本身已经把「怎么用」讲得很清楚（三大板块 + 快速开始）；
 *   - 模态必须配焦点陷阱与焦点归还，否则键盘用户 Tab 出去就掉进背后的页面里，反而更差；
 *   - 非阻塞浮层允许「先关掉，自己看看」，这本来就是第三个入口「随便逛逛」的意思。
 * 所以它是一个可关闭的角落面板：不抢焦点、不锁滚动、不遮内容。
 *
 * 隐私模式下 localStorage 会抛异常，用会话级变量兜底 —— 至少保证「同一次浏览不重复弹」，
 * 而不是每次路由回首页都弹一遍（那比不弹更烦人）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { APP_NAME, STORAGE_PREFIX } from '../../app/config'
import { useProgress } from '../../modules/problems/progress/store'

const ONBOARDED_KEY = `${STORAGE_PREFIX}:onboarded:v1`

let sessionDone = false

function alreadyOnboarded(): boolean {
  if (sessionDone) return true
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) !== null
  } catch {
    return false
  }
}

/**
 * 清掉「已经看过引导」的两处痕迹（localStorage + 会话级变量）。
 * 页脚那个「重看新手引导」链接要用：只删 localStorage 不够，sessionDone 还拦着。
 */
export function resetOnboarding(): void {
  sessionDone = false
  try {
    window.localStorage.removeItem(ONBOARDED_KEY)
  } catch {
    /* 读不到也就删不掉，忽略 */
  }
}

function markOnboarded(): void {
  sessionDone = true
  try {
    window.localStorage.setItem(ONBOARDED_KEY, String(Date.now()))
  } catch {
    /* 写不进去就算了：sessionDone 已经拦住了本次会话 */
  }
}

const MUTED: CSSProperties = { color: 'var(--fg-muted)' }

const ENTRIES = [
  {
    to: '/path',
    label: '🗺️ 学习路径第一关',
    hint: '按「学 → 懂 → 练」的顺序走，通了上一关才解锁下一关',
  },
  {
    to: '/problems?pick=daily',
    label: '📅 今天的每日一题',
    hint: '不想被安排就先做一道，看看题目长什么样',
  },
  {
    to: '/problems',
    label: '🔎 随便逛逛题库',
    hint: '自己按章节 / 题型 / 难度挑',
  },
]

export function OnboardingOverlay() {
  const location = useLocation()
  const records = useProgress((s) => s.records)
  const [open, setOpen] = useState(false)

  const onHome = location.pathname === '/'
  const q = new URLSearchParams(location.search)
  const suppressed = q.get('noboot') === '1'
  // ?boot=1 = 用户自己点了页脚「重看新手引导」，此时他有没有进度都该再给看一次。
  // 注意它压不过 ?noboot=1：验收脚本要的是确定性静默，那个开关必须是最高优先级。
  const forced = q.get('boot') === '1' && suppressed !== true
  const fresh = forced || Object.keys(records).length === 0

  const dismiss = useCallback(() => {
    markOnboarded()
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!onHome || suppressed || !fresh || alreadyOnboarded()) {
      setOpen(false)
      return
    }
    // 等首屏渲染完再浮出来：与首屏抢同一帧会让首页看起来卡了一下
    const t = window.setTimeout(() => setOpen(true), 600)
    return () => window.clearTimeout(t)
    // location.key 进依赖：同一个 ?boot=1 地址连点两次「重看」也要能再弹（否则第二次点了没反应）
  }, [onHome, suppressed, fresh, location.key])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (!open) return null

  return (
    <section
      data-role="onboarding"
      role="dialog"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
      className="fixed bottom-3 right-3 z-40 w-[min(23rem,calc(100vw-1.5rem))] rounded-xl border p-4 shadow-lg"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg)' }}
    >
      <div className="flex items-start gap-2">
        <h2 id="onboarding-title" className="flex-1 text-base font-semibold">
          👋 第一次来？
        </h2>
        <button
          type="button"
          onClick={dismiss}
          data-role="onboarding-close"
          aria-label="关闭新手引导（不再显示）"
          title="关闭新手引导（不再显示）"
          className="min-h-8 min-w-8 shrink-0 rounded-md border px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)', background: 'transparent' }}
        >
          ✕
        </button>
      </div>
      <p id="onboarding-desc" className="mt-1 text-sm" style={MUTED}>
        {APP_NAME} 是「学 → 懂 → 练」三步走：先读知识点卡片，再看算法演示，最后在线写代码真机判分。
        进度只存在你这台设备的浏览器里，不上传。
      </p>
      <ul className="mt-3 space-y-2">
        {ENTRIES.map((e) => (
          <li key={e.to}>
            <Link
              to={e.to}
              onClick={dismiss}
              data-role={`onboarding-entry:${e.to}`}
              className="block rounded-lg border px-3 py-2 text-sm no-underline"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
            >
              <span className="font-medium">{e.label}</span>
              <span className="mt-0.5 block text-xs" style={MUTED}>{e.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs" style={MUTED}>
        这条引导只出现一次，之后可在页面底部「重看新手引导」里再打开。
      </p>
    </section>
  )
}
