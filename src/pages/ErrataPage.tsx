import { useEffect, useState } from 'react'
import { dataUrl } from '../app/config'
import { Markdown } from '../components/common/Markdown'

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; source: string }

const panel = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted = { color: 'var(--fg-muted)' }
const control = { borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg)' }

/**
 * 原书勘误表页（阶段 10-3）。
 *
 * 内容真源是 docs/errata.md，`npm run build:index` 把它拷成 public/data/errata.md，
 * 这里只负责 fetch + Markdown 渲染：以后新发现一处印刷缺陷，只改文档、重跑索引即可，
 * 前端一行都不用动（通用化硬要求：不在代码里写死条目数或题号）。
 * 表格里的题号写成 `[c-ch06-cr-003](#/problems/p/c-ch06-cr-003)`，Markdown 组件会渲染成站内链接。
 */
export function ErrataPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    fetch(dataUrl('errata.md'))
      .then(async (res) => {
        if (!res.ok) throw new Error(`勘误表加载失败（HTTP ${res.status}）`)
        return res.text()
      })
      .then(
        (source) => { if (alive) setPhase({ kind: 'ready', source }) },
        (error: unknown) => {
          if (alive) setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        },
      )
    return () => { alive = false }
  }, [reloadKey])

  return (
    <section data-role="errata-page" className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">📕 原书勘误表</h1>
        <p className="mt-1 text-sm" style={muted}>
          原书印刷缺陷、题面缺项与本站的处理依据。每条都给出站内题目链接，可点进去核对详解原文。
        </p>
      </header>

      {phase.kind === 'loading' && (
        <div data-role="skeleton" aria-busy="true" aria-label="勘误表加载中">
          <p className="text-sm" style={muted}>正在加载勘误表…</p>
        </div>
      )}

      {phase.kind === 'error' && (
        <div data-role="load-error" className="rounded-xl border p-6" style={panel}>
          <p className="text-sm font-semibold">勘误表暂时读不到</p>
          <p className="mt-1 text-sm" style={muted}>{phase.message}</p>
          <p className="mt-1 text-sm" style={muted}>
            它不影响刷题与判分。原始文档在仓库 <code>docs/errata.md</code>，本地跑
            {' '}<code>npm run build:index</code> 可重新生成站点副本。
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-md border px-3 py-1.5 text-sm"
            style={control}
          >
            重试
          </button>
        </div>
      )}

      {phase.kind === 'ready' && (
        phase.source.trim().length === 0
          ? (
            <div data-role="empty" className="rounded-xl border p-6 text-sm" style={panel}>
              勘误表内容为空。
            </div>
          )
          : (
            <article className="rounded-xl border p-4 sm:p-6" style={panel} data-role="errata-body">
              <Markdown source={phase.source} />
            </article>
          )
      )}
    </section>
  )
}
