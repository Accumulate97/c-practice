/**
 * 知识卡片懒加载（纯静态、无后端）。口径完全对齐 problems / viz 两个 loader：
 *   knowledge/index.json（唯一索引入口，scripts/build-index.ts 生成）→ 章节分片 {file} → 单卡片。
 *
 * 索引里放的是列表页要用的字段（title / summary / keyPoints / 关联 id），
 * 正文 content、示例代码、易错点仍在分片里，由详情页按 entry.file 懒加载。
 * 新增分片重跑 build:index 即自动收录 —— 这里没有任何写死的章数或卡片 id。
 */
import { dataUrl } from '../../../app/config'

/** index.json 的卡片条目 */
export interface KnowledgeIndexEntry {
  id: string
  /** 详情页据此定位分片；不靠 id 前缀猜文件名 */
  file: string
  category: string
  chapter: string
  section: string
  order: number
  title: string
  summary: string
  keyPoints: string[]
  relatedProblems: string[]
  relatedViz: string[]
}

export interface KnowledgeIndex {
  count: number
  shard_count?: number
  cards: KnowledgeIndexEntry[]
  content_sha?: string
}

/** 卡片示例（与 schema/Knowledge.schema.json 的 examples 同构） */
export interface KnowledgeExample {
  title: string
  code: string
  runnable?: boolean
  stdin?: string
  expected?: string
  note?: string
}

/** 分片里的完整卡片记录。除强类型字段外允许扩展，后续新增字段不必改这里 */
export interface KnowledgeCard {
  id: string
  title: string
  category?: string
  chapter?: string
  section?: string
  order?: number
  summary?: string
  content?: string
  keyPoints?: string[]
  pitfalls?: string[]
  examples?: KnowledgeExample[]
  relatedProblems?: string[]
  relatedKnowledge?: string[]
  relatedViz?: string[]
  [key: string]: unknown
}

export interface LoadedCard {
  entry: KnowledgeIndexEntry
  card: KnowledgeCard
}

/** 索引里没有 / 分片里查无此卡片 —— 数据不一致，不是网络故障，不该重试 */
export class KnowledgeNotFound extends Error {
  constructor(id: string, file?: string) {
    super(file ? `索引把 ${id} 指向 ${file}，但该分片里没有这张卡片` : `知识卡片索引里没有 ${id}`)
    this.name = 'KnowledgeNotFound'
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`数据文件加载失败：${url}（HTTP ${res.status}）`)
  return (await res.json()) as T
}

let indexPromise: Promise<KnowledgeIndex> | null = null
const shardCache = new Map<string, Promise<KnowledgeCard[]>>()

/** 单飞：并发调用只发一次请求；失败后清掉缓存，下次点击可以重试 */
export function loadKnowledgeIndex(): Promise<KnowledgeIndex> {
  if (!indexPromise) {
    indexPromise = getJson<KnowledgeIndex>(dataUrl('knowledge/index.json')).catch((error: unknown) => {
      indexPromise = null
      throw error
    })
  }
  return indexPromise
}

export function loadKnowledgeShard(file: string): Promise<KnowledgeCard[]> {
  let pending = shardCache.get(file)
  if (!pending) {
    pending = getJson<{ cards: KnowledgeCard[] }>(dataUrl(`knowledge/${file}`))
      .then((json) => (Array.isArray(json.cards) ? json.cards : []))
      .catch((error: unknown) => {
        shardCache.delete(file)
        throw error
      })
    shardCache.set(file, pending)
  }
  return pending
}

export async function loadCard(id: string): Promise<LoadedCard> {
  const index = await loadKnowledgeIndex()
  const entry = index.cards.find((c) => c.id === id)
  if (!entry) throw new KnowledgeNotFound(id)
  const cards = await loadKnowledgeShard(entry.file)
  const card = cards.find((c) => c.id === id)
  if (!card) throw new KnowledgeNotFound(id, entry.file)
  return { entry, card }
}

/** 章节分组键：category 必须进键 —— c 与 ds 各自都有「第6章」，只按章名分会把两门课揉在一起 */
export const chapterKey = (category: string, chapter: string): string => `${category}|${chapter}`

export interface ChapterGroup {
  key: string
  category: string
  chapter: string
  items: KnowledgeIndexEntry[]
}

/** 列表页用：按 category + chapter 聚合，保持索引里的出现顺序，章内按 order 再按 id */
export function groupByChapter(index: KnowledgeIndex): ChapterGroup[] {
  const order: string[] = []
  const map = new Map<string, ChapterGroup>()
  for (const item of index.cards) {
    const key = chapterKey(item.category, item.chapter)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = { key, category: item.category, chapter: item.chapter, items: [] }
      map.set(key, bucket)
      order.push(key)
    }
    bucket.items.push(item)
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => (a.order - b.order !== 0 ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return order.map((key) => map.get(key) as ChapterGroup)
}

/** id → 条目。关联字段里存的是裸 id，标题要靠这张表解析（缺失就当没有，不报错） */
export function cardMap(index: KnowledgeIndex): Map<string, KnowledgeIndexEntry> {
  return new Map(index.cards.map((c) => [c.id, c] as const))
}

/** 反向索引：题目 id → 引用它的卡片。relatedProblems 是卡片侧单向写的，题目侧没有 knowledgeIds */
export function cardsByProblem(index: KnowledgeIndex): Map<string, KnowledgeIndexEntry[]> {
  const map = new Map<string, KnowledgeIndexEntry[]>()
  for (const card of index.cards) {
    for (const pid of card.relatedProblems) {
      const bucket = map.get(pid)
      if (bucket) bucket.push(card)
      else map.set(pid, [card])
    }
  }
  return map
}

/** 反向索引：演示 id → 引用它的卡片（backfill:viz 回填的 relatedViz） */
export function cardsByViz(index: KnowledgeIndex): Map<string, KnowledgeIndexEntry[]> {
  const map = new Map<string, KnowledgeIndexEntry[]>()
  for (const card of index.cards) {
    for (const vid of card.relatedViz) {
      const bucket = map.get(vid)
      if (bucket) bucket.push(card)
      else map.set(vid, [card])
    }
  }
  return map
}

export const categoryLabel = (category: string): string =>
  category === 'c' ? 'C 语言' : category === 'ds' ? '数据结构' : category || '未分类'
