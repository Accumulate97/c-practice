/**
 * 进度统计（阶段 5）：总览 / 按章节 / 按题型 / 正确率。
 *
 * ── 口径钉死在这里，页面不许各自算 ──────────────────────────────────────
 *   已通过  = everPassed（曾经全绿过一次，之后改坏也不回退）
 *   尝试过  = 有记录、最近结论仍是失败（statusOf 的 'attempted'）
 *   未做    = 其余（含只收藏/只写笔记、attempts=0 的空壳记录）
 *   正确率  = (Σattempts − ΣwrongCount) / Σattempts，**只统计机器判分**：
 *             简答题自评走 store.selfAssess()，它只动结论字段、不动 attempts/wrongCount，
 *             所以自评永远不会污染这个数字；分母为 0 时返回 null（没数据就明说没数据，
 *             绝不显示 100% 或 0% 这种看起来像结论的假数字）。
 *
 * ── 纯函数、不联网 ─────────────────────────────────────────────────────
 * 输入是已经加载好的 index.json + localStorage 里的记录表，统计过程不发任何请求，
 * 518 道题一次遍历即可（列表页已经证明这个量级在浏览器里没有性能问题）。
 */
import type { ProblemIndex, ProblemIndexEntry } from '../data/loader'
import { TYPE_ORDER, shardKey, typeLabel } from '../type-meta'
import { statusOf } from './store'
import { inWrongBook } from './wrongbook'
import type { AttemptRecord, ProgressMap } from './schema'

/** 一个统计桶（总览 / 某一章 / 某一题型都是同一形状，UI 只写一套渲染） */
export interface BucketStat {
  /** 章节用 c-chNN，题型用 type 值，总览用 'all' */
  key: string
  label: string
  total: number
  passed: number
  attempted: number
  todo: number
  /** passed/attempted 里由学生自评得出的条数（简答题）：单列出来，不混进机器判分正确率 */
  selfAssessed: number
  /** 机器判分：拿到确证结论的提交总次数 */
  attempts: number
  /** 机器判分：其中确证失败的次数 */
  wrongCount: number
  /** 机器判分正确率；attempts=0 时为 null */
  accuracy: number | null
  /** 错题本在册数 */
  wrongBook: number
  starred: number
  /** 写了个人笔记的题数 */
  noted: number
}

export interface ProgressStats {
  overall: BucketStat
  /** 按 index.json 的分片顺序（= 列表页默认排序的章节顺序） */
  byChapter: BucketStat[]
  /** 主力四型在前，辅助题型在后（type-meta 的 TYPE_ORDER），表外类型按题量降序追加 */
  byType: BucketStat[]
  /** localStorage 里有记录、索引里却没有的 id（题目被删或改过 id）：如实列出，不静默丢弃 */
  orphanIds: string[]
  /** localStorage 里的记录总数（含 orphan） */
  recordCount: number
  /** 索引题目总数，与 index.count 一致（页面用它跟 index.json 对账） */
  problemCount: number
}

function emptyBucket(key: string, label: string): BucketStat {
  return {
    key, label, total: 0, passed: 0, attempted: 0, todo: 0, selfAssessed: 0,
    attempts: 0, wrongCount: 0, accuracy: null, wrongBook: 0, starred: 0, noted: 0,
  }
}

function add(bucket: BucketStat, record: AttemptRecord | undefined): void {
  bucket.total += 1
  if (record) {
    const status = statusOf(record)
    if (status === 'passed') bucket.passed += 1
    else if (status === 'attempted') bucket.attempted += 1
    else bucket.todo += 1
    if (record.selfAssessed) bucket.selfAssessed += 1
    bucket.attempts += record.attempts
    bucket.wrongCount += record.wrongCount
    if (inWrongBook(record)) bucket.wrongBook += 1
    if (record.starred) bucket.starred += 1
    if (record.note.trim().length > 0) bucket.noted += 1
  } else {
    bucket.todo += 1
  }
}

function finish(bucket: BucketStat): BucketStat {
  // 分母为 0 → null。有分母但分子为负（脏数据）→ 夹到 0，绝不出负正确率
  bucket.accuracy = bucket.attempts > 0
    ? Math.min(1, Math.max(0, (bucket.attempts - bucket.wrongCount) / bucket.attempts))
    : null
  return bucket
}

/** 章节顺序 = index.problems 里的首次出现顺序（build-index 按分片顺序 flatMap，故即分片顺序） */
function chapterKeyOf(entry: ProblemIndexEntry): string {
  return shardKey(entry.file)
}

export function computeStats(index: ProblemIndex, records: ProgressMap): ProgressStats {
  const overall = emptyBucket('all', '全部题目')
  const chapters = new Map<string, BucketStat>()
  const types = new Map<string, BucketStat>()
  const seen = new Set<string>()

  for (const entry of index.problems) {
    seen.add(entry.id)
    const record = records[entry.id]
    add(overall, record)

    const ck = chapterKeyOf(entry)
    let cb = chapters.get(ck)
    if (!cb) {
      cb = emptyBucket(ck, entry.chapter)
      chapters.set(ck, cb)
    }
    add(cb, record)

    let tb = types.get(entry.type)
    if (!tb) {
      tb = emptyBucket(entry.type, typeLabel(entry.type))
      types.set(entry.type, tb)
    }
    add(tb, record)
  }

  const orphanIds = Object.keys(records).filter((id) => !seen.has(id)).sort()

  const byType = [...types.values()].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a.key)
    const ib = TYPE_ORDER.indexOf(b.key)
    // 顺序表里没有的类型（历史数据/新增题型）排到表内类型之后，彼此按题量降序、再按 key
    if (ia === -1 && ib === -1) return b.total - a.total || (a.key < b.key ? -1 : 1)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  return {
    overall: finish(overall),
    byChapter: [...chapters.values()].map(finish),
    byType: byType.map(finish),
    orphanIds,
    recordCount: Object.keys(records).length,
    problemCount: index.problems.length,
  }
}

/** 百分比文案：null → '—'（没有机器判分数据时不给假数字） */
export function accuracyText(accuracy: number | null): string {
  return accuracy === null ? '—' : `${Math.round(accuracy * 100)}%`
}

/** 进度条宽度（0–100，保留一位小数）：total=0 时给 0，不出 NaN */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}
