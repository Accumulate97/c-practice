/**
 * 🐛 错误博物馆（任务 3-4，路由 /bugs）。
 *
 * 这个板块解决的问题：学生背了"野指针很危险"，但从没见过危险长什么样。
 * 这里每件展品都是「🩸 病症代码 ↔ ✅ 正确写法」双栏对照，两边都能点「▶ 运行看后果」，
 * 走全站同一套 JudgeClient（Godbolt cg132 真机），崩了就如实报 runtime-error + 退出码 139。
 *
 * 三条诚实纪律（写死在实现里）：
 *   ① 展品里所有「本站实测」数字都来自 public/data/bugs/observed.json —— 那是
 *      scripts/probe-bug-exhibits.ts 真机跑出来的存档，不是文案里编的。observed 读不到时
 *      页面照常可用，只是不显示实测区块（不猜、不编）。
 *   ② 运行期测不出来的 bug（内存泄漏）不假装能测：展品的 severity 直接标「隐形」，
 *      文案说明「本站判分只看 stdout，所以这件展品跑不出异常」。
 *   ③ 后端不可用时如实说「本次未判定」，并把构建期实测证据顶上来当兜底 —— 绝不伪造通过。
 *
 * 展品代码禁用本站黑名单（gets / conio.h / getch / system("pause") / C++ 语法）：
 * 讲 gets 用文字讲，演示溢出用 scanf("%s") 无宽度限制 + 结构体哨兵，效果一样且不违规。
 *
 * 性能：路由级 lazy（本页拖着 JudgeClient），首页不为它付体积。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CodeBlock } from '../components/common/CodeBlock'
import { Markdown } from '../components/common/Markdown'
import { getBackend } from '../judge'
import { JudgeClient } from '../judge/client'
import { JudgeTransportError } from '../judge/types'
import type { ExecutionResult } from '../judge/types'
import { loadBugCorpus, loadBugObserved } from '../modules/bugs/data'
import type { BugExhibit, ObservedCorpus, ObservedRun } from '../modules/bugs/data'
import { loadKnowledgeIndex } from '../modules/knowledge/data/loader'
import { loadIndex } from '../modules/problems/data/loader'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const control: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg)' }

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; corpus: Awaited<ReturnType<typeof loadBugCorpus>>; observed: ObservedCorpus | null; titles: Record<string, string> }

type Variant = 'buggy' | 'safe'
type RunState =
  | { kind: 'running' }
  | { kind: 'done'; result: ExecutionResult; cacheHit: boolean }
  | { kind: 'transport'; message: string }
  | { kind: 'failed'; message: string }

const CLASS_TEXT: Record<ExecutionResult['errorClass'], string> = {
  ok: 'ok（进程正常返回）',
  'compile-error': 'compile-error（编译失败）',
  'runtime-error': 'runtime-error（运行期崩溃 / 非零退出）',
  timeout: 'timeout（运行超时）',
  truncated: 'truncated（输出被截断）',
}
const SEV_STYLE: Record<BugExhibit['severity'], CSSProperties> = {
  crash: { borderColor: 'var(--fg-bad)', color: 'var(--fg-bad)' },
  silent: { borderColor: 'var(--fg-warn)', color: 'var(--fg-warn)' },
  invisible: { borderColor: 'var(--fg-link)', color: 'var(--fg-link)' },
}

export function BugMuseumPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [params] = useSearchParams()
  const [runs, setRuns] = useState<Record<string, RunState>>({})

  const client = useMemo(() => new JudgeClient(getBackend()), [])

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    void (async () => {
      try {
        const [corpus, observed] = await Promise.all([loadBugCorpus(), loadBugObserved()])
        // 关联链接要显示标题而不是裸 id：两份索引全站共享缓存，这里只是取一次
        const titles: Record<string, string> = {}
        const [pi, ki] = await Promise.all([
          loadIndex().catch(() => null),
          loadKnowledgeIndex().catch(() => null),
        ])
        for (const p of pi?.problems ?? []) titles[p.id] = p.title
        for (const c of ki?.cards ?? []) titles[c.id] = c.title
        if (alive) setPhase({ kind: 'ready', corpus, observed, titles })
      } catch (error) {
        if (alive) setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => { alive = false }
  }, [reloadKey])

  const run = useCallback(async (exhibitId: string, variant: Variant, code: string, stdin: string) => {
    const key = `${exhibitId}:${variant}`
    setRuns((m) => ({ ...m, [key]: { kind: 'running' } }))
    try {
      const { result, cacheHit } = await client.request({ code, stdin })
      setRuns((m) => ({ ...m, [key]: { kind: 'done', result, cacheHit } }))
    } catch (error) {
      if (error instanceof JudgeTransportError) {
        setRuns((m) => ({ ...m, [key]: { kind: 'transport', message: error.message } }))
      } else {
        setRuns((m) => ({ ...m, [key]: { kind: 'failed', message: error instanceof Error ? error.message : String(error) } }))
      }
    }
  }, [client])

  const shown = useMemo(() => {
    if (phase.kind !== 'ready') return []
    const query = q.trim().toLowerCase()
    return phase.corpus.exhibits.filter((e) => {
      if (cat !== 'all' && e.category !== cat) return false
      if (!query) return true
      return `${e.title} ${e.symptom} ${e.story} ${e.takeaway.join(' ')} ${e.chapter}`.toLowerCase().includes(query)
    })
  }, [phase, cat, q])
  // 任务 4-2：全站搜索的展品深链 ?ex=<id> —— 直接展开那件展品并滚过去，
  // 不让学生在十件折叠条目里再找一遍。语料还没加载完就先记着，ready 后自动展开；
  // id 在语料里查无此物就什么都不做（宁可不动，也不展开一件不相干的展品）。
  const deepEx = params.get('ex') ?? ''
  useEffect(() => {
    if (!deepEx || phase.kind !== 'ready') return
    if (!phase.corpus.exhibits.some((e) => e.id === deepEx)) return
    setOpen(deepEx)
    const el = document.querySelector('[data-role="bugs-exhibit"][data-id="' + CSS.escape(deepEx) + '"]')
    el?.scrollIntoView({ block: 'start' })
  }, [deepEx, phase])


  return (
    <section className="space-y-4" data-role="bugs-page">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">🐛 错误博物馆</h1>
        <p className="text-sm" style={muted}>
          {phase.kind === 'ready'
            ? `${phase.corpus.exhibits.length} 件经典 bug 展品 · ${phase.corpus.exhibits.length * 2} 段可运行代码。左边病症、右边正解，两边都能真机运行看后果。`
            : '经典 bug 的可交互陈列馆：每段代码都能真机运行，看它到底怎么坏。'}
        </p>
        <p className="rounded-lg border px-3 py-2 text-xs" style={{ ...panel, ...muted }} data-role="bugs-honesty">
          🔎 诚实声明：判分走全站同一套 Godbolt 链路，崩了就报 runtime-error，不粉饰成「通过」；
          「上次实测」区块的数字来自构建期真机存档 <code>public/data/bugs/observed.json</code>（<code>npm run probe:bugs</code> 生成）。
          内存泄漏这类运行期测不出来的展品，severity 直接标「隐形」，不假装能测。
        </p>
      </header>

      {phase.kind === 'loading' && (
        <div data-role="skeleton" aria-busy="true" aria-label="展品加载中">
          <p className="text-sm" style={muted}>正在打开展柜…</p>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="rounded-xl border p-6" style={panel} data-role="load-error">
          <p className="text-sm font-semibold">展品清单暂时读不到</p>
          <p className="mt-1 text-sm" style={muted}>{phase.message}</p>
          <p className="mt-1 text-sm" style={muted}>
            它不影响刷题与判分。语料在仓库 <code>public/data/bugs/</code>，本地跑
            {' '}<code>npm run gen:bugs</code> + <code>npm run probe:bugs</code> 可重新生成。
          </p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mt-3 min-h-10 rounded-md border px-3 py-2 text-sm" style={control}>
            重试
          </button>
        </div>
      )}

      {phase.kind === 'ready' && (
        <>
          <div className="sticky top-0 z-10 space-y-2 rounded-lg border p-3" style={{ ...panel, background: 'var(--bg-elev)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm" htmlFor="bugs-q" style={muted}>🔍 找哪种坑</label>
              <input
                id="bugs-q"
                type="search"
                data-role="bugs-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="如 野指针、越界、泄漏、溢出、sizeof…"
                className="min-h-10 min-w-0 flex-1 rounded border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
              />
              <span className="text-xs" style={muted} data-role="bugs-count" aria-live="polite">
                {shown.length} / {phase.corpus.exhibits.length} 件
              </span>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              <Chip label="🗂 全部" on={cat === 'all'} onClick={() => setCat('all')} id="all" />
              {phase.corpus.categories.map((c) => (
                <Chip
                  key={c.id}
                  id={c.id}
                  label={`${c.emoji} ${c.title}`}
                  on={cat === c.id}
                  onClick={() => setCat(c.id)}
                />
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-lg border px-3 py-6 text-center text-sm" style={{ ...panel, ...muted }} data-role="bugs-empty">
              没有命中「{q.trim() || '该分类'}」的展品。换个词（野指针 / 越界 / 泄漏 / 溢出），或点「🗂 全部」。
            </p>
          ) : (
            <ul className="space-y-3">
              {shown.map((e) => (
                <Exhibit
                  key={e.id}
                  exhibit={e}
                  observed={phase.observed}
                  titles={phase.titles}
                  open={open === e.id}
                  onToggle={() => setOpen((cur) => (cur === e.id ? null : e.id))}
                  runState={(v) => runs[`${e.id}:${v}`]}
                  onRun={run}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Chip({ id, label, on, onClick }: { id: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-role="bugs-filter"
      data-cat={id}
      aria-pressed={on}
      onClick={onClick}
      className="min-h-8 rounded-md border px-2.5 py-1.5"
      style={{
        borderColor: on ? 'var(--fg-link)' : 'var(--border)',
        background: on ? 'color-mix(in srgb, var(--fg-link) 14%, transparent)' : 'transparent',
        color: 'var(--fg)',
      }}
    >
      {label}
    </button>
  )
}

interface ExhibitProps {
  exhibit: BugExhibit
  observed: ObservedCorpus | null
  titles: Record<string, string>
  open: boolean
  onToggle: () => void
  runState: (v: Variant) => RunState | undefined
  onRun: (exhibitId: string, variant: Variant, code: string, stdin: string) => void
}

function Exhibit({ exhibit, observed, titles, open, onToggle, runState, onRun }: ExhibitProps) {
  const regionId = `bugs-detail-${exhibit.id}`
  return (
    <li>
      <article
        className="rounded-xl border"
        style={panel}
        data-role="bugs-exhibit"
        data-id={exhibit.id}
        data-category={exhibit.category}
        data-severity={exhibit.severity}
      >
        <h2 className="m-0 text-base">
          <button
            type="button"
            data-role="bugs-toggle"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={regionId}
            className="flex w-full min-h-12 flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-left"
            style={{ color: 'var(--fg)' }}
          >
            <span aria-hidden="true">{exhibit.emoji}</span>
            <span className="min-w-0 flex-1 font-semibold">{exhibit.title}</span>
            <span className="rounded-full border px-2 py-0.5 text-xs" style={SEV_STYLE[exhibit.severity]} title={exhibit.severityHint}>
              {exhibit.severityLabel}
            </span>
            <span className="text-xs" style={muted}>{exhibit.chapter}</span>
            <span aria-hidden="true" className="text-xs" style={muted}>{open ? '▲' : '▼'}</span>
          </button>
        </h2>

        {open && (
          <div id={regionId} data-role="bugs-detail" className="space-y-3 border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
            <p className="m-0 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', ...muted }}>
              <strong style={{ color: 'var(--fg)' }}>你会看到：</strong>{exhibit.symptom}
            </p>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
              {(['buggy', 'safe'] as const).map((v) => {
                const variant = exhibit[v]
                const state = runState(v)
                const obs = observed?.runs[`${exhibit.id}:${v}`]
                return (
                  <div key={v} className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: v === 'buggy' ? 'var(--fg-bad)' : 'var(--fg-ok)' }}>
                        {v === 'buggy' ? '🩸 病症代码' : '✅ 正确写法'}
                      </span>
                      <button
                        type="button"
                        data-role="bugs-run"
                        data-variant={v}
                        disabled={state?.kind === 'running'}
                        onClick={() => void onRun(exhibit.id, v, variant.code, variant.stdin)}
                        className="ml-auto min-h-10 rounded-md border px-3 py-2 text-xs disabled:opacity-50"
                        style={control}
                      >
                        {state?.kind === 'running' ? '⏳ 排队运行中…' : '▶ 运行看后果'}
                      </button>
                    </div>

                    <CodeBlock code={variant.code} dataRole={`bugs-code-${v}`} title={variant.stdin ? `stdin：${JSON.stringify(variant.stdin)}` : '无 stdin'} />

                    {state?.kind === 'running' && (
                      <p className="m-0 text-xs" style={muted} aria-live="polite" data-role="bugs-run-pending">
                        已交给判分队列（全站严格串行，一般 1–3 s）…
                      </p>
                    )}

                    {state?.kind === 'done' && <RunResult result={state.result} cacheHit={state.cacheHit} variant={v} />}

                    {(state?.kind === 'transport' || state?.kind === 'failed') && (
                      <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--fg-warn)', ...muted }} data-role="bugs-run-transport" aria-live="polite">
                        <p className="m-0 font-semibold" style={{ color: 'var(--fg)' }}>
                          {state.kind === 'transport' ? '⚠️ 本次未判定：判分后端不可用' : '⚠️ 运行失败'}
                        </p>
                        <p className="m-0 mt-1">{state.message}</p>
                        {obs?.probed && <p className="m-0 mt-1">下方「上次实测」是构建期真机存档，可以先看它。</p>}
                      </div>
                    )}

                    {obs?.probed && <Observed obs={obs} variant={v} compiler={observed?.backend.compiler} probedAt={observed?.probedAt} />}
                  </div>
                )
              })}
            </div>

            <div className="space-y-2">
              <h3 className="m-0 text-sm font-semibold">🧠 为什么会这样</h3>
              <Markdown source={exhibit.story} />
              <p className="m-0 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', ...muted }}>
                <strong style={{ color: 'var(--fg)' }}>编译器怎么说：</strong>{exhibit.compilerSays}
              </p>
              <h3 className="m-0 text-sm font-semibold">📌 带走的纪律</h3>
              <ul className="m-0 space-y-1 pl-5 text-sm" style={muted}>
                {exhibit.takeaway.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>

            <div className="space-y-1 border-t pt-2 text-xs" style={{ borderColor: 'var(--border)', ...muted }}>
              <p className="m-0" data-role="bugs-links-knowledge">
                📖 配套知识卡片：
                {exhibit.knowledgeIds.map((id, i) => (
                  <span key={id}>{i > 0 && '、'}<Link data-role="bugs-knowledge-link" className="underline" to={`/knowledge/${id}`}>{titles[id] ?? id}</Link></span>
                ))}
              </p>
              <p className="m-0" data-role="bugs-links-problems">
                ✍️ 配套练习：
                {exhibit.relatedProblems.map((id, i) => (
                  <span key={id}>{i > 0 && '、'}<Link data-role="bugs-problem-link" className="underline" to={`/problems/p/${id}`}>{titles[id] ?? id}</Link></span>
                ))}
              </p>
            </div>
          </div>
        )}
      </article>
    </li>
  )
}

function RunResult({ result, cacheHit, variant }: { result: ExecutionResult; cacheHit: boolean; variant: Variant }) {
  const bad = result.errorClass !== 'ok'
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: bad ? 'var(--fg-bad)' : 'var(--fg-ok)' }}
      data-role="bugs-run-result"
      data-variant={variant}
      aria-live="polite"
    >
      <p className="m-0 font-semibold" style={{ color: bad ? 'var(--fg-bad)' : 'var(--fg-ok)' }} data-role="bugs-run-class">
        {bad ? '💥' : '✅'} {CLASS_TEXT[result.errorClass]} · exit={result.exitCode}
        {typeof result.execTimeMs === 'number' && ` · ${result.execTimeMs} ms`}
        {cacheHit && '（缓存命中，未再发请求）'}
      </p>
      {result.stdout.trim() === '' && (
        <p className="m-0 mt-1" style={muted} data-role="bugs-run-empty">
          stdout 为空 —— 进程崩溃时 stdio 缓冲区不会自动 flush，之前 printf 的内容跟着一起丢了。
        </p>
      )}
      {result.stdout.trim() !== '' && (
        <pre className="m-0 mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2" data-role="bugs-run-stdout">{result.stdout}</pre>
      )}
      {result.stderr.trim() !== '' && (
        <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2" style={muted} data-role="bugs-run-stderr">{result.stderr}</pre>
      )}
      {result.diagnostics.length > 0 && (
        <ul className="m-0 mt-1 space-y-0.5 pl-4" style={muted} data-role="bugs-run-diags">
          {result.diagnostics.slice(0, 8).map((d, i) => <li key={i}>L{d.line} [{d.severity}] {d.message}</li>)}
        </ul>
      )}
    </div>
  )
}

function Observed({ obs, variant, compiler, probedAt }: { obs: ObservedRun; variant: Variant; compiler?: string; probedAt?: string }) {
  const diags = obs.diagnostics ?? []
  return (
    <details className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)' }} data-role="bugs-observed" data-variant={variant}>
      <summary className="cursor-pointer font-semibold" style={muted}>
        🗄 上次实测{probedAt ? `（${probedAt.slice(0, 10)}${compiler ? ` · ${compiler}` : ''}）` : ''}
        {obs.stale ? ' · ⚠️ 本次探针未判定，沿用上一份证据' : ''}
      </summary>
      <div className="mt-2 space-y-1">
        <p className="m-0" data-role="bugs-observed-class">
          {obs.errorClass} · exit={obs.exitCode}
          {typeof obs.execTimeMs === 'number' && ` · ${obs.execTimeMs} ms`}
        </p>
        {(obs.stdout ?? '').trim() !== '' && (
          <pre className="m-0 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2" data-role="bugs-observed-stdout">{obs.stdout}</pre>
        )}
        {(obs.stdout ?? '').trim() === '' && (
          <p className="m-0" style={muted}>stdout 为空（崩溃时缓冲区未 flush）。</p>
        )}
        {(obs.stderr ?? '').trim() !== '' && (
          <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2" style={muted} data-role="bugs-observed-stderr">{obs.stderr}</pre>
        )}
        {diags.length > 0 ? (
          <ul className="m-0 space-y-0.5 pl-4" style={muted} data-role="bugs-observed-diags">
            {diags.slice(0, 8).map((d, i) => <li key={i}>L{d.line} [{d.severity}] {d.message}</li>)}
          </ul>
        ) : (
          <p className="m-0" style={muted} data-role="bugs-observed-nodiag">编译器 0 条诊断 —— 它没拦住这个 bug。</p>
        )}
      </div>
    </details>
  )
}
