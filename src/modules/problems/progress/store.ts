/**
 * 答题进度的**唯一写入端**（阶段 5 完整体系）。
 *
 * 阶段 4 模块 5 只有「最近结论 + 是否曾通过 + 次数 + 时间戳」的最小写侧；本轮补齐：
 * 首/末尝试时间、错误次数、错题本移除时刻、最后一次提交内容、收藏、个人笔记、自评标记，
 * 以及 schemaVersion 迁移链（schema.ts）与备份式落盘（storage.ts）。
 *
 * ── 对外契约（阶段 4 已交付的调用方一行都不用改）─────────────────────────
 *   statusOf / useProgress / recordAttempt / recordBatchAttempt / ListStatus / AttemptResult
 * ProblemListPage 的三色标记、四个代码渲染器的判分落盘都走这几个入口，签名保持不变，
 * 新增能力一律以**可选参数**或**新 action** 的形式追加。
 *
 * ── 诚实性红线（AGENTS.md 二·5、二·7 同源）──────────────────────────────
 *   · 未判定（后端 5xx / 网络失败 / 输出截断 / 看门狗中止）**不写任何记录**：
 *     既不能把学生标成「尝试过未通过」，更不能标成「已通过」；
 *   · 简答题的自评走 selfAssess()，它只动结论字段、**不动 attempts / wrongCount**，
 *     所以「机器判分正确率」永远不被自评污染（stats.ts 的口径依赖这一点）。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { PROGRESS_KEY } from '../../../app/config'
import type { TestCaseResult } from '../../../judge/types'
import { isInconclusive } from '../verdict-meta'
import {
  MAX_NOTE,
  MAX_STORED_ANSWER,
  PROGRESS_SCHEMA_VERSION,
  emptyRecord,
  migrateRecords,
} from './schema'
import type { AnswerKind, AttemptRecord, AttemptResult, ProgressMap } from './schema'
import { progressStorage } from './storage'

export type { AnswerKind, AttemptRecord, AttemptResult, ProgressMap } from './schema'
export { PROGRESS_SCHEMA_VERSION } from './schema'

/** 列表页三色标记：未做 / 尝试过未通过 / 已通过 */
export type ListStatus = 'todo' | 'attempted' | 'passed'

/** 一次提交要顺带存档的内容（回看用）。kind 决定 UI 怎么渲染它 */
export interface AttemptAnswer {
  text: string
  kind: AnswerKind
}

interface ProgressState {
  records: ProgressMap
  /** 记一次「有结论」的判分。answer 可省略（阶段 4 的调用方就是两参形式） */
  record: (id: string, result: AttemptResult, answer?: AttemptAnswer | null) => void
  /** 简答题自评：只动结论字段，不动 attempts / wrongCount（口径见文件头） */
  selfAssess: (id: string, passed: boolean, answer?: AttemptAnswer | null) => void
  setStarred: (id: string, starred: boolean) => void
  setNote: (id: string, note: string) => void
  /** 「我已掌握」：记移除时刻，题离开错题本；之后又做错会自动回来（比时刻，不存布尔） */
  dismissWrong: (id: string) => void
  undoDismissWrong: (id: string) => void
  /** 导入：整表替换（合并策略在 transfer.ts 里算好再传进来） */
  replaceAll: (records: ProgressMap) => void
  clear: () => void
}

/** 只碰结论字段的公共部分：自评与机器判分都要更新这些 */
function touch(record: AttemptRecord, prev: AttemptRecord | undefined, now: number, passed: boolean): AttemptRecord {
  return {
    ...record,
    result: passed ? 'passed' : 'attempted',
    everPassed: (prev?.everPassed ?? false) || passed,
    firstPassedAt: prev?.firstPassedAt ?? (passed ? now : null),
    firstAttemptAt: prev ? prev.firstAttemptAt : now,
    lastAt: now,
  }
}

/** 存档最后一次提交：超长截断并如实标注，绝不静默丢掉后半截当成完整代码 */
function withAnswer(record: AttemptRecord, answer: AttemptAnswer | null | undefined): AttemptRecord {
  if (answer === null || answer === undefined) return record
  const text = answer.text.slice(0, MAX_STORED_ANSWER)
  return {
    ...record,
    lastAnswer: text,
    lastAnswerKind: answer.kind,
    lastAnswerTruncated: answer.text.length > MAX_STORED_ANSWER,
  }
}

/** 没有记录时也要能建一条「只用来放收藏/笔记」的空壳（attempts=0，不算做过） */
function baseOf(prev: AttemptRecord | undefined, now: number): AttemptRecord {
  return prev ? { ...prev } : emptyRecord(now)
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      records: {},

      record: (id, result, answer) =>
        set((state) => {
          if (id.length === 0) return state
          const now = Date.now()
          const prev = state.records[id]
          const passed = result === 'passed'
          const base = baseOf(prev, now)
          const next = withAnswer(
            {
              ...touch(base, prev, now, passed),
              attempts: base.attempts + 1,
              // 失败才累加错误计数；通过不动它，错题本靠 lastWrongAt 与 result 判断
              wrongCount: base.wrongCount + (passed ? 0 : 1),
              lastWrongAt: passed ? base.lastWrongAt : now,
              selfAssessed: false,
            },
            answer,
          )
          return { records: { ...state.records, [id]: next } }
        }),

      selfAssess: (id, passed, answer) =>
        set((state) => {
          if (id.length === 0) return state
          const now = Date.now()
          const prev = state.records[id]
          const base = baseOf(prev, now)
          const next = withAnswer(
            { ...touch(base, prev, now, passed), selfAssessed: true },
            answer,
          )
          return { records: { ...state.records, [id]: next } }
        }),

      setStarred: (id, starred) =>
        set((state) => {
          if (id.length === 0) return state
          const prev = state.records[id]
          const base = baseOf(prev, Date.now())
          return { records: { ...state.records, [id]: { ...base, starred } } }
        }),

      setNote: (id, note) =>
        set((state) => {
          if (id.length === 0) return state
          const prev = state.records[id]
          const base = baseOf(prev, Date.now())
          return { records: { ...state.records, [id]: { ...base, note: note.slice(0, MAX_NOTE) } } }
        }),

      dismissWrong: (id) =>
        set((state) => {
          const prev = state.records[id]
          if (prev === undefined) return state
          return { records: { ...state.records, [id]: { ...prev, wrongDismissedAt: Date.now() } } }
        }),

      undoDismissWrong: (id) =>
        set((state) => {
          const prev = state.records[id]
          if (prev === undefined || prev.wrongDismissedAt === null) return state
          return { records: { ...state.records, [id]: { ...prev, wrongDismissedAt: null } } }
        }),

      replaceAll: (records) => set({ records }),
      clear: () => set({ records: {} }),
    }),
    {
      name: PROGRESS_KEY,
      version: PROGRESS_SCHEMA_VERSION,
      // 与 theme.ts 同一套口径：只持久化数据字段，方法不进 localStorage
      partialize: (s) => ({ records: s.records }),
      storage: createJSONStorage(() => progressStorage),
      /**
       * 第二道防线。正常路径下 storage.getItem 已经把信封洗成当前版本，这里不会被调用；
       * 万一有人把 storage 换回默认实现（或测试里直接塞 state），迁移链仍然生效。
       */
      migrate: (persisted: unknown, version: number) => {
        const raw = typeof persisted === 'object' && persisted !== null ? (persisted as Record<string, unknown>) : {}
        const outcome = migrateRecords(raw.records, version)
        return { records: outcome.kind === 'ok' ? outcome.records : {} }
      },
    },
  ),
)

/**
 * 三色状态的唯一推导处：列表页、进度页、错题本都走这里，不要各自 if。
 *   attempts=0 且没自评过 → 只可能是「收藏/笔记」留下的空壳，仍算未做
 */
export function statusOf(record: AttemptRecord | undefined): ListStatus {
  if (!record) return 'todo'
  if (record.everPassed) return 'passed'
  if (record.attempts > 0 || record.selfAssessed) return 'attempted'
  return 'todo'
}

/**
 * 本地判分（程序阅读写结果 / 选择题 / 概念填空）的记录入口：纯前端比对、无网络。
 * 传进来的必须是**已生效的判分结论**；不可判分（answer 为空的数据缺陷题）由调用方自己拦住。
 */
export function recordAttempt(id: string, passed: boolean, answer?: AttemptAnswer | null): void {
  if (id.length === 0) return
  useProgress.getState().record(id, passed ? 'passed' : 'attempted', answer)
}

/** 简答题等「不自动判分」题型的自评入口 */
export function recordSelfAssessment(id: string, passed: boolean, answer?: AttemptAnswer | null): void {
  if (id.length === 0) return
  useProgress.getState().selfAssess(id, passed, answer)
}

/**
 * 批量判分（编程题 / 程序填空 / 程序改错）的记录入口。口径：
 *   · 全部用例 accepted                    → passed
 *   · 存在任一确证失败（非未判定）          → attempted
 *   · 只有 accepted + 未判定、无确证失败    → **不记录**（整批仍属未判定）
 *   · 全部未判定                            → **不记录**
 */
export function recordBatchAttempt(id: string, results: TestCaseResult[], answer?: AttemptAnswer | null): void {
  if (id.length === 0 || results.length === 0) return
  const conclusive = results.filter((r) => !isInconclusive(r.response.state))
  if (conclusive.length === 0) return
  if (results.every((r) => r.response.state === 'accepted')) {
    recordAttempt(id, true, answer)
    return
  }
  if (conclusive.some((r) => r.response.state !== 'accepted')) recordAttempt(id, false, answer)
}