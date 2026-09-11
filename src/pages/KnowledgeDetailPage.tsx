/**
 * 知识卡片详情页（阶段 10-1）：/#/knowledge/{id}。
 *
 * 数据流与题目详情页同构：index.json 定位分片 file → 取分片 → 取单卡片。
 * 页面不认识任何具体章节或卡片 id，新增卡片/分片不需要改这个文件。
 *
 * 三向联动在这里闭环：
 *   relatedViz → /#/viz/{demoId}（看它怎么工作）
 *   relatedProblems → /#/problems/p/{id}（练它）
 *   relatedKnowledge → /#/knowledge/{id}（横向补概念）
 * 三个字段缺失或为空时各自显示空状态，不报错、不白屏。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CodeBlock } from '../components/common/CodeBlock'
import { Markdown } from '../components/common/Markdown'
import {
  KnowledgeNotFound,
  categoryLabel,
  chapterKey,
  loadCard,
  loadKnowledgeIndex,
  type LoadedCard,
} from '../modules/knowledge/data/loader'
import { RelLinks, useCardItems, useProblemItems, useVizItems } from '../modules/knowledge/links'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const chip: CSSProperties = { borderColor: 'var(--border)', color: 'var(--fg-muted)' }

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing'; id: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LoadedCard }

export function KnowledgeDetailPage() {
  const { id = '' } = useParams<{ id?: string }>()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadCard(id).then(
      (data) => {
        if (alive) setPhase({ kind: 'ready', data })
      },
      (error: unknown) => {
        if (!alive) return
        if (error instanceof KnowledgeNotFound) setPhase({ kind: 'missing', id })
        else setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  if (phase.kind === 'loading') {
    return <p className="text-sm" style={muted}>正在从知识库分片加载 {id} …</p>
  }

  if (phase.kind === 'missing') {
    return (
      <section className="rounded-xl border p-6" style={{ ...panel, borderColor: 'var(--color-viz-swap)' }} data-role="notfound">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-viz-swap)' }}>找不到这张知识卡片</p>
        <p className="mt-2 text-sm" style={muted}>知识卡片索引里没有 {phase.id}，可能链接打错了，或这张卡片还没写。</p>
        <Link to="/knowledge" className="mt-3 inline-block text-sm underline">← 返回知识点汇总</Link>
      </section>
    )
  }

  if (phase.kind === 'error') {
    return (
      <section className="rounded-xl border p-6" style={panel} data-role="load-error">
        <p className="text-sm font-semibold">知识卡片加载失败</p>
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
          <Link to="/knowledge" className="rounded-md border px-3 py-1.5 text-sm" style={chip}>← 返回列表</Link>
        </div>
      </section>
    )
  }

  return <Ready data={phase.data} />
}

function Ready({ data }: { data: LoadedCard }) {
  const { entry, card } = data
  const keyPoints = strArray(card.keyPoints)
  const pitfalls = strArray(card.pitfalls)
  const examples = Array.isArray(card.examples) ? card.examples : []

  const viz = useVizItems(strArray(card.relatedViz))
  const problems = useProblemItems(strArray(card.relatedProblems))
  const related = useCardItems(strArray(card.relatedKnowledge))

  return (
    <div className="space-y-4" data-role="knowledge-detail" data-id={entry.id}>
      <nav className="text-xs" style={muted} aria-label="面包屑">
        <Link to="/knowledge" className="hover:underline">📖 知识点汇总</Link>
        <span className="px-1">/</span>
        <Link
          to={'/knowledge?chapter=' + encodeURIComponent(chapterKey(entry.category, entry.chapter))}
          className="hover:underline"
        >
          {entry.chapter || '未分章'}
        </Link>
        <span className="px-1">/</span>
        <span>{entry.id}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold" data-role="card-title">{card.title}</h1>
        <p className="flex flex-wrap gap-1 text-xs" style={muted}>
          <span className="rounded border px-1.5 py-0.5" style={chip}>{categoryLabel(entry.category)}</span>
          <span className="rounded border px-1.5 py-0.5" style={chip}>{entry.chapter}</span>
          {entry.section.length > 0 && <span className="rounded border px-1.5 py-0.5" style={chip}>{entry.section}</span>}
          <span className="rounded border px-1.5 py-0.5 font-mono" style={chip}>{entry.id}</span>
        </p>
        {typeof card.summary === 'string' && card.summary.trim().length > 0 && (
          <p className="text-sm leading-7" data-role="summary">{card.summary}</p>
        )}
      </header>

      {keyPoints.length > 0 && (
        <section className="rounded-xl border p-4" style={panel} data-role="keypoints">
          <p className="text-sm font-semibold">要点</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {keyPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {typeof card.content === 'string' && card.content.trim().length > 0 && (
        <section className="rounded-xl border p-4" style={panel} data-role="content">
          <Markdown source={card.content} />
        </section>
      )}

      <Tables tables={card.tables} />
      <Complexity value={card.complexity} />

      {examples.length > 0 && (
        <section className="space-y-3" data-role="examples">
          <h2 className="text-sm font-semibold">示例代码</h2>
          {examples.map((ex, i) => {
            const title = typeof ex?.title === 'string' ? ex.title : `示例 ${i + 1}`
            const code = typeof ex?.code === 'string' ? ex.code : ''
            const stdin = typeof ex?.stdin === 'string' ? ex.stdin : ''
            const expected = typeof ex?.expected === 'string' ? ex.expected : ''
            const note = typeof ex?.note === 'string' ? ex.note : ''
            return (
              <div key={title + i} className="space-y-2 rounded-xl border p-4" style={panel}>
                <p className="text-sm font-semibold">{title}</p>
                <CodeBlock code={code} lang="c" title={title} dataRole="example-code" />
                {stdin.trim().length > 0 && (
                  <p className="text-xs" style={muted}>
                    输入：<code className="font-mono">{stdin.replace(/\n/g, ' ⏎ ')}</code>
                  </p>
                )}
                {expected.trim().length > 0 && (
                  <p className="text-xs" style={muted}>
                    输出：<code className="font-mono">{expected.replace(/\n/g, ' ⏎ ')}</code>
                  </p>
                )}
                {note.trim().length > 0 && (
                  <p className="text-xs leading-6" style={muted}>{note}</p>
                )}
              </div>
            )
          })}
        </section>
      )}

      {pitfalls.length > 0 && (
        <section
          className="rounded-xl border p-4"
          style={{ ...panel, borderColor: 'var(--color-viz-compare)' }}
          data-role="pitfalls"
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--color-viz-compare)' }}>⚠️ 易错点</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {pitfalls.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border p-4" style={panel} data-role="three-way-links">
        <p className="text-sm font-semibold">🔗 三向联动</p>
        <p className="mt-1 text-xs" style={muted}>学 → 懂 → 练：先看演示弄懂执行过程，再做题检验，题目做错还能跳回卡片。</p>
        <div className="mt-3 space-y-3">
          <Block label="🎬 相关演示">
            <RelLinks items={viz.items} dataRole="related-viz" empty="这张卡片还没有关联演示。" />
          </Block>
          <Block label="✍️ 相关题目">
            <RelLinks items={problems.items} dataRole="related-problems" empty="这张卡片还没有关联题目。" />
          </Block>
          <Block label="📖 相关卡片">
            <RelLinks items={related.items} dataRole="related-knowledge" empty="这张卡片还没有关联其他卡片。" />
          </Block>
        </div>
      </section>

      <SiblingNav entry={entry} />
    </div>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs" style={muted}>{label}</p>
      {children}
    </div>
  )
}

/** 同章上一张 / 下一张：从索引按 file + order 现算，不写死任何卡片 id */
function SiblingNav({ entry }: { entry: LoadedCard['entry'] }) {
  const [siblings, setSiblings] = useState<{ id: string; title: string }[]>([])

  useEffect(() => {
    let alive = true
    loadKnowledgeIndex().then(
      (index) => {
        if (!alive) return
        const same = index.cards
          .filter((c) => c.file === entry.file)
          .sort((a, b) => (a.order - b.order !== 0 ? a.order - b.order : a.id < b.id ? -1 : 1))
        setSiblings(same.map((c) => ({ id: c.id, title: c.title })))
      },
      () => {
        /* 静默：上一张/下一张只是导航糖 */
      },
    )
    return () => {
      alive = false
    }
  }, [entry.file])

  const at = useMemo(() => siblings.findIndex((s) => s.id === entry.id), [siblings, entry.id])
  const prev = at > 0 ? siblings[at - 1] : undefined
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : undefined

  if (siblings.length === 0) return null
  return (
    <nav className="flex flex-wrap gap-2 text-sm" aria-label="同章卡片导航" data-role="sibling-nav">
      {prev ? (
        <Link to={'/knowledge/' + prev.id} data-role="prev-card" className="rounded-lg border px-3 py-1.5 hover:underline" style={chip}>
          ← {prev.title}
        </Link>
      ) : (
        <span className="rounded-lg border px-3 py-1.5 opacity-50" style={chip}>已是本章第一张</span>
      )}
      <Link
        to={'/knowledge?chapter=' + encodeURIComponent(chapterKey(entry.category, entry.chapter))}
        className="rounded-lg border px-3 py-1.5 hover:underline"
        style={chip}
      >
        本章全部 {siblings.length} 张
      </Link>
      {next ? (
        <Link to={'/knowledge/' + next.id} data-role="next-card" className="ml-auto rounded-lg border px-3 py-1.5 hover:underline" style={chip}>
          {next.title} →
        </Link>
      ) : (
        <span className="ml-auto rounded-lg border px-3 py-1.5 opacity-50" style={chip}>已是本章最后一张</span>
      )}
    </nav>
  )
}

/** schema 的 tables：[{caption, header[], rows[][]}]。语料里暂时没人用，但结构按 schema 实现，后续卡片直接可用 */
function Tables({ tables }: { tables: unknown }) {
  if (!Array.isArray(tables) || tables.length === 0) return null
  return (
    <section className="space-y-3" data-role="tables">
      {tables.map((t, i) => {
        const caption = typeof t?.caption === 'string' ? t.caption : ''
        const header = Array.isArray(t?.header) ? t.header.map(String) : []
        const rows: unknown[][] = Array.isArray(t?.rows)
          ? (t.rows as unknown[]).filter((r): r is unknown[] => Array.isArray(r))
          : []
        if (header.length === 0 && rows.length === 0) return null
        const cols = Math.max(header.length, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1)
        return (
          <div key={caption + i} className="overflow-x-auto rounded-xl border p-3" style={panel}>
            {caption.length > 0 && <p className="mb-2 text-sm font-semibold">{caption}</p>}
            <table className="w-full border-collapse text-xs">
              {header.length > 0 && (
                <thead>
                  <tr>
                    {Array.from({ length: cols }, (_, c) => (
                      <th key={c} className="border px-2 py-1 text-left" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                        {header[c] ?? ''}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: cols }, (_, c) => (
                      <td key={c} className="border px-2 py-1 align-top" style={{ borderColor: 'var(--border)' }}>
                        {String(Array.isArray(r) ? (r[c] ?? '') : '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </section>
  )
}

/** schema 的 complexity：{time:[最好,平均,最坏], space, stable, note} */
function Complexity({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null
  const v = value as { time?: unknown; space?: unknown; stable?: unknown; note?: unknown }
  const time = Array.isArray(v.time) ? v.time.map(String) : []
  const space = typeof v.space === 'string' ? v.space : ''
  const note = typeof v.note === 'string' ? v.note : ''
  if (time.length === 0 && space.length === 0 && note.length === 0) return null
  return (
    <section className="rounded-xl border p-4 text-sm" style={panel} data-role="complexity">
      <p className="text-sm font-semibold">复杂度</p>
      <ul className="mt-2 space-y-1" style={muted}>
        {time.length > 0 && <li>时间（最好 / 平均 / 最坏）：<span className="font-mono">{time.join(' / ')}</span></li>}
        {space.length > 0 && <li>空间：<span className="font-mono">{space}</span></li>}
        {typeof v.stable === 'boolean' && <li>稳定性：{v.stable ? '稳定' : '不稳定'}</li>}
        {note.length > 0 && <li>{note}</li>}
      </ul>
    </section>
  )
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
}
