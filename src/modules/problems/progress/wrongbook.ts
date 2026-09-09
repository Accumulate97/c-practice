/**
 * 错题本：谁在册、怎么排序、怎么移出（阶段 5）。
 *
 * ── 收录口径（三条同时成立才算「在册」）──────────────────────────────────
 *   ① wrongCount > 0，或 selfAssessed 且最近结论仍是失败
 *                            真错过。机器判分确证失败算错过，简答题自评「还没答对」也算；
 *                            只收藏/只写笔记的空壳记录（attempts=0 且没自评过）不算。
 *                            自评**故意不动 wrongCount**：它一旦进了错误次数，stats.ts 的
 *                            「机器判分正确率」就被学生自己点的一个按钮污染了；
 *   ② result === 'attempted' 最近一次有结论的判分仍是失败 —— 后来做对了就自动出册，
 *                            不需要学生手工清理（做对了还留在错题本里只会变成噪声）；
 *   ③ 未被「我已掌握」移出，或移出之后又做错了（wrongDismissedAt < lastWrongAt）。
 *
 * 第 ③ 条为什么比时刻而不是存布尔：存布尔就得再写一套「什么时候把布尔翻回 false」的状态机，
 * 而时刻比较天然表达了「移除之后又做错 → 自动回册」，且与 lastWrongAt 同源、不会自相矛盾。
 *
 * ── 与「未判定」的关系（AGENTS.md 二·5）────────────────────────────────
 * 后端 5xx / 网络失败 / 输出截断根本不写记录（store.ts 的 recordBatchAttempt 已拦），
 * 所以后端抖动永远不会把一道题塞进学生的错题本。
 */
import type { ProblemIndex, ProblemIndexEntry } from '../data/loader'
import type { AttemptRecord, ProgressMap } from './schema'

/** 这道题此刻是否在错题本里（纯函数，统计与列表共用同一份判定，不要各自 if） */
export function inWrongBook(record: AttemptRecord | undefined): boolean {
  if (!record) return false
  if (record.result !== 'attempted') return false
  // 两个来源任一即「真错过」：机器判分确证失败（wrongCount>0），或简答题自评「还没答对」
  if (record.wrongCount <= 0 && !record.selfAssessed) return false
  if (record.wrongDismissedAt === null) return true
  const lastWrong = record.lastWrongAt ?? 0
  return record.wrongDismissedAt < lastWrong || record.wrongDismissedAt < record.lastAt
}

/**
 * 错题本行上的次数文案。
 * 纯自评未通过的记录 wrongCount 是 0：显示「错 0 次」像 bug，谎报「错 1 次」又是假的
 * （机器从没判它错过），所以如实说这是自评结论。
 */
export function wrongCountLabel(record: AttemptRecord): string {
  return record.wrongCount > 0 ? `错 ${record.wrongCount} 次` : '自评未通过'
}

/** 「已移出但仍在册判定的历史里」= 学生点过「我已掌握」，用于 UI 显示可撤销 */
export function isDismissed(record: AttemptRecord | undefined): boolean {
  if (!record) return false
  return record.wrongDismissedAt !== null && !inWrongBook(record)
}

export interface WrongBookItem {
  entry: ProblemIndexEntry
  record: AttemptRecord
  /** 累计确证失败次数（错题本要显示「错了几次」） */
  wrongCount: number
  /** 最近一次确证失败的时刻；理论上有 wrongCount>0 就非 null，仍按可空处理防脏数据 */
  lastWrongAt: number | null
}

/**
 * 错题本清单，按「最近错误时间」降序 —— 刚错的排最前，符合复习顺序。
 * 索引里查不到的记录（题目被删/改 id）不进清单，由 stats.ts 单列为 orphan 如实告知。
 */
export function wrongBookItems(index: ProblemIndex, records: ProgressMap): WrongBookItem[] {
  const out: WrongBookItem[] = []
  for (const entry of index.problems) {
    const record = records[entry.id]
    if (!inWrongBook(record) || !record) continue
    out.push({ entry, record, wrongCount: record.wrongCount, lastWrongAt: record.lastWrongAt })
  }
  return out.sort((a, b) => {
    const la = a.lastWrongAt ?? 0
    const lb = b.lastWrongAt ?? 0
    if (la !== lb) return lb - la
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
  })
}

/** 收藏清单：按收藏时刻没有记录（starred 是布尔），退化为章节+题号顺序，与列表页同口径 */
export function starredItems(index: ProblemIndex, records: ProgressMap): { entry: ProblemIndexEntry; record: AttemptRecord }[] {
  const out: { entry: ProblemIndexEntry; record: AttemptRecord }[] = []
  for (const entry of index.problems) {
    const record = records[entry.id]
    if (record && record.starred) out.push({ entry, record })
  }
  return out
}
