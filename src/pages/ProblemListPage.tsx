/**
 * 题目列表页（阶段 4 模块 5）：刷题入口 /#/problems。
 *
 * 三条硬约束在本页的落点：
 *   · 纯静态无后端 —— 数据只来自 public/data/problems/index.json，进度只来自 localStorage
 *   · 索引懒加载 —— 本页**只 fetch 索引**（518 条 / 190 KB），一个分片都不碰；
 *     分片留给详情页 loader.loadShard() 按需取（loader 内部已做单飞 + 失败可重试）
 *   · 518 条不一次性渲染 —— 分页，默认 50 条/页，最多 100
 *
 * 状态标记口径（本轮只做轻量展示；错题本 / 统计 / 导出 / 导入属阶段 5，一概不做）：
 *   已通过      = 曾经有过一次全绿判分（everPassed，重做失败不回退）
 *   尝试过未通过 = 提交过并拿到确证的失败结论
 *   未做        = localStorage 里没有记录（后端抖动的「未判定」不写记录，见 progress/store.ts）
 *
 * 筛选条件全部写进 URL query（replace，不堆历史栈），因此可分享、可刷新、可被验收脚本直接驱动。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadIndex } from '../modules/problems/data/loader'
import type { ProblemIndex, ProblemIndexEntry } from '../modules/problems/data/loader'
import { statusOf, useProgress } from '../modules/problems/progress/store'
import type { ListStatus } from '../modules/problems/progress/store'
import { RENDERABLE_TYPES, difficultyStars, shardKey, shortId, typeLabel } from '../modules/problems/type-meta'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const control: CSSProperties = {
  borderColor: 'var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
}

const PAGE_SIZES = [20, 50, 100]
const DEFAULT_PAGE_SIZE = 50
const DIFFICULTIES = [1, 2, 3, 4, 5]

/** 筛选面板的题型顺序：任务书第三节的主力四型在前，辅助题型在后（表外类型按题量追加） */
const TYPE_ORDER = [
  'code_completion',
  'debug',
  'code_reading',
  'programming',
  'single_choice',
  'fill_blank',
  'short_answer',
  'true_false',
  'code_ordering',
  'complexity',
  'matching',
]

type SortKey = 'default' | 'index' | 'diff-asc' | 'diff-desc'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '章节 + 题号（默认）' },
  { key: 'index', label: '题库原序（按小节）' },
  { key: 'diff-asc', label: '难度 ↑' },
  { key: 'diff-desc', label: '难度 ↓' },
]

const STATUS_META: Record<ListStatus, { label: string; short: string; color: string; dot: string }> = {
  todo: { label: '未做', short: '未做', color: 'var(--fg-muted)', dot: '○' },
  attempted: { label: '尝试过未通过', short: '尝试过', color: 'var(--color-viz-compare)', dot: '◐' },
  passed: { label: '已通过', short: '已通过', color: 'var(--color-viz-sorted)', dot: '●' },
}
const STATUS_ORDER: ListStatus[] = ['todo', 'attempted', 'passed']

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; index: ProblemIndex }

export function ProblemListPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadIndex().then(
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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">✍️ 在线刷题</h1>
        <p className="mt-1 text-sm" style={muted}>
          章节 / 题型 / 难度 / 做题状态四维筛选，条件写在地址栏里可分享；点题目进详情页作答。
        </p>
      </header>

      {phase.kind === 'loading' && <ListSkeleton />}

      {phase.kind === 'error' && (
        <section className="rounded-xl border p-6" style={panel}>
          <p className="text-sm font-semibold">题库索引加载失败</p>
          <p className="mt-2 text-sm" style={muted}>{phase.message}</p>
          <p className="mt-2 text-xs" style={muted}>
            本页只读 data/problems/index.json（不读分片）。若确认文件存在仍失败，跑 npm run build:index 重建索引。
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-lg border px-3 py-2 text-sm"
            style={control}
          >
            重试
          </button>
        </section>
      )}

      {phase.kind === 'ready' && <Ready index={phase.index} />}
    </div>
  )
}

/** 索引 190 KB，本地毫秒级、线上也就一个 RTT：骨架屏给形状，不做假数据 */
function ListSkeleton() {
  return (
    <div data-role="skeleton" className="space-y-3" aria-busy="true" aria-label="题库索引加载中">
      <div className="h-24 animate-pulse rounded-xl border" style={{ ...panel, background: 'var(--bg-elev)' }} />
      <div className="overflow-hidden rounded-xl border" style={panel}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-t px-3 py-3 first:border-t-0" style={{ borderColor: 'var(--border)' }}>
            <div className="h-3 w-16 animate-pulse rounded" style={{ background: 'var(--border)' }} />
            <div className="h-3 w-40 animate-pulse rounded" style={{ background: 'var(--border)' }} />
            <div className="h-3 flex-1 animate-pulse rounded" style={{ background: 'var(--border)' }} />
            <div className="h-3 w-16 animate-pulse rounded" style={{ background: 'var(--border)' }} />
          </div>
        ))}
      </div>
      <p className="text-xs" style={muted}>正在加载题库索引（只加载索引，分片等你点开某道题时才取）…</p>
    </div>
  )
}

function Ready({ index }: { index: ProblemIndex }) {
  const [params, setParams] = useSearchParams()
  const records = useProgress((s) => s.records)

  const chapter = params.get('chapter') ?? ''
  const type = params.get('type') ?? ''
  const difficulty = params.get('difficulty') ?? ''
  const status = params.get('status') ?? ''
  const sortParam = params.get('sort') ?? 'default'
  const sortKey: SortKey = SORTS.some((s) => s.key === sortParam) ? (sortParam as SortKey) : 'default'
  const sizeParam = Number(params.get('size') ?? DEFAULT_PAGE_SIZE)
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE
  const pageParam = Number(params.get('page') ?? 1)

  /** 改筛选：写 URL（replace，不堆历史栈），除翻页外一律把页码复位到第 1 页 */
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

  /** 章节列表直接取索引的 shards：名字与题量都是构建期算好的，不在前端二次统计 */
  const chapters = useMemo(
    () => index.shards.map((s) => ({ key: shardKey(s.file), name: s.chapter, count: s.count })),
    [index],
  )

  const types = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of index.problems) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
    const known = TYPE_ORDER.filter((t) => counts.has(t))
    const extra = [...counts.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    return [...known, ...extra].map((t) => ({ key: t, label: typeLabel(t), count: counts.get(t) ?? 0 }))
  }, [index])

  const difficultyCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const p of index.problems) counts.set(p.difficulty, (counts.get(p.difficulty) ?? 0) + 1)
    return counts
  }, [index])

  /** 章节 + 题型 + 难度三维先过一遍；状态维单独过，好让状态 chips 显示「当前范围内的」计数 */
  const narrowed = useMemo(
    () =>
      index.problems.filter(
        (p) =>
          (chapter.length === 0 || shardKey(p.file) === chapter) &&
          (type.length === 0 || p.type === type) &&
          (difficulty.length === 0 || String(p.difficulty) === difficulty),
      ),
    [index, chapter, type, difficulty],
  )

  const statusCounts = useMemo(() => {
    const counts: Record<ListStatus, number> = { todo: 0, attempted: 0, passed: 0 }
    for (const p of narrowed) counts[statusOf(records[p.id])] += 1
    return counts
  }, [narrowed, records])

  const filtered = useMemo(
    () => (STATUS_ORDER.includes(status as ListStatus) ? narrowed.filter((p) => statusOf(records[p.id]) === status) : narrowed),
    [narrowed, records, status],
  )

  const chapterOrder = useMemo(() => new Map(chapters.map((c, i) => [c.key, i] as const)), [chapters])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortKey === 'diff-asc') arr.sort((a, b) => a.difficulty - b.difficulty)
    else if (sortKey === 'diff-desc') arr.sort((a, b) => b.difficulty - a.difficulty)
    else if (sortKey === 'default') {
      // 章节按 shards 顺序、章内按 id 升序（id 末段是零填充序号，字符串序即题号序）
      arr.sort((a, b) => {
        const byChapter = (chapterOrder.get(shardKey(a.file)) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(shardKey(b.file)) ?? Number.MAX_SAFE_INTEGER)
        if (byChapter !== 0) return byChapter
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
    }
    return arr // 'index' = 索引原序（构建期的小节顺序），不再动
  }, [filtered, sortKey, chapterOrder])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page = Number.isFinite(pageParam) ? Math.min(Math.max(1, Math.trunc(pageParam)), pageCount) : 1
  const rows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize])
  const from = sorted.length === 0 ? 0 : (page - 1) * pageSize + 1
  const to = (page - 1) * pageSize + rows.length

  const activeFilterCount = [chapter, type, difficulty, status].filter((v) => v.length > 0).length
  const chapterName = chapters.find((c) => c.key === chapter)?.name ?? ''

  return (
    <>
      <section className="space-y-3 rounded-xl border p-4" style={panel}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs" style={muted}>
            <span className="mb-1 block">章节</span>
            <select
              aria-label="章节"
              value={chapter}
              onChange={(e) => patch({ chapter: e.target.value })}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            >
              <option value="">全部章节（{index.count}）</option>
              {chapters.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}（{c.count}）
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs" style={muted}>
            <span className="mb-1 block">排序</span>
            <select
              aria-label="排序"
              value={sortKey}
              onChange={(e) => patch({ sort: e.target.value }, false)}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs" style={muted}>
            <span className="mb-1 block">每页</span>
            <select
              aria-label="每页条数"
              value={String(pageSize)}
              onChange={(e) => patch({ size: e.target.value })}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={control}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={String(n)}>
                  {n} 条
                </option>
              ))}
            </select>
          </label>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto rounded-lg border px-3 py-1.5 text-xs"
              style={control}
            >
              清空 {activeFilterCount} 项筛选
            </button>
          )}
        </div>

        <FilterRow label="题型">
          {types.map((t) => (
            <FilterChip
              key={t.key}
              active={type === t.key}
              disabled={t.count === 0}
              onClick={() => patch({ type: type === t.key ? '' : t.key })}
              label={RENDERABLE_TYPES.has(t.key) ? t.label : `${t.label}（待阶段 5）`}
              count={t.count}
              dataType={t.key}
              title={RENDERABLE_TYPES.has(t.key) ? `${t.label}：${t.count} 题` : `${t.label}：${t.count} 题，渲染器属阶段 5，详情页暂为占位`}
            />
          ))}
        </FilterRow>

        <FilterRow label="难度">
          {DIFFICULTIES.map((d) => (
            <FilterChip
              key={d}
              active={difficulty === String(d)}
              disabled={(difficultyCounts.get(d) ?? 0) === 0}
              onClick={() => patch({ difficulty: difficulty === String(d) ? '' : String(d) })}
              label={`${d} ${difficultyStars(d)}`}
              count={difficultyCounts.get(d) ?? 0}
              dataDifficulty={String(d)}
            />
          ))}
        </FilterRow>

        <FilterRow label="状态">
          {STATUS_ORDER.map((s) => (
            <FilterChip
              key={s}
              active={status === s}
              onClick={() => patch({ status: status === s ? '' : s })}
              label={`${STATUS_META[s].dot} ${STATUS_META[s].label}`}
              count={statusCounts[s]}
              dataStatus={s}
              title={
                s === 'todo'
                  ? '本机 localStorage 里没有这道题的判分记录'
                  : s === 'attempted'
                    ? '提交过并拿到确证失败结论（后端抖动的「未判定」不计）'
                    : '曾经有过一次全绿判分；重做失败不回退'
              }
            />
          ))}
        </FilterRow>
      </section>

      <p
        data-role="summary"
        data-total={index.count}
        data-filtered={sorted.length}
        data-rows={rows.length}
        data-page={page}
        data-page-count={pageCount}
        className="text-xs"
        style={muted}
      >
        题库共 <b style={{ color: 'var(--fg)' }}>{index.count}</b> 题（{index.shard_count} 个分片，本页只加载索引）
        {' · '}筛出 <b data-role="filtered-count" style={{ color: 'var(--fg)' }}>{sorted.length}</b> 题
        {sorted.length > 0 && <> · 显示第 {from}–{to} 条 · 第 {page}/{pageCount} 页</>}
        {chapterName.length > 0 && <> · 章节：{chapterName}</>}
      </p>

      {sorted.length === 0 ? (
        <section data-role="empty" className="rounded-xl border p-10 text-center" style={panel}>
          <p className="text-base font-semibold">无匹配题目</p>
          <p className="mt-2 text-sm" style={muted}>
            当前筛选条件（{[
              chapterName.length > 0 ? chapterName : null,
              type.length > 0 ? typeLabel(type) : null,
              difficulty.length > 0 ? `难度 ${difficulty}` : null,
              STATUS_ORDER.includes(status as ListStatus) ? `只看${STATUS_META[status as ListStatus].label}` : null,
            ]
              .filter((s): s is string => s !== null)
              .join(' + ') || '无'}）下题库里 0 题。
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 rounded-lg border px-3 py-2 text-sm"
            style={control}
          >
            清空全部筛选
          </button>
        </section>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={panel}>
            <table className="w-full min-w-[58rem] border-collapse text-sm" data-role="problem-table">
              <thead>
                <tr className="text-xs" style={muted}>
                  <th className="px-3 py-2 text-left font-medium">题号</th>
                  <th className="px-3 py-2 text-left font-medium">章节</th>
                  <th className="px-3 py-2 text-left font-medium">题型</th>
                  <th className="px-3 py-2 text-left font-medium">难度</th>
                  <th className="px-3 py-2 text-left font-medium">题干摘要</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <ProblemRow key={p.id} problem={p} status={statusOf(records[p.id])} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="分页">
              <PageButton label="上一页" disabled={page <= 1} onClick={() => patch({ page: String(page - 1) }, false)} />
              {pageWindow(page, pageCount).map((item, i) =>
                item === null ? (
                  <span key={`gap-${i}`} className="px-1" style={muted}>
                    …
                  </span>
                ) : (
                  <PageButton
                    key={item}
                    label={String(item)}
                    active={item === page}
                    dataPage={item}
                    onClick={() => patch({ page: String(item) }, false)}
                  />
                ),
              )}
              <PageButton label="下一页" disabled={page >= pageCount} onClick={() => patch({ page: String(page + 1) }, false)} />
            </nav>
          )}
        </>
      )}
    </>
  )
}

function ProblemRow({ problem, status }: { problem: ProblemIndexEntry; status: ListStatus }) {
  const meta = STATUS_META[status]
  const renderable = RENDERABLE_TYPES.has(problem.type)
  const to = `/problems/p/${problem.id}`
  return (
    <tr
      data-role="row"
      data-id={problem.id}
      data-type={problem.type}
      data-chapter={shardKey(problem.file)}
      data-difficulty={problem.difficulty}
      data-status={status}
      className="border-t align-middle"
      style={{ borderColor: 'var(--border)' }}
    >
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        <Link to={to} title={problem.id} className="font-mono hover:underline" style={{ color: 'var(--color-brand)' }}>
          {shortId(problem.id)}
        </Link>
      </td>
      <td className="px-3 py-2">
        <span className="block max-w-[13rem] truncate text-xs" style={muted} title={problem.chapter}>
          {problem.chapter}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        <span
          className="rounded-full border px-2 py-0.5"
          style={{ borderColor: 'var(--border)', color: renderable ? 'var(--fg)' : 'var(--fg-muted)' }}
          title={renderable ? `${typeLabel(problem.type)}：可在线判分` : `${typeLabel(problem.type)}：渲染器属阶段 5，详情页暂为占位`}
        >
          {typeLabel(problem.type)}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--color-viz-compare)' }} title={`难度 ${problem.difficulty} / 5`}>
        {difficultyStars(problem.difficulty)}
      </td>
      <td className="px-3 py-2">
        <Link to={to} className="block max-w-[32rem] truncate hover:underline" style={{ color: 'var(--fg)' }} title={problem.title || problem.id}>
          {problem.title.length > 0 ? problem.title : '（索引里没有题干摘要）'}
        </Link>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        <span data-role="status" style={{ color: meta.color }}>
          {meta.dot} {meta.label}
        </span>
      </td>
    </tr>
  )
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-8 shrink-0 text-xs" style={muted}>
        {label}
      </span>
      {children}
    </div>
  )
}

interface ChipProps {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  disabled?: boolean
  title?: string
  dataType?: string
  dataDifficulty?: string
  dataStatus?: string
}

function FilterChip({ active, onClick, label, count, disabled = false, title, dataType, dataDifficulty, dataStatus }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-type={dataType}
      data-difficulty={dataDifficulty}
      data-status-filter={dataStatus}
      aria-pressed={active}
      className="rounded-full border px-2.5 py-1 text-xs transition"
      style={{
        borderColor: active ? 'var(--color-brand)' : 'var(--border)',
        background: active ? 'var(--code-selection)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
      {typeof count === 'number' && <span className="ml-1" style={muted}>{count}</span>}
    </button>
  )
}

interface PageButtonProps {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  dataPage?: number
}

function PageButton({ label, onClick, active = false, disabled = false, dataPage }: PageButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-page={dataPage}
      aria-current={active ? 'page' : undefined}
      className="rounded-md border px-2.5 py-1 text-xs"
      style={{
        ...control,
        borderColor: active ? 'var(--color-brand)' : 'var(--border)',
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

/** 页码窗口：首尾恒在，当前页左右各 2，中间用 null 表示省略号 */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 9) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const out = new Set<number>([1, pageCount, page, page - 1, page + 1, page - 2, page + 2])
  const nums = [...out].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b)
  const result: (number | null)[] = []
  let prev = 0
  for (const n of nums) {
    if (n - prev > 1) result.push(null)
    result.push(n)
    prev = n
  }
  return result
}
