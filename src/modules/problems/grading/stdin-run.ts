/**
 * stdin 驱动的编程题判分入口（阶段 4 模块 1）。
 *
 * 本文件**不重新实现任何判分逻辑**，只做「UI 形状适配 + 最后一道异常防线」。分工是：
 *   串行 / 节流 / 缓存 / 跨标签页互斥 / 降级  → JudgeClient.runTests（src/judge/client.ts）
 *   归一化（CRLF→LF、剥行尾空白、剥末尾换行）与比对、firstDiffLine
 *                                             → src/judge/backends/base.ts
 *   事实分类 buildResult.code≠0→compile-error ▸ timedOut→timeout ▸ 退出码≠0→RE ▸ truncated
 *                                             → src/judge/backends/godbolt.ts 的 classify()
 *   判分结论与文案                            → client.ts 的 verdict()（纯函数）
 *
 * 多组用例一律严格串行（runTests 内部是 for await，不并发），
 * 依据 ADR-0001 4.3：Godbolt 并发越高吞吐越低，并发 20 时从 1.36 跌到 0.52 QPS。
 */
import { getBackend } from '../../../judge'
import { JudgeClient } from '../../../judge/client'
import type { PrecomputedLookup, ProblemTestCase } from '../../../judge/client'
import { JudgeTransportError } from '../../../judge/types'
import type { BatchReport, JudgeBackend, QueueStatus } from '../../../judge/types'
import type { TestCaseData } from '../data/loader'

/** 透传给 UI 的进度：caseIndex 1 起，是「正在跑」的那一组 */
export interface RunProgress {
  caseIndex: number
  total: number
  status: QueueStatus
}

export type StdinRunResult =
  | { kind: 'done'; report: BatchReport }
  /**
   * 未预期异常（AGENTS.md 裁决 6 的同款处理）：runTests 已经把「传输故障」转成降级响应，
   * 这里兜的是它兜不住的（进度回调抛错、判分纯函数抛错、题库数据形状不对）。
   * 一律按「后端不可用」显示且**不重试** —— 成因未知的异常自动重放只会把同一个 bug 再撞一遍，
   * 并且绝不给出「通过」。
   */
  | { kind: 'error'; summary: string }

export interface JudgeClientOptions {
  /** 构建期预存输出的查询函数；缺省表示本题没有降级数据（48 道编程题 reference 全空即属此类） */
  precomputed?: PrecomputedLookup
  onStatus?: (status: QueueStatus) => void
  /** 单测/联调注入替身后端；缺省走 getBackend() 读 config.judge.backend */
  backend?: JudgeBackend
}

/** 一个题目页持有一个 client：结果缓存跨提交复用，同一份代码重复提交不再打网络 */
export function createJudgeClient(options: JudgeClientOptions = {}): JudgeClient {
  return new JudgeClient(options.backend ?? getBackend(), {
    precomputed: options.precomputed,
    onStatus: options.onStatus,
  })
}

/**
 * 题库 testCases → 判分层 ProblemTestCase。
 * stdin 缺失必须补空串而不是 undefined：RunRequest.stdin 的契约如此，
 * 传 undefined 会让 Godbolt 侧 scanf 读不到输入却仍返回 HTTP 200（ADR-0001 坑 2 同源）。
 */
export function toProblemTestCases(cases: TestCaseData[] | undefined): ProblemTestCase[] {
  if (!Array.isArray(cases)) return []
  return cases.map((c) => ({
    stdin: typeof c.stdin === 'string' ? c.stdin : '',
    expected: typeof c.expected === 'string' ? c.expected : '',
    note: typeof c.note === 'string' ? c.note : undefined,
  }))
}

/**
 * 看门狗（阶段 4 模块 2 补，2026-09-08 用户明令「顺带修掉」）。
 *
 * 事故现场：模块 1 验收首次复跑时页面卡死 200 s，期间 Godbolt 请求数 = 0、
 * 「第 N/M 组」进度文案从未出现，25 s 软超时形同虚设 —— 它只管**已发出的 fetch**，
 * 请求根本没发出时没人在计时（疑为 Vite 首次懒加载判分 chunk 的冷转换）。
 * 所以看门狗量的是「多久没有任何心跳」而不是「总共跑了多久」：
 *   FIRST 首个进度事件之前的等待上限。正常提交毫秒级就该有第一组心跳。
 *   STALL 相邻两次心跳之间的停滞上限，必须 > 单组最坏耗时
 *         （软超时 25 s + client.ts 的 1 次重试退避 800 ms + 再 25 s ≈ 51 s），
 *         否则会把「合法的慢」误杀成「后端未响应」。
 * 触发后走既有的「未判定」路径：不计正确率、不置 verified、绝不显示「通过」。
 */
export const WATCHDOG_FIRST_MS = 30_000
export const WATCHDOG_STALL_MS = 70_000
const WATCHDOG_TICK_MS = 1_000

/** 与 JudgeTransportError 同源但文案不同：这是「后端没响应」，不是「后端说它挂了」 */
export class JudgeWatchdogError extends JudgeTransportError {
  constructor(message: string) {
    super('busy', message, { retryable: false })
    this.name = 'JudgeWatchdogError'
  }
}

/** 逐组串行执行，onProgress 在每组**开始前**触发，用于「第 N/M 组」显示 */
export async function runStdinTests(
  client: JudgeClient,
  code: string,
  testCases: ProblemTestCase[],
  onProgress?: (progress: RunProgress) => void,
): Promise<StdinRunResult> {
  if (testCases.length === 0) {
    return { kind: 'error', summary: '本题没有可用的测试用例，无法判分（数据缺陷，请联系维护者）' }
  }
  let lastBeatAt = Date.now()
  let started = false
  // 看门狗触发后 runTests 仍在后台跑（Promise.race 不取消它），
  // 迟到的进度回调必须丢掉，否则错误面板下面会又冒出「第 N/M 组执行中」。
  let settled = false
  const handleProgress = (progress: RunProgress): void => {
    if (settled) return
    started = true
    lastBeatAt = Date.now()
    onProgress?.(progress)
  }
  let timer: ReturnType<typeof setInterval> | null = null
  // guard 的 rejection 由 Promise.race 订阅，且 finally 里必然 clearInterval，不会留下未处理拒绝
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setInterval(() => {
      const idleMs = Date.now() - lastBeatAt
      const limit = started ? WATCHDOG_STALL_MS : WATCHDOG_FIRST_MS
      if (idleMs < limit) return
      reject(
        new JudgeWatchdogError(
          started
            ? `已 ${Math.round(idleMs / 1000)} s 没有新的心跳（单组停滞上限 ${Math.round(limit / 1000)} s）`
            : `提交后 ${Math.round(idleMs / 1000)} s 内后端毫无响应，请求可能根本没发出（首响应上限 ${Math.round(limit / 1000)} s）`,
        ),
      )
    }, WATCHDOG_TICK_MS)
  })
  try {
    const report = await Promise.race([client.runTests(code, testCases, handleProgress), guard])
    return { kind: 'done', report }
  } catch (error) {
    return { kind: 'error', summary: describeJudgeFailure(error) }
  } finally {
    settled = true
    if (timer !== null) clearInterval(timer)
  }
}

export function describeJudgeFailure(error: unknown): string {
  // 子类必须放在前面判，否则会被 JudgeTransportError 分支吃掉
  if (error instanceof JudgeWatchdogError) {
    return `判分后端未响应，看门狗已中止本次提交：${error.message}。本次未判定，不计正确率、不置 verified`
  }
  if (error instanceof JudgeTransportError) {
    return `判分后端不可用（${error.kind}：${error.message}），本次未判定，不计正确率`
  }
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return `判分流程出现未预期异常：${detail}。本次未判定，不计正确率`
}