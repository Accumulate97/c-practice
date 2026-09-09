/**
 * 进度导出 / 导入（阶段 5）。纯静态站没有账号系统，localStorage 是进度唯一的家 ——
 * 换浏览器、换电脑、清缓存都会把它带走，所以「导出成 JSON 文件、再导回来」不是锦上添花，
 * 是学生进度唯一的备份手段。
 *
 * ── 三条不会破例的规矩 ────────────────────────────────────────────────
 *   1. 导出文件自带 schemaVersion。将来结构升级后，今天导出的文件仍能沿 migrateRecords
 *      的迁移链走回当前版本；没有版本号的文件一律拒收并说清原因（不猜）。
 *   2. 导入是**合并**而不是覆盖：换机器时手上往往已经做了几道题，整表替换会把它们抹掉。
 *      合并规则见 mergeRecord 的逐字段注释，核心是「同一份历史不能被数成两份」——
 *      attempts / wrongCount 取 max 而不是相加，所以把同一个文件导两次结果不变（幂等）。
 *   3. 导入不产生任何新的判分结论。它只搬运学生自己机器上已经确证过的记录，
 *      因此不存在「导入一份别人的进度就算我通过」之外的诚实性问题；
 *      文件里若有洗不干净的条目，dropped 计数如实报告，不静默丢弃。
 */
import { PROGRESS_SCHEMA_VERSION, migrateRecords } from './schema'
import type { AttemptRecord, ProgressMap } from './schema'

export const EXPORT_APP = 'c-practice'
export const EXPORT_KIND = 'c-practice-progress'

/** 导出文件的形状。字段只增不改；改结构就升 PROGRESS_SCHEMA_VERSION 并补迁移步骤 */
export interface ProgressExport {
  app: string
  kind: string
  schemaVersion: number
  /** ISO 时刻。导入时只做展示，不参与裁决（学生机器的时钟不可信） */
  exportedAt: string
  /** 导出时的题库规模与记录数，供人工核对；导入不拿它对账（题库会增长） */
  problemCount: number
  recordCount: number
  records: ProgressMap
}

export function buildExport(records: ProgressMap, problemCount: number, now = new Date()): ProgressExport {
  const ids = Object.keys(records)
  return {
    app: EXPORT_APP,
    kind: EXPORT_KIND,
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    problemCount,
    recordCount: ids.length,
    records,
  }
}

export function serializeExport(file: ProgressExport): string {
  return JSON.stringify(file, null, 2) + '\n'
}

/** 文件名带本地时刻：c-practice-progress-20260909-2145.json（同一分钟内多次导出会重名，浏览器自己会加 (1)） */
export function exportFilename(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `c-practice-progress-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

/** 浏览器里落文件：Blob + 临时 a[download]。纯静态站没有服务端可以发附件 */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立即 revoke 会让部分浏览器（Safari）拿到空文件，故推迟到下一个宏任务
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export interface MergeReport {
  /** 文件里的记录条数（洗过之后） */
  incoming: number
  /** 本地原本没有、这次新增的 */
  added: number
  /** 两边都有、合并后与本地不同的 */
  updated: number
  /** 两边都有、合并后与本地逐字节相同的（把同一份文件导两次时应该等于 incoming） */
  unchanged: number
  /** 两边都写了笔记且内容不同：已保留最近修改的一份，这里如实计数 */
  noteConflicts: number
  /** 文件里洗不成记录而被丢弃的条数 */
  dropped: number
  /** 文件声明的版本；走了迁移链才有 steps */
  fromVersion: number | null
  steps: number[]
}

export type ImportOutcome =
  | { kind: 'ok'; records: ProgressMap; report: MergeReport }
  /** 拒收。reason 是给人看的，必须说清「为什么不收」与「接下来怎么办」 */
  | { kind: 'rejected'; reason: string }

export function importProgress(current: ProgressMap, text: string): ImportOutcome {
  if (text.trim().length === 0) {
    return { kind: 'rejected', reason: '文件是空的，没有任何进度可导入。' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      kind: 'rejected',
      reason: `文件不是合法 JSON（${error instanceof Error ? error.message : String(error)}）。请确认选的是本站导出的进度文件，导出后没有被编辑器改坏。`,
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'rejected', reason: '文件顶层不是对象，认不出这是本站的进度导出文件。' }
  }
  const shape = parsed as Record<string, unknown>
  const rawRecords = shape.records
  if (typeof rawRecords !== 'object' || rawRecords === null) {
    return {
      kind: 'rejected',
      reason: '文件里没有 records 字段。本站的进度导出文件顶层形如 { app, kind, schemaVersion, exportedAt, records }，请用「导出进度」生成的原文件导入。',
    }
  }
  const declared = typeof shape.schemaVersion === 'number' ? shape.schemaVersion : null
  if (declared === null) {
    return { kind: 'rejected', reason: '文件缺少 schemaVersion，无法确定它是哪一版结构。不猜含义、不冒险导入 —— 请用本站「导出进度」重新生成一份。' }
  }
  const outcome = migrateRecords(rawRecords, declared)
  if (outcome.kind === 'newer-version') {
    return {
      kind: 'rejected',
      reason: `这份文件由更新版本的数据结构导出（schemaVersion=${String(outcome.from)}，本站当前 ${String(PROGRESS_SCHEMA_VERSION)}）。降级导入会把字段含义解释错，故拒收；请先把站点更新到导出版本再导。`,
    }
  }
  if (outcome.kind === 'unknown-version') {
    return {
      kind: 'rejected',
      reason: `schemaVersion=${outcome.from === null ? '（非数字）' : String(outcome.from)} 在迁移链上找不到落点，无法安全升级到 ${String(PROGRESS_SCHEMA_VERSION)}。原文已原样保留在文件里，没有动过本地进度。`,
    }
  }

  const incoming = outcome.records
  const merged: ProgressMap = { ...current }
  let added = 0
  let updated = 0
  let unchanged = 0
  let noteConflicts = 0
  for (const [id, inc] of Object.entries(incoming)) {
    const mine = merged[id]
    if (mine === undefined) {
      merged[id] = inc
      added += 1
      continue
    }
    if (mine.note.trim().length > 0 && inc.note.trim().length > 0 && mine.note !== inc.note) noteConflicts += 1
    const next = mergeRecord(mine, inc)
    if (JSON.stringify(next) === JSON.stringify(mine)) unchanged += 1
    else updated += 1
    merged[id] = next
  }
  return {
    kind: 'ok',
    records: merged,
    report: {
      incoming: Object.keys(incoming).length,
      added,
      updated,
      unchanged,
      noteConflicts,
      dropped: outcome.dropped,
      fromVersion: declared,
      steps: outcome.steps,
    },
  }
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}
function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/**
 * 同一条记录的两侧合并。逐字段规则（都是为「幂等」与「不丢学生东西」服务的）：
 *   lastAt / attempts / wrongCount / lastWrongAt / wrongDismissedAt → 取较大值。
 *     attempts 用 max 而不是相加：两边极可能是同一份历史的两份快照（换机器前导出的那份
 *     和留在本机的那份），相加会把一次提交数成两次，正确率随之失真；max 让重复导入不改变结果。
 *   everPassed / starred → 取或：这两件事发生过就是发生过，任何一侧都不该把它抹掉。
 *   firstPassedAt / firstAttemptAt → 取较小的非空值：「首次」只有一个真值，早的那侧说了算。
 *   result / lastAnswer / selfAssessed → 取 lastAt 较新一侧（平局取本地）：它们描述的是
 *     「最近一次」的状态，混用两侧会得到自相矛盾的记录。
 *   note → 两侧都有且不同则保留较新一侧，并由 report.noteConflicts 如实计数（不拼接：
 *     拼接会让重复导入把笔记越滚越长）。
 */
export function mergeRecord(a: AttemptRecord, b: AttemptRecord): AttemptRecord {
  const win = b.lastAt > a.lastAt ? b : a
  const lose = win === a ? b : a
  const answer = win.lastAnswer ?? lose.lastAnswer
  const answerFromWin = win.lastAnswer !== null
  const note = pickNote(a, b, win)
  return {
    result: win.result,
    attempts: Math.max(a.attempts, b.attempts),
    everPassed: a.everPassed || b.everPassed,
    firstPassedAt: minNullable(a.firstPassedAt, b.firstPassedAt),
    firstAttemptAt: Math.min(a.firstAttemptAt, b.firstAttemptAt),
    lastAt: Math.max(a.lastAt, b.lastAt),
    wrongCount: Math.max(a.wrongCount, b.wrongCount),
    lastWrongAt: maxNullable(a.lastWrongAt, b.lastWrongAt),
    wrongDismissedAt: maxNullable(a.wrongDismissedAt, b.wrongDismissedAt),
    lastAnswer: answer,
    lastAnswerKind: answer === null ? null : answerFromWin ? win.lastAnswerKind : lose.lastAnswerKind,
    lastAnswerTruncated: answer === null ? false : answerFromWin ? win.lastAnswerTruncated : lose.lastAnswerTruncated,
    starred: a.starred || b.starred,
    note,
    selfAssessed: win.selfAssessed,
  }
}

function pickNote(a: AttemptRecord, b: AttemptRecord, win: AttemptRecord): string {
  const an = a.note.trim()
  const bn = b.note.trim()
  if (an.length === 0) return b.note
  if (bn.length === 0) return a.note
  if (an === bn) return a.note
  return win.note
}
