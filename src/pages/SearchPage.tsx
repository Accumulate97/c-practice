/**
 * 全站搜索页（任务 4-2）：/#/search?q=关键词
 *
 * 一处搜全部：题目 / 知识卡片 / 2D 演示 / 3D 演示 / 错误展品 / 速查手册行 / 站内页面，
 * 语料是构建期生成的 unified.json（2806 条 / 727 KB），**只在进本页时才下载**，
 * 路由级 lazy + 单飞缓存：首页与其它板块一分钱都不为它付。
 *
 * 交互口径：
 *   · URL 是唯一真相（?q= 与 ?kind=），刷新 / 分享 / 后退都还原同一屏结果；
 *   · 输入即搜（本地打分 <2 ms，不需要防抖，也不该让学生多按一次回车）；
 *   · 五态齐全：未输入（给热词）/ 加载中（骨架）/ 加载失败（可重试）/ 无结果（给建议）/ 有结果；
 *   · 命中数如实报，被 limit 截断时明说「只显示前 N 条」。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { KIND_META, KIND_ORDER, docUrl, highlight, loadCorpus, searchCorpus } from '../modules/search/corpus'
import type { SearchCorpus, SearchKind } from '../modules/search/corpus'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

/** 未输入时的热词：覆盖三大板块与四类工具，点一下即搜 */
const SUGGESTIONS = ['printf', 'scanf', '指针', '递归', '排序', 'malloc', 'KMP', 'ASCII', '野指针', 'struct', '哈夫曼', '栈']

/** 哪些类别的结果行要把 id 亮出来：题号/卡片号可以直接搜，也方便学生报「这题不对」时引用 */
const SHOW_ID: ReadonlySet<SearchKind> = new Set<SearchKind>(['problem', 'knowledge', 'viz', 'viz3d', 'bug'])

/** 空结果时的排查建议（诚实：本站是子串匹配，不做同义词扩展） */
const TIPS = [
  '换更短的词：搜「链表的插入」不如搜「链表 插入」，两个词都要命中才算数',
  '中英文都行：printf、%d、malloc、sizeof 直接搜原文',
  '题目 id 可直接搜：例如 c-ch03-pg-001',
  '搜不到就去看速查手册与知识点汇总的章节目录',
]

function Mark({ text, tokens }: { text: string; tokens: readonly string[] }) {
  const parts = useMemo(() => highlight(text, tokens), [text, tokens])
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const kindParam = params.get('kind') ?? ''
  const [corpus, setCorpus] = useState<SearchCorpus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 语料只下载一次；失败给「重试」而不是白屏（纯静态站也可能撞上 CDN 抖动）
  useEffect(() => {
    let alive = true
    setError(null)
    loadCorpus()
      .then((c) => { if (alive) setCorpus(c) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [reloadKey])

  // 直接落在 /search（没带 q）时把光标放进输入框：这页存在的意义就是让人立刻打字
  useEffect(() => {
    if (!q) inputRef.current?.focus()
  }, [q])

  const kinds = useMemo<Set<SearchKind> | null>(() => {
    if (!kindParam) return null
    const set = new Set<SearchKind>()
    for (const k of kindParam.split(',')) {
      if ((KIND_ORDER as readonly string[]).includes(k)) set.add(k as SearchKind)
    }
    return set.size > 0 ? set : null
  }, [kindParam])

  const result = useMemo(
    () => (corpus ? searchCorpus(corpus, q, { kinds }) : null),
    [corpus, q, kinds],
  )

  /** 写回 URL：replace 而不是 push，否则每敲一个字就多一条历史记录，后退键彻底废掉 */
  const setQuery = (next: string) => {
    const p = new URLSearchParams(params)
    if (next) p.set('q', next)
    else p.delete('q')
    setParams(p, { replace: true })
  }
  const toggleKind = (k: SearchKind) => {
    const cur = new Set(kinds ?? [])
    if (cur.has(k)) cur.delete(k)
    else cur.add(k)
    const p = new URLSearchParams(params)
    // 全选 = 没选：清掉参数，URL 才干净
    if (cur.size === 0 || cur.size === KIND_ORDER.length) p.delete('kind')
    else p.set('kind', KIND_ORDER.filter((x) => cur.has(x)).join(','))
    setParams(p, { replace: true })
  }

  const totals = corpus?.totals ?? {}
  const hasQuery = q.trim().length > 0
  /** chip 角标口径：有查询时 = 该类别的真实命中数（0 就写 0 并禁用按钮）；没查询时 = 语料规模。
   *  绝不能在有查询时拿语料总数兜底 —— 那是把「本站有 2074 道题」冒充成「你这个词命中 2074 道题」。 */
  const chips: { key: SearchKind | 'all'; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: hasQuery ? (result?.matchedFiltered ?? 0) : (totals.all ?? 0) },
    ...KIND_ORDER.map((k) => ({
      key: k as SearchKind | 'all',
      label: `${KIND_META[k].emoji} ${KIND_META[k].label}`,
      count: hasQuery ? (result?.kindCounts[k] ?? 0) : (totals[k] ?? 0),
    })),
  ]

  let body: ReactNode
  if (error) {
    body = (
      <div className="rounded-xl border p-6 text-center" style={{ ...panel, borderColor: 'var(--fg-bad)' }} data-role="search-error">
        <p className="m-0 font-semibold" style={{ color: 'var(--fg-bad)' }}>搜索语料没加载出来</p>
        <p className="m-0 mt-1 text-xs break-all" style={muted}>{error}</p>
        <button
          type="button"
          data-role="search-retry"
          onClick={() => setReloadKey((n) => n + 1)}
          className="mt-3 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
        >
          重试
        </button>
      </div>
    )
  } else if (!corpus) {
    body = (
      <div data-role="search-loading" aria-busy="true" aria-label="搜索语料加载中" className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }} />
        ))}
        <p className="m-0 text-xs" style={muted}>正在下载全站搜索语料（727 KB，只下载一次，之后浏览器缓存）…</p>
      </div>
    )
  } else if (!q.trim()) {
    body = (
      <div className="rounded-xl border p-5" style={panel} data-role="search-idle">
        <h2 className="m-0 text-base font-semibold">试试这些</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              data-role="search-suggest"
              onClick={() => setQuery(s)}
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="m-0 mt-4 text-xs" style={muted}>
          一处搜全部：{totals.problem ?? 0} 道题、{totals.knowledge ?? 0} 张知识卡片、
          {totals.viz ?? 0} 个 2D 演示、{totals.viz3d ?? 0} 个 3D 演示、
          {totals.bug ?? 0} 件错误展品、{totals.ref ?? 0} 条速查手册条目。
          多个词用空格隔开，全部命中才算数；搜到的手册条目点进去会自动填好手册页的过滤框。
        </p>
      </div>
    )
  } else if (!result || result.hits.length === 0) {
    body = (
      <div className="rounded-xl border p-6 text-center" style={panel} data-role="search-empty">
        <p className="m-0 text-2xl" aria-hidden="true">🕳️</p>
        <p className="m-0 mt-1 font-semibold" data-role="search-empty-title">
          {kinds && result && result.matched > 0
            ? `「${q}」在全部类别里命中 ${result.matched} 条，但你选的类别里一条都没有`
            : `「${q}」没有命中任何内容`}
        </p>
        <ul className="mx-auto mt-3 max-w-md space-y-1 text-left text-xs" style={muted}>
          {TIPS.map((t) => <li key={t}>{t}</li>)}
        </ul>
        {kinds && (
          <button
            type="button"
            data-role="search-clear-kind"
            onClick={() => { const p = new URLSearchParams(params); p.delete('kind'); setParams(p, { replace: true }) }}
            className="mt-3 rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
          >
            清除类别过滤再试
          </button>
        )}
      </div>
    )
  } else {
    const shown = result.hits.length
    body = (
      <ol className="m-0 space-y-2 p-0" data-role="search-results">
        {result.hits.map((h) => {
          const meta = KIND_META[h.doc.k]
          const to = docUrl(h.doc)
          return (
            <li key={`${h.doc.k}:${h.doc.id}`}>
              <Link
                to={to}
                data-role="search-result"
                data-kind={h.doc.k}
                data-id={h.doc.id}
                className="block rounded-lg border p-3 no-underline transition hover:-translate-y-px"
                style={{ ...panel, borderColor: 'var(--border)', color: 'var(--fg)' }}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={muted}>
                  <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border)' }} data-role="search-result-kind">
                    {meta.emoji} {meta.label}
                  </span>
                  {h.doc.k === 'problem' && h.doc.n === 1 && (
                    <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--fg-ok)', color: 'var(--fg-ok)' }}>已实机验证</span>
                  )}
                  <span className="truncate">{h.doc.s}</span>
                </div>
                <div className="mt-1 font-medium" data-role="search-result-title">
                  <Mark text={h.doc.t} tokens={result.tokens} />
                </div>
                {SHOW_ID.has(h.doc.k) && (
                  <div className="mt-0.5 font-mono text-xs" style={muted} data-role="search-result-id">
                    <Mark text={h.doc.id} tokens={result.tokens} />
                  </div>
                )}
                {h.snippet && (
                  <div className="mt-1 text-xs" style={muted} data-role="search-result-snippet">
                    <Mark text={h.snippet} tokens={result.tokens} />
                  </div>
                )}
              </Link>
            </li>
          )
        })}
        {shown < result.matchedFiltered && (
          <li className="pt-1 text-xs" style={muted} data-role="search-truncated">
            共命中 {result.matchedFiltered} 条，只显示最相关的前 {shown} 条 —— 加一个词或在上面选类别可以缩小范围。
          </li>
        )}
      </ol>
    )
  }

  return (
    <div className="space-y-4" data-role="search-page">
      <header>
        <h1 className="m-0 text-2xl font-semibold">🔍 全站搜索</h1>
        <p className="m-0 mt-1 text-sm" style={muted}>
          题目、知识卡片、2D / 3D 演示、错误展品、速查手册、站内页面，一处搜全部。
        </p>
      </header>

      <form
        role="search"
        data-role="search-form"
        className="sticky top-32 z-[5] rounded-xl border p-3"
        style={panel}
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="search-q" className="sr-only">搜索关键词</label>
        <input
          id="search-q"
          ref={inputRef}
          type="search"
          value={q}
          maxLength={80}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入关键词，例如：printf、指针、递归、链表 插入、c-ch03-pg-001"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)', ['--tw-ring-color' as string]: 'var(--fg-link)' }}
          data-role="search-input"
          aria-describedby="search-hint"
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={muted} id="search-hint">
          <span data-role="search-count" aria-live="polite">
            {hasQuery
              ? `命中 ${result?.matchedFiltered ?? 0} 条${
                  kinds && result && result.matchedFiltered < result.matched
                    ? `（全部类别共 ${result.matched} 条）`
                    : ''
                }${result && result.hits.length < result.matchedFiltered ? `，显示前 ${result.hits.length} 条` : ''}`
              : `语料 ${totals.all ?? 0} 条，输入即搜`}
          </span>
          {q && (
            <button
              type="button"
              data-role="search-clear"
              onClick={() => setQuery('')}
              className="rounded-md border px-2 py-1"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg-muted)' }}
            >
              清空
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1" data-role="search-kinds" role="group" aria-label="按类别过滤">
          {chips.map((c) => {
            const active = c.key === 'all' ? !kinds : !!kinds?.has(c.key)
            // 0 命中的类别不隐藏：留着并禁用，学生才知道「这个词在这一类里真的一条都没有」
            return (
              <button
                key={c.key}
                type="button"
                data-role="search-kind"
                data-kind={c.key}
                aria-pressed={active}
                disabled={hasQuery && c.key !== 'all' && c.count === 0}
                onClick={() => (c.key === 'all'
                  ? setParams((() => { const p = new URLSearchParams(params); p.delete('kind'); return p })(), { replace: true })
                  : toggleKind(c.key as SearchKind))}
                className="rounded-full border px-2.5 py-1 text-xs disabled:opacity-45"
                style={{
                  borderColor: active ? 'var(--fg-link)' : 'var(--border)',
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--fg-link)' : 'var(--fg-muted)',
                }}
              >
                {c.label} ({c.count})
              </button>
            )
          })}
        </div>
      </form>

      {body}

      <p className="m-0 text-xs" style={muted}>
        搜索完全在浏览器本地进行：语料是构建期从题目 / 卡片 / 演示索引现算生成的一份 JSON，
        不依赖任何服务端，也不上传你的输入。
      </p>
    </div>
  )
}
