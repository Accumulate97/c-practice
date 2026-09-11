/**
 * 知识卡片列表页（阶段 10-1）：/#/knowledge。
 *
 * 取代阶段 1 遗留的 SectionPage 占位。数据只 fetch 一个索引（knowledge/index.json），
 * 一个分片都不碰；正文留给详情页按需加载。
 *
 * 通用化硬要求落地方式：
 *   · 章节分组从索引动态算（groupByChapter），不写死「12 章 + 8 章」——新增分片重跑 build:index 即出现
 *   · 卡片总数、每章张数、关联演示/题目数一律来自索引字段，页面上没有一个硬编码数量
 *   · relatedViz / relatedProblems 缺失或为空数组时只显示「暂无关联」，不报错、不白屏
 *   · 数百张卡片用分页（默认 50/页），不做一次性渲染
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  categoryLabel,
  chapterKey,
  groupByChapter,
  loadKnowledgeIndex,
  type KnowledgeIndex,
  type KnowledgeIndexEntry,
} from '../modules/knowledge/data/loader'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const control: CSSProperties = {
  borderColor: 'var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
}
const chip: CSSProperties = { borderColor: 'var(--border)', color: 'var(--fg-muted)' }

const PAGE_SIZES = [20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 50

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; index: KnowledgeIndex }

export function KnowledgeListPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadKnowledgeIndex().then(
      (index) => {
        if (alive) setPhase({ kind: 'ready', index })
      },
      (error: unknown) => {
        if (alive) setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [reloadKey])

  if (phase.kind === 'loading') {
    return (
      <div data-role="skeleton" className="space-y-3" aria-busy="true" aria-label="知识卡片索引加载中">
        <p className="text-sm" style={muted}>正在加载知识卡片索引…</p>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-16 rounded-xl border" style={{ ...panel, opacity: 0.6 }} />
        ))}
      </div>
    )
  }

  if (phase.kind === 'error') {
    return (
      <section className="rounded-xl border p-6" style={panel} data-role="load-error">
        <p className="text-sm font-semibold">知识卡片索引加载失败</p>
        <p className="mt-1 text-sm" style={muted}>{phase.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-3 rounded-md border px-3 py-1.5 text-sm"
          style={control}
        >
          重试
        </button>
      </section>
    )
  }

  return <Ready index={phase.index} />
}

function Ready({ index }: { index: KnowledgeIndex }) {
  const [params, setParams] = useSearchParams()

  const cat = params.get('cat') ?? ''
  const chapter = params.get('chapter') ?? ''
  const query = params.get('q') ?? ''
  const link = params.get('link') ?? ''
  const sizeParam = Number(params.get('size') ?? DEFAULT_PAGE_SIZE)
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE
  const pageParam = Number(params.get('page') ?? 1)

  const patch = useCallback(
    (changes: Record<string, string>, resetPage = true) => {
      const next = new URLSearchParams(params)
      for (const [key, value] of Object.entries(changes)) {
        if (value.length === 0) next.delete(key)
        else next.set(key, value)
      }
      if (resetPage && !('page' in changes)) next.delete('page')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const clearFilters = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams])

  /** 章节分组：索引出现顺序（build-index 按文件名排序 → c-ch01..c-ch12、ds-ch01..ds-ch08） */
  const groups = useMemo(() => groupByChapter(index), [index])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of index.cards) counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
    return [...counts.entries()].map(([key, count]) => ({ key, count }))
  }, [index])

  /** 章节下拉里只列当前 category 下的章，避免 c/ds 两套「第6章」混在一个列表里 */
  const chapterOptions = useMemo(
    () => groups.filter((g) => cat.length === 0 || g.category === cat),
    [groups, cat],
  )

  const stats = useMemo(() => {
    let withViz = 0
    let withProblems = 0
    for (const c of index.cards) {
      if (c.relatedViz.length > 0) withViz += 1
      if (c.relatedProblems.length > 0) withProblems += 1
    }
    return { withViz, withProblems }
  }, [index])

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    const out: KnowledgeIndexEntry[] = []
    for (const g of groups) {
      if (cat.length > 0 && g.category !== cat) continue
      if (chapter.length > 0 && g.key !== chapter) continue
      for (const c of g.items) {
        if (link === 'viz' && c.relatedViz.length === 0) continue
        if (link === 'prob' && c.relatedProblems.length === 0) continue
        if (needle.length > 0 && !matches(c, needle)) continue
        out.push(c)
      }
    }
    return out
  }, [groups, cat, chapter, link, needle])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Number.isFinite(pageParam) ? Math.min(Math.max(1, Math.trunc(pageParam)), pageCount) : 1
  const rows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])
  const from = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1
  const to = (page - 1) * pageSize + rows.length
  const activeFilterCount = [cat, chapter, query, link].filter((v) => v.trim().length > 0).length
  const chapterName = groups.find((g) => g.key === chapter)?.chapter ?? ''

  return (
    <div className="space-y-4" data-role="knowledge-list">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">📖 知识点汇总</h1>
        <p className="text-sm" style={muted}>
          按「节」粒度的知识卡片。每张卡片向下连着可视化演示与题目 —— 学完就地看懂、看懂就地练。
        </p>
      </header>

      <section className="space-y-3 rounded-xl border p-4" style={panel}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[14rem] flex-1 text-xs" style={muted}>
            <span className="mb-1 block">搜索</span>
            <input
              type="search"
              value={query}
              onChange={(e) => patch({ q: e.target.value })}
              placeholder="标题 / 要点 / 小节 / 卡片 id…"
              aria-label="搜索知识卡片"
              data-role="search-input"
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            />
          </label>

          <label className="text-xs" style={muted}>
            <span className="mb-1 block">课程</span>
            <select
              aria-label="按课程筛选"
              value={cat}
              onChange={(e) => patch({ cat: e.target.value, chapter: '' })}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            >
              <option value="">全部课程（{index.count}）</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {categoryLabel(c.key)}（{c.count}）
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-[16rem] text-xs" style={muted}>
            <span className="mb-1 block">章节</span>
            <select
              aria-label="按章节筛选"
              value={chapter}
              onChange={(e) => patch({ chapter: e.target.value })}
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            >
              <option value="">全部章节（{groups.length} 章）</option>
              {chapterOptions.map((g) => (
                <option key={g.key} value={g.key}>
                  {categoryLabel(g.category)} · {g.chapter}（{g.items.length}）
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs" style={muted}>
            <span className="mb-1 block">每页</span>
            <select
              aria-label="每页张数"
              value={String(pageSize)}
              onChange={(e) => patch({ size: e.target.value })}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={String(n)}>
                  {n} 张
                </option>
              ))}
            </select>
          </label>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              data-role="clear-filters"
              className="ml-auto rounded-lg border px-3 py-1.5 text-xs"
              style={control}
            >
              清空 {activeFilterCount} 项筛选
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <LinkChip active={link === ''} onClick={() => patch({ link: '' })} label="全部卡片" count={index.count} />
          <LinkChip
            active={link === 'viz'}
            onClick={() => patch({ link: link === 'viz' ? '' : 'viz' })}
            label="🎬 有演示"
            count={stats.withViz}
            title="relatedViz 非空的卡片：点进去可以单步看算法执行"
          />
          <LinkChip
            active={link === 'prob'}
            onClick={() => patch({ link: link === 'prob' ? '' : 'prob' })}
            label="✍️ 有题目"
            count={stats.withProblems}
            title="relatedProblems 非空的卡片：点进去可以直接练对应题目"
          />
        </div>
      </section>

      <p
        data-role="summary"
        data-total={index.count}
        data-filtered={filtered.length}
        data-rows={rows.length}
        data-page={page}
        data-page-count={pageCount}
        className="text-xs"
        style={muted}
      >
        共 <b style={{ color: 'var(--fg)' }}>{index.count}</b> 张卡片 /{' '}
        <b style={{ color: 'var(--fg)' }}>{groups.length}</b> 章（本页只加载索引）
        {' · '}筛出 <b data-role="filtered-count" style={{ color: 'var(--fg)' }}>{filtered.length}</b> 张
        {filtered.length > 0 && <> · 显示第 {from}–{to} 张 · 第 {page}/{pageCount} 页</>}
        {chapterName.length > 0 && <> · 章节：{chapterName}</>}
      </p>

      {filtered.length === 0 ? (
        <section data-role="empty" className="rounded-xl border p-10 text-center" style={panel}>
          <p className="text-base font-semibold">没有匹配的知识卡片</p>
          <p className="mt-2 text-sm" style={muted}>
            {query.trim().length > 0 ? `关键词「${query.trim()}」在当前筛选范围内没有命中。` : '当前筛选范围内没有卡片。'}
            换个关键词，或清空筛选看全部 {index.count} 张。
          </p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 rounded-lg border px-3 py-1.5 text-sm"
              style={control}
            >
              清空筛选
            </button>
          )}
        </section>
      ) : (
        <div className="space-y-2">
          {rows.map((card, i) => {
            const prev = rows[i - 1]
            const showHeader = prev === undefined || chapterKey(prev.category, prev.chapter) !== chapterKey(card.category, card.chapter)
            return (
              <div key={card.id}>
                {showHeader && (
                  <h2 className="mb-1 mt-3 text-sm font-semibold" style={muted} data-role="group-header">
                    {categoryLabel(card.category)} · {card.chapter || '未分章'}
                  </h2>
                )}
                <CardRow card={card} />
              </div>
            )
          })}
        </div>
      )}

      {pageCount > 1 && (
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="分页">
          <PageButton label="上一页" disabled={page <= 1} onClick={() => patch({ page: String(page - 1) }, false)} />
          {pageWindow(page, pageCount).map((p, i) =>
            p === null ? (
              <span key={'gap' + i} className="px-1" style={muted}>
                …
              </span>
            ) : (
              <PageButton
                key={p}
                label={String(p)}
                active={p === page}
                onClick={() => patch({ page: String(p) }, false)}
                dataPage={p}
              />
            ),
          )}
          <PageButton
            label="下一页"
            disabled={page >= pageCount}
            onClick={() => patch({ page: String(page + 1) }, false)}
          />
        </nav>
      )}
    </div>
  )
}

function CardRow({ card }: { card: KnowledgeIndexEntry }) {
  const point = card.keyPoints[0] ?? card.summary
  return (
    <article
      data-role="row"
      data-id={card.id}
      data-viz={card.relatedViz.length}
      data-problems={card.relatedProblems.length}
      className="rounded-xl border p-3 transition hover:border-[var(--color-brand)]"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link
          to={'/knowledge/' + card.id}
          data-role="card-title"
          className="text-sm font-semibold hover:underline"
          style={{ color: 'var(--fg)' }}
        >
          {card.title}
        </Link>
        <span className="font-mono text-[11px]" style={muted}>
          {card.id}
        </span>
        <span className="ml-auto flex shrink-0 gap-1 text-[11px]">
          <Badge on={card.relatedViz.length > 0} label={`🎬 ${card.relatedViz.length}`} title="关联的可视化演示数" />
          <Badge
            on={card.relatedProblems.length > 0}
            label={`✍️ ${card.relatedProblems.length}`}
            title="关联的题目数"
          />
        </span>
      </div>
      {card.section.length > 0 && (
        <p className="mt-0.5 text-[11px]" style={muted}>
          {card.section}
        </p>
      )}
      {point.length > 0 && (
        <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {point}
        </p>
      )}
    </article>
  )
}

function Badge({ on, label, title }: { on: boolean; label: string; title: string }) {
  return (
    <span
      title={title}
      className="rounded border px-1.5 py-0.5"
      style={on ? { borderColor: 'var(--color-brand)', color: 'var(--color-brand)' } : { ...chip, opacity: 0.55 }}
    >
      {label}
    </span>
  )
}

function LinkChip({
  active,
  onClick,
  label,
  count,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="rounded-full border px-2.5 py-1 text-xs"
      style={
        active
          ? { borderColor: 'var(--color-brand)', background: 'var(--color-brand)', color: '#fff' }
          : { ...control }
      }
    >
      {label} <span style={{ opacity: 0.75 }}>{count}</span>
    </button>
  )
}

function PageButton({
  label,
  onClick,
  active = false,
  disabled = false,
  dataPage,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  dataPage?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      data-page-button={dataPage}
      className="rounded-md border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
      style={active ? { borderColor: 'var(--color-brand)', color: 'var(--color-brand)' } : { ...control }}
    >
      {label}
    </button>
  )
}

/** 页码窗口：首页、末页、当前页 ±2，其余用省略号。500+ 卡片时不会铺满屏幕 */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const out: (number | null)[] = []
  const push = (p: number | null): void => {
    if (out.length > 0 && out[out.length - 1] === null && p === null) return
    out.push(p)
  }
  for (let p = 1; p <= pageCount; p += 1) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 2) push(p)
    else push(null)
  }
  return out.filter((v, i) => !(v === null && (i === 0 || i === out.length - 1)))
}

/** 搜索口径：标题 / 小节 / 摘要 / 要点 / id，全部小写子串匹配（不引第三方分词，中文按字面匹配最稳） */
function matches(card: KnowledgeIndexEntry, needle: string): boolean {
  if (card.title.toLowerCase().includes(needle)) return true
  if (card.id.toLowerCase().includes(needle)) return true
  if (card.section.toLowerCase().includes(needle)) return true
  if (card.summary.toLowerCase().includes(needle)) return true
  return card.keyPoints.some((p) => p.toLowerCase().includes(needle))
}
