/**
 * 进度数据的**结构与版本**（阶段 5 核心）。
 *
 * ── 为什么版本号必须现在就有 ──────────────────────────────────────────
 * 进度只活在浏览器 localStorage 里，没有服务端可以对账。一旦结构变了而没有版本号，
 * 老用户的数据就变成「读得出来但字段含义不对」的脏数据 —— 那种损坏是静默的：
 * 页面照常渲染，只是数字全错，而且再也无法恢复（不知道手上这份是哪一版）。
 * 所以本文件把三件事钉死：
 *   1. PROGRESS_SCHEMA_VERSION 是唯一真源，写盘（localStorage 信封）与导出文件都用它；
 *   2. MIGRATIONS 是一条**只能往前走**的链，每步 from→to 必须相邻，缺环即视为不可迁移；
 *   3. 版本不认识时（比当前新 / 链断了）**先把原文备份再重置**，绝不直接清空。
 *
 * ── 键名里的 v1 与这里的版本号不是一回事 ──────────────────────────────
 * app/config.ts 的 PROGRESS_KEY = 'cpractice:progress:v1'，那个 v1 是**存储槽代号**，
 * 永不改动（改了等于把老数据丢在旧槽里）。数据结构版本走本文件的 PROGRESS_SCHEMA_VERSION，
 * 存在 zustand persist 信封的 version 字段里。槽不动、版本升，才能原地迁移。
 *
 * ── 诚实性红线（与 AGENTS.md 二·5 / 二·7 同源）────────────────────────
 * 「未判定」（后端 5xx / 网络失败 / 截断）不写任何记录，因此本结构里没有
 * 「后端挂了」这种状态：记录只在拿到确证结论时才产生或更新。
 */

/**
 * 进度数据模型版本。
 *   0 = 阶段 4 模块 5 的最小写侧（zustand persist 未显式给 version，默认落 0）：
 *       { result, attempts, everPassed, firstPassedAt, lastAt }
 *   1 = 阶段 5 完整体系：加首/末尝试时间、错误次数、错题本移除时刻、
 *       最后一次提交内容、收藏、个人笔记、自评标记
 * 每次改结构就 +1 并在 MIGRATIONS 末尾追加一步，禁止原地修改已有步骤的语义。
 */
export const PROGRESS_SCHEMA_VERSION = 1

/** passed = 该次判分全绿；attempted = 拿到了确证的失败结论（输出不符 / 编译错 / 崩溃 / 超时） */
export type AttemptResult = 'passed' | 'attempted'

/**
 * 最后一次提交内容的形态，决定「回看上次作答」怎么渲染：
 *   code   C 源码（编程 / 填空 / 改错）—— 等宽 + 保留换行
 *   text   纯文本（阅读题写结果 / 概念填空 / 复杂度）
 *   choice 选项编号（选择题 / 判断题 / 匹配题），存的是人类可读的一行摘要
 *   self   简答题自评，存的不是答案而是自评结论
 */
export type AnswerKind = 'code' | 'text' | 'choice' | 'self'

/** localStorage 有 ~5 MB 上限，518 道题都存代码也吃不下太多，故逐项设上限（超出即截断并标注） */
export const MAX_STORED_ANSWER = 4000
export const MAX_NOTE = 2000

export interface AttemptRecord {
  /** 最近一次「有结论」的判分结果 */
  result: AttemptResult
  /** 拿到结论的提交次数（未判定不计入） */
  attempts: number
  /**
   * 是否曾经全绿通过。一旦为 true 就不再回退：
   * 学生做对过后又改坏重交，教学上不该把「已掌握」抹成「未通过」。
   */
  everPassed: boolean
  /** 首次通过的 epoch ms；从未通过为 null */
  firstPassedAt: number | null
  /** 首次拿到确证结论的 epoch ms（v1 新增；从 v0 迁移时只能取 lastAt，见 MIGRATIONS） */
  firstAttemptAt: number
  /** 最近一次有结论的提交的 epoch ms */
  lastAt: number
  /** 累计确证失败次数（v1 新增）：错题本要显示「错了几次」 */
  wrongCount: number
  /** 最近一次确证失败的 epoch ms；从未失败为 null（v1 新增） */
  lastWrongAt: number | null
  /**
   * 「我已掌握，从错题本移除」的时刻；未移除为 null（v1 新增）。
   * 与 lastWrongAt 比大小而不是存布尔：移除之后**又做错**（lastWrongAt 更新到更晚）
   * 就该重新回错题本，用时刻比较天然表达这件事，不需要额外状态机。
   */
  wrongDismissedAt: number | null
  /** 最后一次提交的内容（代码 / 答案文本 / 选项摘要），截断保存；无则 null（v1 新增） */
  lastAnswer: string | null
  /** lastAnswer 的形态；lastAnswer 为 null 时同为 null（v1 新增） */
  lastAnswerKind: AnswerKind | null
  /** lastAnswer 是否被 MAX_STORED_ANSWER 截断过（v1 新增）：回看时要如实说明不完整 */
  lastAnswerTruncated: boolean
  /** 是否已收藏（v1 新增） */
  starred: boolean
  /** 个人笔记（v1 新增），空串表示没写 */
  note: string
  /**
   * 最近一次结论来自学生自评而非机器判分（v1 新增，简答题用）。
   * 统计里单列出来：自评的「通过」与实机判分的「通过」不是一回事，不能混在一个正确率里蒙人。
   */
  selfAssessed: boolean
}

export type ProgressMap = Record<string, AttemptRecord>

export function emptyRecord(now: number): AttemptRecord {
  return {
    result: 'attempted',
    attempts: 0,
    everPassed: false,
    firstPassedAt: null,
    firstAttemptAt: now,
    lastAt: now,
    wrongCount: 0,
    lastWrongAt: null,
    wrongDismissedAt: null,
    lastAnswer: null,
    lastAnswerKind: null,
    lastAnswerTruncated: false,
    starred: false,
    note: '',
    selfAssessed: false,
  }
}

const ANSWER_KINDS: ReadonlySet<string> = new Set<AnswerKind>(['code', 'text', 'choice', 'self'])

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}
function nullableStr(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  return value.slice(0, max)
}

/**
 * 把任意来源（localStorage / 导入文件 / 上一版迁移结果）的一条记录洗成当前版本形状。
 *
 * 返回 null = 这条不是记录（不是对象 / 缺关键时间戳），调用方直接丢弃。
 * **不做合法性审判**：导入的数据即使数字离谱也照单收下，只保证类型正确 ——
 * 进度是学生自己的东西，宁可显示一个怪数字，也不要静默删掉他的记录。
 */
export function sanitizeRecord(raw: unknown): AttemptRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const lastAt = nullableNum(r.lastAt)
  const firstAttemptAt = nullableNum(r.firstAttemptAt) ?? lastAt
  if (lastAt === null && firstAttemptAt === null) return null
  const anchor = lastAt ?? firstAttemptAt ?? 0
  const lastAnswer = nullableStr(r.lastAnswer, MAX_STORED_ANSWER)
  const kindRaw = r.lastAnswerKind
  const lastAnswerKind = typeof kindRaw === 'string' && ANSWER_KINDS.has(kindRaw) ? (kindRaw as AnswerKind) : null
  return {
    result: r.result === 'passed' ? 'passed' : 'attempted',
    attempts: Math.max(0, Math.round(num(r.attempts, 0))),
    everPassed: r.everPassed === true,
    firstPassedAt: nullableNum(r.firstPassedAt),
    firstAttemptAt: firstAttemptAt ?? anchor,
    lastAt: lastAt ?? anchor,
    wrongCount: Math.max(0, Math.round(num(r.wrongCount, 0))),
    lastWrongAt: nullableNum(r.lastWrongAt),
    wrongDismissedAt: nullableNum(r.wrongDismissedAt),
    lastAnswer,
    lastAnswerKind: lastAnswer === null ? null : lastAnswerKind ?? 'text',
    lastAnswerTruncated: r.lastAnswerTruncated === true,
    starred: r.starred === true,
    note: str(r.note, MAX_NOTE),
    selfAssessed: r.selfAssessed === true,
  }
}

/** 洗一整张表：键必须是非空字符串，值必须能洗成记录，其余丢弃并计数（用于导入报告） */
export function sanitizeMap(raw: unknown): { records: ProgressMap; dropped: number } {
  const records: ProgressMap = {}
  let dropped = 0
  if (typeof raw !== 'object' || raw === null) return { records, dropped: 1 }
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (id.length === 0) {
      dropped += 1
      continue
    }
    const record = sanitizeRecord(value)
    if (record === null) dropped += 1
    else records[id] = record
  }
  return { records, dropped }
}

export interface MigrationStep {
  from: number
  to: number
  /** 入参是上一版的原始记录表（未洗），出参交给下一步或 sanitizeMap */
  run: (records: Record<string, unknown>) => Record<string, unknown>
}

/**
 * 迁移链。**只允许追加，不允许改写已发布的步骤** —— 老用户手上可能正是某一版的形状，
 * 改了历史步骤就等于把他的数据解释错。
 */
export const MIGRATIONS: readonly MigrationStep[] = [
  {
    from: 0,
    to: 1,
    run: (records) => {
      const out: Record<string, unknown> = {}
      for (const [id, value] of Object.entries(records)) {
        if (typeof value !== 'object' || value === null) continue
        const r = value as Record<string, unknown>
        const attempts = num(r.attempts, 0)
        const everPassed = r.everPassed === true
        const lastAt = num(r.lastAt, 0)
        out[id] = {
          ...r,
          // v0 没记首次尝试时间，能拿到的最好近似就是最近一次（迁移是有损的，如实标注在注释里）
          firstAttemptAt: lastAt,
          // v0 只记了「有结论的提交次数」与「是否曾通过」：
          // 从未通过 → 每次提交都是失败；曾通过 → 至多有一次是通过，其余算失败
          wrongCount: everPassed ? Math.max(0, attempts - 1) : attempts,
          lastWrongAt: everPassed ? null : lastAt || null,
          wrongDismissedAt: null,
          lastAnswer: null,
          lastAnswerKind: null,
          lastAnswerTruncated: false,
          starred: false,
          note: '',
          selfAssessed: false,
        }
      }
      return out
    },
  },
]

export type MigrateOutcome =
  | { kind: 'ok'; records: ProgressMap; steps: number[]; dropped: number }
  /** 数据比当前程序新（用户回滚了版本）：不猜含义，备份后重置 */
  | { kind: 'newer-version'; from: number }
  /** 版本号在链上找不到落点（缺环 / 非法数字）：同样备份后重置 */
  | { kind: 'unknown-version'; from: number | null }

/**
 * 从任意版本迁移到 PROGRESS_SCHEMA_VERSION。
 * 认识就一步步走链；不认识就返回失败原因，由调用方决定备份与重置（本函数不碰存储）。
 */
export function migrateRecords(rawRecords: unknown, fromVersion: unknown): MigrateOutcome {
  const from = typeof fromVersion === 'number' && Number.isFinite(fromVersion) ? Math.trunc(fromVersion) : null
  if (from === null) return { kind: 'unknown-version', from: null }
  if (from > PROGRESS_SCHEMA_VERSION) return { kind: 'newer-version', from }
  let current: Record<string, unknown> =
    typeof rawRecords === 'object' && rawRecords !== null ? (rawRecords as Record<string, unknown>) : {}
  const steps: number[] = []
  let version = from
  while (version < PROGRESS_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version)
    if (!step || step.to !== version + 1) return { kind: 'unknown-version', from }
    current = step.run(current) as Record<string, unknown>
    steps.push(step.to)
    version = step.to
  }
  const { records, dropped } = sanitizeMap(current)
  return { kind: 'ok', records, steps, dropped }
}

