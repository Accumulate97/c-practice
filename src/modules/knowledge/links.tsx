/**
 * 三向联动的反向通路组件（阶段 10-1）。
 *
 * 关联字段是「卡片侧单向写」的：卡片有 relatedProblems / relatedViz / relatedKnowledge，
 * 题目侧没有 knowledgeIds（实测 518 题里 0 条），演示侧 relatedProblems 也全空。
 * 所以反向通路一律用 cardsByProblem / cardsByViz 两张倒排表算出来，不要求数据补字段。
 *
 * 三条铁律：
 *   1. 索引拉不到就静默不渲染 —— 关联区是锦上添花，绝不能挡住作答 / 播放主流程
 *   2. 关联 id 在索引里查无此条时显示裸 id 并标注「索引里查不到」，不抛错、不白屏
 *   3. 没有任何关联内容时给一句人话的空状态，不留一块空白
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { loadIndex as loadProblemIndex, type ProblemIndex } from '../problems/data/loader'
import { loadVizIndex, type VizIndex } from '../viz/data/loader'
import {
  cardsByProblem,
  cardsByViz,
  loadKnowledgeIndex,
  type KnowledgeIndex,
  type KnowledgeIndexEntry,
} from './data/loader'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const linkChip: CSSProperties = { borderColor: 'var(--border)', color: 'var(--fg)' }

/** 倒排表最多展示条数：同章卡片动辄二三十张，全铺出来会把作答区挤到屏幕外 */
const CAP = 8

/** 拉索引 + 卸载保护。失败返回 null，调用方静默不渲染 */
function useIndex<T>(load: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    load().then(
      (v) => {
        if (alive) setValue(v)
      },
      () => {
        /* 静默：关联区拉不到索引就不显示，不弹错误 */
      },
    )
    return () => {
      alive = false
    }
  }, [load])
  return value
}

const loadKnowledge = (): Promise<KnowledgeIndex> => loadKnowledgeIndex()
const loadProblems = (): Promise<ProblemIndex> => loadProblemIndex()
const loadViz = (): Promise<VizIndex> => loadVizIndex()

/** 通用关联条目：标题解析不到时退回裸 id，并说明原因 */
export interface RelItem {
  id: string
  title: string
  to: string
  emoji: string
  missing?: boolean
  note?: string
}

export function RelLinks({
  items,
  dataRole,
  empty,
}: {
  items: RelItem[]
  dataRole: string
  empty?: string
}) {
  if (items.length === 0) {
    if (!empty) return null
    return (
      <p className="text-xs" style={muted} data-role={dataRole + '-empty'}>
        {empty}
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-2" data-role={dataRole}>
      {items.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          data-role={dataRole + '-link'}
          data-id={item.id}
          title={item.missing ? `索引里查不到 ${item.id}，链接可能已失效` : item.note ?? item.title}
          className="rounded-lg border px-3 py-1.5 text-sm hover:underline"
          style={item.missing ? { ...linkChip, borderStyle: 'dashed', color: 'var(--fg-muted)' } : linkChip}
        >
          {item.emoji} {item.title}
          {item.missing && <span className="ml-1 text-[11px]">（查无此条）</span>}
        </Link>
      ))}
    </div>
  )
}

/** 卡片 id → 详情链接。用于知识卡片详情页的 relatedKnowledge 与各处反查结果 */
export function useCardItems(ids: string[]): { items: RelItem[]; ready: boolean } {
  const index = useIndex(loadKnowledge)
  const key = ids.join(',')
  const [items, setItems] = useState<RelItem[]>([])
  useEffect(() => {
    if (!index || key === '') {
      setItems([])
      return
    }
    const wanted = key.split(',')
    const byId = new Map(index.cards.map((c) => [c.id, c] as const))
    setItems(
      wanted.map((id) => {
        const hit = byId.get(id)
        return {
          id,
          title: hit ? hit.title : id,
          to: '/knowledge/' + id,
          emoji: '📖',
          missing: !hit,
          note: hit ? `${hit.chapter} · ${hit.section}` : undefined,
        }
      }),
    )
  }, [index, key])
  return { items, ready: index !== null }
}

/** 题目 id → 详情链接 */
export function useProblemItems(ids: string[]): { items: RelItem[]; ready: boolean } {
  const index = useIndex(loadProblems)
  const key = ids.join(',')
  const [items, setItems] = useState<RelItem[]>([])
  useEffect(() => {
    if (!index || key === '') {
      setItems([])
      return
    }
    const wanted = key.split(',')
    const byId = new Map(index.problems.map((p) => [p.id, p] as const))
    setItems(
      wanted.slice(0, CAP * 2).map((id) => {
        const hit = byId.get(id)
        return {
          id,
          title: hit ? hit.title || id : id,
          to: '/problems/p/' + id,
          emoji: '✍️',
          missing: !hit,
          note: hit ? `${hit.chapter} · ${hit.section}` : undefined,
        }
      }),
    )
  }, [index, key])
  return { items, ready: index !== null }
}

/** 演示 id → 播放页链接 */
export function useVizItems(ids: string[]): { items: RelItem[]; ready: boolean } {
  const index = useIndex(loadViz)
  const key = ids.join(',')
  const [items, setItems] = useState<RelItem[]>([])
  useEffect(() => {
    if (!index || key === '') {
      setItems([])
      return
    }
    const wanted = key.split(',')
    const byId = new Map(index.demos.map((d) => [d.id, d] as const))
    setItems(
      wanted.map((id) => {
        const hit = byId.get(id)
        return {
          id,
          title: hit ? hit.title : id,
          to: '/viz/' + id,
          emoji: '🎬',
          missing: !hit,
          note: hit ? hit.chapter : undefined,
        }
      }),
    )
  }, [index, key])
  return { items, ready: index !== null }
}

/**
 * 题目详情页的「相关卡片」：先取倒排表里直接引用这道题的卡片，
 * 再按「同课程 + 同章」补足到 CAP 张（题目侧没有 knowledgeIds，只能这么反查）。
 */
export function RelatedCardsForProblem({
  problemId,
  category,
  chapter,
}: {
  problemId: string
  category: string
  chapter: string
}) {
  const index = useIndex(loadKnowledge)
  const [cards, setCards] = useState<KnowledgeIndexEntry[]>([])

  useEffect(() => {
    if (!index) return
    const direct = cardsByProblem(index).get(problemId) ?? []
    const directIds = new Set(direct.map((c) => c.id))
    const sameChapter = index.cards.filter(
      (c) => !directIds.has(c.id) && c.category === category && c.chapter === chapter,
    )
    setCards([...direct, ...sameChapter].slice(0, CAP))
  }, [index, problemId, category, chapter])

  const { items } = useCardItems(cards.map((c) => c.id))

  return (
    <section className="rounded-xl border p-4" style={panel} data-role="related-knowledge">
      <p className="text-sm font-semibold">📖 相关知识卡片</p>
      <p className="mt-1 text-xs" style={muted}>
        做错了先回卡片补概念；下面既有直接引用本题的卡片，也有同章其他卡片。
      </p>
      <div className="mt-3">
        <RelLinks
          items={items}
          dataRole="related-knowledge-links"
          empty={
            index === null
              ? undefined
              : `本章（${chapter || '未分章'}）暂时还没有关联到知识卡片。可以直接去 📖 知识点汇总 按章节浏览。`
          }
        />
      </div>
    </section>
  )
}

/**
 * 演示页的「相关卡片 + 相关题目」。
 * 演示侧 relatedProblems 目前全空（语料生成器不写这个字段），题目从关联卡片再跳一跳取，
 * 这样「演示 → 卡片 → 题目」这条路即使没有直接关联也走得通。
 */
export function RelatedForViz({ demoId, relatedProblems }: { demoId: string; relatedProblems: string[] }) {
  const index = useIndex(loadKnowledge)
  const [cards, setCards] = useState<KnowledgeIndexEntry[]>([])
  const [problemIds, setProblemIds] = useState<string[]>([])

  useEffect(() => {
    if (!index) return
    const hits = cardsByViz(index).get(demoId) ?? []
    setCards(hits.slice(0, CAP))
    const viaCards = hits.flatMap((c) => c.relatedProblems)
    const merged: string[] = []
    for (const id of [...relatedProblems, ...viaCards]) {
      if (!merged.includes(id)) merged.push(id)
    }
    setProblemIds(merged.slice(0, CAP))
  }, [index, demoId, relatedProblems])

  const cardItems = useCardItems(cards.map((c) => c.id))
  const problemItems = useProblemItems(problemIds)

  return (
    <section className="rounded-xl border p-4" style={panel} data-role="viz-related">
      <p className="text-sm font-semibold">🔗 顺着这个演示继续学</p>
      <div className="mt-3 space-y-3">
        <div>
          <p className="mb-1 text-xs" style={muted}>
            📖 相关卡片（relatedViz 指向本演示）
          </p>
          <RelLinks
            items={cardItems.items}
            dataRole="viz-related-knowledge"
            empty={index === null ? undefined : '还没有卡片关联到这个演示。'}
          />
        </div>
        <div>
          <p className="mb-1 text-xs" style={muted}>
            ✍️ 相关题目（演示直连 + 关联卡片再跳一跳）
          </p>
          <RelLinks
            items={problemItems.items}
            dataRole="viz-related-problems"
            empty={index === null ? undefined : '暂时没有关联题目。'}
          />
        </div>
      </div>
    </section>
  )
}
