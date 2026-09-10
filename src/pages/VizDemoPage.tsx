/**
 * 演示详情页（阶段 7 · 任务 1/3）：/#/viz/{demoId}。
 *
 * 页面不认识任何具体算法：从 registry 按 demo.renderer 取渲染器组件，把 Player 的
 * renderStep 交给它 + 一个代码面板。8 种排序与 4 个骨架样例共用这一页，
 * 会话 2 批量产出语料后**不需要再动这个文件**。
 *
 * 「演示不存在」与「加载失败」分开处理：前者先查索引（loader.VizNotFound）→ 不给重试按钮，
 * 后者是网络/构建问题 → 给重试。避免把打错的 URL 伪装成服务器故障。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Player } from '../modules/viz/Player'
import { VizNotFound, loadDemo, loadVizIndex } from '../modules/viz/data/loader'
import { categoryLabel, rendererFor } from '../modules/viz/registry'
import type { VizDemo } from '../modules/viz/types'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const chip: CSSProperties = { borderColor: 'var(--border)', color: 'var(--fg-muted)' }

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing'; id: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; demo: VizDemo }

export function VizDemoPage() {
  const { demoId = '' } = useParams<{ demoId?: string }>()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    const run = async (): Promise<VizDemo> => {
      const index = await loadVizIndex()
      if (!index.demos.some((d) => d.id === demoId)) throw new VizNotFound(demoId)
      return loadDemo(demoId)
    }
    run().then(
      (demo) => { if (alive) setPhase({ kind: 'ready', demo }) },
      (error: unknown) => {
        if (!alive) return
        if (error instanceof VizNotFound) setPhase({ kind: 'missing', id: demoId })
        else setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { alive = false }
  }, [demoId, reloadKey])

  if (phase.kind === 'loading') {
    return <p className="text-sm" style={muted}>正在加载演示语料…</p>
  }

  if (phase.kind === 'missing') {
    return (
      <section className="rounded-xl border p-6" style={{ ...panel, borderColor: 'var(--color-viz-swap)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-viz-swap)' }}>找不到这个演示</p>
        <p className="mt-1 text-sm" style={muted}>索引里没有 {phase.id}，可能链接打错了，或语料还没生成。</p>
        <Link to="/viz" className="mt-3 inline-block text-sm underline">← 返回演示列表</Link>
      </section>
    )
  }

  if (phase.kind === 'error') {
    return (
      <section className="rounded-xl border p-6" style={panel}>
        <p className="text-sm font-semibold">演示语料加载失败</p>
        <p className="mt-1 text-sm" style={muted}>{phase.message}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
          >
            重试
          </button>
          <Link to="/viz" className="rounded-md border px-3 py-1.5 text-sm" style={chip}>← 返回列表</Link>
        </div>
      </section>
    )
  }

  const demo = phase.demo
  const entry = rendererFor(demo.renderer)
  const Renderer = entry.Component
  const counters = demo.meta.counterKeys ?? []

  return (
    <Player
      steps={demo.steps}
      header={
        <header className="space-y-2">
          <Link to="/viz" className="text-sm underline" style={muted}>← 返回演示列表</Link>
          <h1 className="text-2xl font-semibold" data-role="viz-title">{demo.title}</h1>
          <p className="flex flex-wrap gap-1 text-xs" style={muted}>
            <span className="rounded border px-1.5 py-0.5" style={chip}>{categoryLabel(demo.category)}</span>
            <span className="rounded border px-1.5 py-0.5" style={chip}>{demo.chapter}</span>
            <span className="rounded border px-1.5 py-0.5" style={chip}>{entry.label}渲染器</span>
            {demo.meta.algorithm && (
              <span className="rounded border px-1.5 py-0.5 font-mono" style={chip}>{demo.meta.algorithm}</span>
            )}
            {demo.meta.n != null && (
              <span className="rounded border px-1.5 py-0.5" style={chip}>n = {demo.meta.n}</span>
            )}
            <span className="rounded border px-1.5 py-0.5" style={chip}>{demo.steps.length} 步</span>
            {counters.length > 0 && (
              <span className="rounded border px-1.5 py-0.5" style={chip}>统计：{counters.join(' / ')}</span>
            )}
          </p>
          {demo.meta.input && (
            <p className="font-mono text-xs" style={muted}>输入：[{demo.meta.input.join(', ')}]</p>
          )}
        </header>
      }
      renderStep={(step) => (
        <div className={demo.code ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}>
          <section className="rounded-xl border p-4" style={panel}>
            <Renderer demo={demo} step={step} />
          </section>
          {demo.code && <CodePanel code={demo.code} line={step.codeLine} />}
        </div>
      )}
    />
  )
}

/**
 * 对照代码面板：行号 + 可选的当前行高亮（step.codeLine，1-based）。
 * 只上屏展示不参与编译；高亮用 color-mix 取主题色的淡色，深浅色主题都读得清。
 */
function CodePanel({ code, line }: { code: string; line?: number }) {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <section className="overflow-hidden rounded-xl border" style={panel} data-role="viz-code">
      <p className="border-b px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
        对照代码（标准 C，仅展示不编译）
      </p>
      <pre className="overflow-x-auto py-2 text-xs leading-5">
        <code>
          {lines.map((text, i) => {
            const no = i + 1
            const active = line === no
            return (
              <div
                key={no}
                data-line={no}
                className="flex px-2"
                style={active ? { background: 'color-mix(in srgb, var(--color-viz-active) 20%, transparent)' } : undefined}
              >
                <span className="w-7 shrink-0 text-right opacity-50">{no}</span>
                <span className="ml-3 whitespace-pre">{text || ' '}</span>
              </div>
            )
          })}
        </code>
      </pre>
    </section>
  )
}