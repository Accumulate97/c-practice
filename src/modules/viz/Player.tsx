/**
 * 可视化播放器内核（阶段 7 · 任务 1）。
 *
 * 传输控制与渲染解耦：Player 只管「当前第几步、是否在自动播放、播放多快」，
 * 具体每一步怎么画交给 renderStep（页面把渲染器传进来）。对比页复用同一个
 * usePlayback 实现同步步进，不留第二套播放逻辑。
 *
 * 两条硬约束（07_可视化演示规范.md 三、五）：
 *   · 后退靠快照数组下标回退，不做逆运算 —— clampStep（Step.ts）统一收口；
 *   · 自动播放用 requestAnimationFrame 驱动，不用 setInterval（规范五：避免丢帧）。
 * 键盘（规范三·1）：空格=播放/暂停，←/→=单步，Home/End=跳首/尾；
 *   焦点在输入控件上时不拦截，避免抢走表单操作。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { clampStep, canGoNext, makeTimeline } from './Step'
import type { VizStep } from './types'

export const SPEEDS = [0.5, 1, 2, 4] as const
/** 1x 时每步基础间隔（ms）。规范三：动画 300–500ms 看着舒服；1x 取 600ms，4x=150ms 不闪。 */
export const BASE_DELAY = 600

export interface Playback {
  index: number
  count: number
  playing: boolean
  speed: number
  setSpeed: (s: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  first: () => void
  last: () => void
  reset: () => void
  seekTo: (i: number) => void
}

/**
 * 单演示页与对比页共用的播放状态机。count<=1（空/单步演示）恒停在第 0 步、不自动播放。
 * 末尾停播由独立 effect 负责，不在 setIndex 的更新函数里 setState（更新函数必须纯）。
 */
export function usePlayback(count: number): Playback {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState<number>(1)
  const raf = useRef<number | null>(null)
  const lastTs = useRef<number>(0)
  const acc = useRef<number>(0)

  const seekTo = useCallback((i: number) => setIndex(clampStep(i, count)), [count])
  const next = useCallback(() => setIndex((p) => clampStep(p + 1, count)), [count])
  const prev = useCallback(() => setIndex((p) => clampStep(p - 1, count)), [count])
  const first = useCallback(() => setIndex(0), [])
  const last = useCallback(() => setIndex(clampStep(count - 1, count)), [count])
  const reset = useCallback(() => { setPlaying(false); setIndex(0) }, [])
  const play = useCallback(() => { if (count > 1) setPlaying(true) }, [count])
  const pause = useCallback(() => setPlaying(false), [])
  const toggle = useCallback(() => setPlaying((p) => (count > 1 ? !p : false)), [count])
  const setSpeed = useCallback((s: number) => setSpeedState(s), [])

  useEffect(() => {
    if (!playing) return
    lastTs.current = performance.now()
    acc.current = 0
    const tick = (now: number): void => {
      const dt = now - lastTs.current
      lastTs.current = now
      acc.current += dt
      if (acc.current >= BASE_DELAY / speed) {
        acc.current = 0
        setIndex((p) => clampStep(p + 1, count))
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null }
  }, [playing, speed, count])

  // 手动步进 / 拖动到末尾时停播，避免「还在播但画面不动」的困惑。
  useEffect(() => { if (!canGoNext(index, count)) setPlaying(false) }, [index, count])

  return { index, count, playing, speed, setSpeed, play, pause, toggle, next, prev, first, last, reset, seekTo }
}

export interface PlayerProps {
  steps: readonly VizStep[]
  /** 每一步怎么画由页面决定：渲染器画布 + 代码面板都从这里返回 */
  renderStep: (step: VizStep, index: number) => ReactNode
  /** 传输条上方的一行（页面可放标题、返回链接、算法徽标等） */
  header?: ReactNode
}

const bar: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const btn: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }
const btnActive: CSSProperties = { borderColor: 'var(--color-brand)', background: 'var(--color-brand)', color: '#fff' }

function TButton(props: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.title ?? props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
      style={btn}
    >
      {props.label}
    </button>
  )
}

export function Player({ steps, renderStep, header }: PlayerProps) {
  const count = steps.length
  const pb = usePlayback(count)
  const timeline = makeTimeline(steps, pb.index)
  const step = timeline.current

  // 用 ref 持有最新播放状态：键盘监听只订阅一次（依赖 count），却总能读到最新 index/playing。
  const pbRef = useRef(pb)
  useEffect(() => { pbRef.current = pb })

  const startPlay = useCallback(() => {
    const p = pbRef.current
    if (p.playing) { p.pause(); return }
    if (!canGoNext(p.index, p.count)) p.seekTo(0)
    p.play()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const p = pbRef.current
      switch (e.key) {
        case ' ': case 'Spacebar':
          e.preventDefault()
          if (p.playing) p.pause()
          else { if (!canGoNext(p.index, p.count)) p.seekTo(0); p.play() }
          break
        case 'ArrowRight': e.preventDefault(); p.pause(); p.next(); break
        case 'ArrowLeft': e.preventDefault(); p.pause(); p.prev(); break
        case 'Home': e.preventDefault(); p.pause(); p.first(); break
        case 'End': e.preventDefault(); p.pause(); p.last(); break
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count])

  return (
    <div className="space-y-3">
      {header}
      <div className="rounded-lg border p-3" style={bar}>
        <div className="flex flex-wrap items-center gap-2">
          <TButton label="⏮ 重置" onClick={() => { pb.reset() }} />
          <TButton label="◀ 上一步" onClick={() => { pb.pause(); pb.prev() }} disabled={timeline.atStart} />
          <button
            type="button"
            data-role="viz-play"
            aria-label={pb.playing ? '暂停' : '播放'}
            onClick={startPlay}
            className="rounded-md border px-4 py-1.5 text-sm font-medium"
            style={pb.playing ? btnActive : btn}
          >
            {pb.playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <TButton label="下一步 ▶" onClick={() => { pb.pause(); pb.next() }} disabled={timeline.atEnd} />
          <TButton label="末步 ⏭" onClick={() => { pb.pause(); pb.last() }} disabled={timeline.atEnd} />
          <span className="ml-auto flex items-center gap-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
            速度
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`速度 ${s}x`}
                onClick={() => pb.setSpeed(s)}
                className="rounded-md border px-2 py-1 text-xs"
                style={pb.speed === s ? btnActive : btn}
              >
                {s}x
              </button>
            ))}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            aria-label="进度"
            min={0}
            max={Math.max(0, count - 1)}
            value={pb.index}
            onChange={(e) => { pb.pause(); pb.seekTo(Number(e.target.value)) }}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full"
            style={{ background: 'var(--border)' }}
          />
          <span data-role="viz-step" className="whitespace-nowrap font-mono text-xs" style={{ color: 'var(--fg-muted)' }}>
            步骤 {count > 0 ? pb.index + 1 : 0} / {count}
          </span>
        </div>
      </div>

      <div data-role="viz-canvas">
        {step ? renderStep(step, pb.index) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>（本演示暂无步骤）</p>
        )}
      </div>

      <p data-role="viz-desc" className="min-h-[2.5rem] rounded-lg border p-3 text-sm leading-relaxed" style={bar}>
        {step?.description ?? '—'}
      </p>
      <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
        键盘：空格 播放/暂停 · ← → 单步 · Home/End 跳首/尾
      </p>
    </div>
  )
}