/**
 * 全站搜索语料加载 + 打分（任务 4-1）。
 *
 * 语料是构建期生成的 public/data/search/unified.json（scripts/build-search-index.mjs），
 * 七类同形状：题目 / 知识卡片 / 2D 演示 / 3D 演示 / 错误展品 / 速查手册行 / 站内页面。
 *
 * 为什么不用 MiniSearch：2806 条量级下，「全部词都要命中 + 字段权重」的子串打分实测 <2 ms，
 * 引 MiniSearch 要多付 ~7 KB gzip 与一份索引序列化格式，而中文根本没有词干可提取
 * （它的默认 tokenizer 会把整句中文当一个 token，召回反而更差）。用户裁决：最稳妥、体积最小。
 *
 * 打分口径（越高越靠前）：
 *   标题完全相等 1000 > id 完全相等 900 > 标题前缀 400 > 标题包含 150
 *   > id 子串 140 > 副标题包含 60 > 附加文本包含 25
 *   多个空格分隔的词是 **AND**：任一词一处都没命中就整条出局（搜「链表 插入」不该把只讲插入的排序题顶上来）。
 */
import { dataUrl } from '../../app/config'

export type SearchKind = 'problem' | 'knowledge' | 'viz' | 'viz3d' | 'bug' | 'ref' | 'page'

/** unified.json 的一条语料。字段名刻意取单字母：这份文件要走网络，727 KB 里省下的都是真金白银 */
export interface SearchDoc {
  /** 类别 */
  k: SearchKind
  /** 类别内唯一 id（题目/卡片/演示 id；手册行是 section:table:row；站内页是路由名） */
  id: string
  /** 标题（展示 + 最高权重匹配字段） */
  t: string
  /** 副标题：章节 / 分区 / 步数这类上下文，展示用，次高权重 */
  s: string
  /** 附加可搜索文本：标签、摘要、要点、病症、整行单元格 */
  x?: string
  /** 深链查询词（仅手册行）：落到手册页时把搜索框填好 */
  q?: string
  /** 路由（仅站内页） */
  u?: string
  /** 1 = 该题已 Godbolt 实机验证（仅题目，列表里给个诚实徽标） */
  n?: number
}

export interface SearchCorpus {
  schema: number
  totals: Partial<Record<SearchKind | 'all', number>>
  docs: SearchDoc[]
}

export const KIND_ORDER: readonly SearchKind[] = ['problem', 'knowledge', 'viz', 'viz3d', 'bug', 'ref', 'page']

export const KIND_META: Record<SearchKind, { emoji: string; label: string }> = {
  problem: { emoji: '✍️', label: '题目' },
  knowledge: { emoji: '📖', label: '知识卡片' },
  viz: { emoji: '🎬', label: '2D 演示' },
  viz3d: { emoji: '🧊', label: '3D 演示' },
  bug: { emoji: '🐛', label: '错误展品' },
  ref: { emoji: '📑', label: '速查手册' },
  page: { emoji: '🧭', label: '站内页面' },
}

/** 结果行点进去的地址。手册行带 q=，错误展品带 ex=，两边页面都认这两个深链参数 */
export function docUrl(doc: SearchDoc): string {
  switch (doc.k) {
    case 'problem': return `/problems/p/${doc.id}`
    case 'knowledge': return `/knowledge/${doc.id}`
    case 'viz': return `/viz/${doc.id}`
    case 'viz3d': return `/viz3d/${doc.id}`
    case 'bug': return `/bugs?ex=${encodeURIComponent(doc.id)}`
    case 'ref': return `/cheatsheet?q=${encodeURIComponent(doc.q ?? doc.t)}`
    case 'page': return doc.u ?? '/'
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`搜索语料加载失败：${url}（HTTP ${res.status}）`)
  return (await res.json()) as T
}

let corpusPromise: Promise<SearchCorpus> | null = null

/** 单飞 + 失败可重试：与 problems/viz loader 同一口径 */
export function loadCorpus(): Promise<SearchCorpus> {
  if (!corpusPromise) {
    corpusPromise = getJson<SearchCorpus>(dataUrl('search/unified.json')).catch((error: unknown) => {
      corpusPromise = null
      throw error
    })
  }
  return corpusPromise
}

/* ══════════════════ 打分 ══════════════════ */

const W_EXACT = 1000
/** id 完全相等：搜「c-ch03-pg-001」这类题号，第一条就必须是它 */
const W_ID_EXACT = 900
const W_PREFIX = 400
const W_TITLE = 150
/** id 子串（章节号 c-ch03、演示 id 片段）：比标题命中低、比副标题高 */
const W_ID_PART = 140
const W_SUB = 60
const W_EXTRA = 25
/** 一次查询最多拆几个词：防止有人粘一整段代码进来把 2806 条 × N 词跑爆 */
const MAX_TOKENS = 6
/** 一次最多返回多少条：再多也没人翻，且渲染上千个 <mark> 会卡 */
const DEFAULT_LIMIT = 80

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOKENS)
}

/** 小写化只做一次，之后每次敲键都复用（WeakMap 挂在语料对象上，不污染数据结构） */
interface Lowered { t: string; s: string; x: string; i: string }
const loweredCache = new WeakMap<SearchCorpus, Lowered[]>()

function loweredOf(corpus: SearchCorpus): Lowered[] {
  let cached = loweredCache.get(corpus)
  if (!cached) {
    cached = corpus.docs.map((d) => ({
      t: d.t.toLowerCase(),
      s: d.s.toLowerCase(),
      x: (d.x ?? '').toLowerCase(),
      i: d.id.toLowerCase(),
    }))
    loweredCache.set(corpus, cached)
  }
  return cached
}

export interface SearchHit {
  doc: SearchDoc
  score: number
  /** 附加文本里第一个命中词附近的片段：说清「它为什么被搜出来了」 */
  snippet: string
}

export interface SearchOptions {
  /** 只看某几类；null / 空集合 = 不过滤 */
  kinds?: ReadonlySet<SearchKind> | null
  limit?: number
}

export interface SearchResult {
  hits: SearchHit[]
  /** 命中总数（未过滤口径；可能大于 hits.length —— 被 limit 截断了，UI 要如实说） */
  matched: number
  /** 所选类别内的命中总数，没过滤时等于 matched。
   *  chip 角标与「命中 N 条」都必须用这个口径：过滤到「速查手册」时还报全部类别的 8 条就是谎报 */
  matchedFiltered: number
  /** 各类别命中数：过滤 chips 的角标按「未过滤」口径统计，否则点了 chip 就再也回不去 */
  kindCounts: Partial<Record<SearchKind, number>>
  tokens: string[]
}

function snippetOf(text: string, tokens: string[]): string {
  if (!text) return ''
  const lower = text.toLowerCase()
  let at = -1
  let len = 0
  for (const tk of tokens) {
    const i = lower.indexOf(tk)
    if (i >= 0 && (at < 0 || i < at)) { at = i; len = tk.length }
  }
  if (at < 0) return text.slice(0, 90)
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + len + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export function searchCorpus(corpus: SearchCorpus, query: string, opts: SearchOptions = {}): SearchResult {
  const tokens = tokenize(query)
  const empty: SearchResult = { hits: [], matched: 0, matchedFiltered: 0, kindCounts: {}, tokens }
  if (tokens.length === 0) return empty

  const lower = loweredOf(corpus)
  const kinds = opts.kinds && opts.kinds.size > 0 ? opts.kinds : null
  const all: SearchHit[] = []
  const kindCounts: Partial<Record<SearchKind, number>> = {}

  for (let i = 0; i < corpus.docs.length; i += 1) {
    const doc = corpus.docs[i]
    const lo = lower[i]
    if (!doc || !lo) continue
    let score = 0
    let ok = true
    for (const tk of tokens) {
      let best = 0
      if (lo.t === tk) best = W_EXACT
      else if (lo.i === tk) best = W_ID_EXACT
      else if (lo.t.startsWith(tk)) best = W_PREFIX
      else if (lo.t.includes(tk)) best = W_TITLE
      else if (lo.i.includes(tk)) best = W_ID_PART
      if (best === 0 && lo.s.includes(tk)) best = W_SUB
      if (best === 0 && lo.x.includes(tk)) best = W_EXTRA
      if (best === 0) { ok = false; break }
      score += best
    }
    if (!ok || score === 0) continue
    kindCounts[doc.k] = (kindCounts[doc.k] ?? 0) + 1
    all.push({ doc, score, snippet: snippetOf(doc.x ?? '', tokens) })
  }

  // 排序：分数降序 → 标题短的优先（越短通常越精确）→ id 兜底，同样输入永远同样顺序（可复现）
  all.sort((a, b) => b.score - a.score || a.doc.t.length - b.doc.t.length || (a.doc.id < b.doc.id ? -1 : 1))

  const matched = all.length
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT)
  const hits = kinds ? all.filter((h) => kinds.has(h.doc.k)).slice(0, limit) : all.slice(0, limit)
  const matchedFiltered = !kinds || kinds.size === KIND_ORDER.length
    ? matched
    : [...kinds].reduce((n, k) => n + (kindCounts[k] ?? 0), 0)
  return { hits, matched, matchedFiltered, kindCounts, tokens }
}

/** 高亮切片：把文本按命中词切成「普通 / 命中」段，UI 用 <mark> 渲染命中段 */
export interface HighlightPart { text: string; hit: boolean }

export function highlight(text: string, tokens: readonly string[]): HighlightPart[] {
  if (!text || tokens.length === 0) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const marks: boolean[] = new Array<boolean>(text.length).fill(false)
  for (const tk of tokens) {
    if (!tk) continue
    let from = 0
    for (;;) {
      const i = lower.indexOf(tk, from)
      if (i < 0) break
      for (let j = i; j < i + tk.length && j < marks.length; j += 1) marks[j] = true
      from = i + tk.length
    }
  }
  const out: HighlightPart[] = []
  let buf = ''
  let cur = marks[0] ?? false
  for (let i = 0; i < text.length; i += 1) {
    const m = marks[i] ?? false
    if (m !== cur) { out.push({ text: buf, hit: cur }); buf = ''; cur = m }
    buf += text[i] ?? ''
  }
  if (buf) out.push({ text: buf, hit: cur })
  return out
}
