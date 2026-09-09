/**
 * 答题进度的**轻量**记录（阶段 4 模块 5）。
 *
 * 立项时的现状核查（2026-09-09）：`PROGRESS_KEY` 自阶段 1 在 app/config.ts 里定义以来，
 * 全仓没有任何一处写入 —— 模块 1-4 的判分结论只活在组件 state 里，刷新即丢，
 * 列表页无从显示「已通过 / 尝试过未通过」。本文件补的就是这一段最小写入端。
 *
 * 边界（用户明令：本轮不做阶段 5 的进度体系）：
 *   ✗ 不做错题本、收藏、按章节统计、正确率、导出 / 导入、schemaVersion 迁移
 *   ✓ 只存「每题最近一次有结论的判分结果 + 是否曾经通过 + 提交次数 + 时间戳」
 *   ✓ 只被列表页读来打三色状态标记
 *
 * 诚实性红线（AGENTS.md 二·5、二·7 同源）：后端抖动 = 「未判定」，不是「答错」。
 * 未判定一律**不写记录**：既不能把学生标成「尝试过未通过」，更不能标成「已通过」。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PROGRESS_KEY } from '../../../app/config'
import type { TestCaseResult } from '../../../judge/types'
import { isInconclusive } from '../verdict-meta'

/** passed = 该次判分全绿；attempted = 拿到了确证的失败结论（输出不符 / 编译错 / 崩溃 / 超时） */
export type AttemptResult = 'passed' | 'attempted'

/** 列表页三色标记：未做 / 尝试过未通过 / 已通过 */
export type ListStatus = 'todo' | 'attempted' | 'passed'

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
  /** 最近一次有结论的提交的 epoch ms */
  lastAt: number
}

export type ProgressMap = Record<string, AttemptRecord>

interface ProgressState {
  records: ProgressMap
  record: (id: string, result: AttemptResult) => void
  /** 阶段 5 的「清空进度」会用；本轮验收脚本直接清 localStorage */
  clear: () => void
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      records: {},
      record: (id, result) =>
        set((state) => {
          const prev = state.records[id]
          const now = Date.now()
          const next: AttemptRecord = {
            result,
            attempts: (prev?.attempts ?? 0) + 1,
            everPassed: (prev?.everPassed ?? false) || result === 'passed',
            firstPassedAt: prev?.firstPassedAt ?? (result === 'passed' ? now : null),
            lastAt: now,
          }
          return { records: { ...state.records, [id]: next } }
        }),
      clear: () => set({ records: {} }),
    }),
    // 与 theme.ts 同一套持久化口径：只持久化数据字段，方法不进 localStorage
    { name: PROGRESS_KEY, partialize: (s) => ({ records: s.records }) },
  ),
)

/** 三色状态的唯一推导处：列表页与后续阶段都走这里，不要各自 if */
export function statusOf(record: AttemptRecord | undefined): ListStatus {
  if (!record) return 'todo'
  return record.everPassed ? 'passed' : 'attempted'
}

/**
 * 本地判分（程序阅读写结果：纯文本归一化比对，无网络）的记录入口。
 * 传进来的必须是**已生效的判分结论**；不可判分（answer 为空的数据缺陷题）由调用方自己拦住。
 */
export function recordAttempt(id: string, passed: boolean): void {
  if (id.length === 0) return
  useProgress.getState().record(id, passed ? 'passed' : 'attempted')
}

/**
 * 批量判分（编程题 / 程序填空 / 程序改错）的记录入口。口径：
 *   · 全部用例 accepted                    → passed
 *   · 存在任一确证失败（非未判定）          → attempted
 *   · 只有 accepted + 未判定、无确证失败    → **不记录**（整批仍属未判定）
 *   · 全部未判定                            → **不记录**
 */
export function recordBatchAttempt(id: string, results: TestCaseResult[]): void {
  if (id.length === 0 || results.length === 0) return
  const conclusive = results.filter((r) => !isInconclusive(r.response.state))
  if (conclusive.length === 0) return
  if (results.every((r) => r.response.state === 'accepted')) {
    recordAttempt(id, true)
    return
  }
  if (conclusive.some((r) => r.response.state !== 'accepted')) recordAttempt(id, false)
}
