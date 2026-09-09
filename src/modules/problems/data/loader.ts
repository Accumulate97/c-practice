/**
 * 题库懒加载（纯静态、无后端）：
 *   index.json（唯一索引入口，scripts/build-index.ts 生成）→ 章节分片 c-chNN.json → 单题。
 *
 * 注意 public/data/problems/ 下还有两个下划线开头的文件，它们**不是分片、前端不读**：
 *   _index.json           题库转换期的总账（与 index.json 并存会造成列表页与实际数据不一致）
 *   _judge-evidence.json  Godbolt 实机证据（judge:verify 与降级自评用）
 * 分片判定口径见 scripts/build-index.ts / verify-data.ts 的 isShardName()。
 */
import { dataUrl } from '../../../app/config'

/** index.json 的章节条目 */
export interface ShardMeta {
  file: string
  category: string
  chapter: string
  count: number
}

/** index.json 的题目条目：只放列表页需要的字段，正文仍在分片里 */
export interface ProblemIndexEntry {
  id: string
  type: string
  category: string
  chapter: string
  section: string
  difficulty: number
  bloom: string
  verified: boolean
  tags: string[]
  title: string
  file: string
}

export interface ProblemIndex {
  count: number
  shard_count: number
  shards: ShardMeta[]
  problems: ProblemIndexEntry[]
  content_sha?: string
  schema_version?: number
  data_version?: string
}

/** 与 schema/Problem.schema.json 的 definitions.testCases 同构 */
export interface TestCaseData {
  stdin: string
  expected: string
  note?: string
}

/**
 * 分片里的完整题目记录。
 * 各题型字段差异很大（code_reading 有 code、code_completion 有 blanks…），
 * 模块 1 只把编程题需要的字段写成强类型，其余留给索引签名，后续模块按需收窄。
 */
export interface ProblemRecord {
  id: string
  type: string
  category: string
  chapter: string
  section: string
  stem: string
  difficulty: number
  source?: string
  explanation?: string
  reference?: string
  testCases?: TestCaseData[]
  verified?: boolean
  [key: string]: unknown
}

export interface LoadedProblem {
  entry: ProblemIndexEntry
  problem: ProblemRecord
}

/** 索引里没有 / 分片里查无此题 —— 这是数据不一致，不是网络故障，不该重试 */
export class ProblemNotFound extends Error {
  constructor(id: string, file?: string) {
    super(file ? `索引把 ${id} 指向 ${file}，但该分片里没有这道题` : `题库索引里没有 ${id}`)
    this.name = 'ProblemNotFound'
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`数据文件加载失败：${url}（HTTP ${res.status}）`)
  return (await res.json()) as T
}

let indexPromise: Promise<ProblemIndex> | null = null
const shardCache = new Map<string, Promise<ProblemRecord[]>>()

/** 单飞：并发调用只发一次请求；失败后清掉缓存，下次点击可以重试 */
export function loadIndex(): Promise<ProblemIndex> {
  if (!indexPromise) {
    indexPromise = getJson<ProblemIndex>(dataUrl('problems/index.json')).catch((error: unknown) => {
      indexPromise = null
      throw error
    })
  }
  return indexPromise
}

export function loadShard(file: string): Promise<ProblemRecord[]> {
  let pending = shardCache.get(file)
  if (!pending) {
    pending = getJson<{ problems: ProblemRecord[] }>(dataUrl(`problems/${file}`))
      .then((json) => json.problems)
      .catch((error: unknown) => {
        shardCache.delete(file)
        throw error
      })
    shardCache.set(file, pending)
  }
  return pending
}

export async function loadProblem(id: string): Promise<LoadedProblem> {
  const index = await loadIndex()
  const entry = index.problems.find((p) => p.id === id)
  if (!entry) throw new ProblemNotFound(id)
  const problems = await loadShard(entry.file)
  const problem = problems.find((p) => p.id === id)
  if (!problem) throw new ProblemNotFound(id, entry.file)
  return { entry, problem }
}

/** 模块 5 的题目列表页用：按章节聚合，避免每个页面自己遍历 493 条 */
export function groupByChapter(index: ProblemIndex): { chapter: string; items: ProblemIndexEntry[] }[] {
  const order: string[] = []
  const map = new Map<string, ProblemIndexEntry[]>()
  for (const item of index.problems) {
    let bucket = map.get(item.chapter)
    if (!bucket) {
      bucket = []
      map.set(item.chapter, bucket)
      order.push(item.chapter)
    }
    bucket.push(item)
  }
  return order.map((chapter) => ({ chapter, items: map.get(chapter) ?? [] }))
}