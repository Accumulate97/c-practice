/**
 * 程序阅读题（code_reading）判分（阶段 4 模块 2）。
 *
 * 分工铁律，与 grading/stdin-run.ts 同源 —— 判分规则一行都不重写：
 *   归一化（CRLF→LF、逐行剥行尾空白、剥末尾换行）/ 逐行比对 / firstDiffLine
 *                                     -> src/judge/backends/base.ts
 *   事实分类 buildResult.code!=0 -> compile-error ▸ timedOut -> timeout ▸ 退出码!=0 -> RE ▸ truncated
 *                                     -> src/judge/backends/godbolt.ts 的 classify()
 *   didExecute !== true 抛传输层错误（无 execResult 兜底）-> 同上；本文件对 truncated 再断言一次
 *   串行 / 节流 / 缓存 / 跨标签页互斥 / 降级 -> JudgeClient.runTests
 *
 * 【为什么阅读题的主判分路径不联网】（2026-09-08 实测数据，非猜测）
 *   225 道 code_reading 里 48 道的程序要读 stdin，而题库**没有存任何 stdin**：
 *   schema 的 code_reading 只有 code + answer，testCases 一律缺失。
 *   真跑这些程序只会得到 scanf 撞 EOF 后的垃圾输出，拿它当 expected 会把对的答案判成错的
 *   （冒烟样例 c-ch09-cr-044 正是这一类：题干里用「5□4□3□6＜回车＞」描述输入，数据里没有）。
 *   而 answer 本身就是提取阶段用 Godbolt 实机取证的 stdout
 *   （证据存档 public/data/problems/_judge-evidence.json 的 runtimeStdout，206/206 命中），
 *   所以主路径 = 学生文本 vs 这份已取证的预存 stdout：纯函数、离线、确定，不可能伪造「通过」。
 *   实机运行只作**可选的二次对照**（runReadingSelfCheck），对读输入的题直接禁用，
 *   且它的结论永不覆盖主判分。
 */
import {
  firstDiffLine,
  matchOutput,
  normalizeExpected,
  normalizeOutput,
} from '../../../judge/backends/base'
import type { JudgeClient, ProblemTestCase } from '../../../judge/client'
import type { ResultState, TestCaseResult } from '../../../judge/types'
import type { ProblemRecord } from '../data/loader'
import { isInconclusive } from '../verdict-meta'
import { runStdinTests } from './stdin-run'

/**
 * 读输入的程序。注意 \b 的用法：sscanf / fscanf 不会被 \bscanf 命中
 * （它们不从 stdin 读，撞不到 EOF 垃圾输出的问题）。
 */
const READS_STDIN = /\b(?:scanf|getchar|getc|gets|fgets|getche|getw)\s*\(/

/** 题库没存 stdin，实机对照对这类题无意义 -> UI 直接禁用按钮并说明原因 */
export function needsStdin(code: string): boolean {
  return READS_STDIN.test(code)
}

export type ReadingTarget =
  | { kind: 'ok'; code: string; expected: string; stdin: string; runnableLive: boolean; blockedReason?: string }
  /** 19 道 answer 为空（含 c-ch04-cr-004 的 answerIsDescription）：没有 expected 就无法判分 */
  | { kind: 'no-answer'; code: string; isDescription: boolean }
  | { kind: 'no-code' }

export function readingTarget(problem: ProblemRecord): ReadingTarget {
  const code = typeof problem.code === 'string' ? problem.code : ''
  const expected = typeof problem.answer === 'string' ? problem.answer : ''
  // 与 scripts/lib/problem-code.ts 同口径：stdin 是 Schema 的可选字段，缺失按空串。
  const stdin = typeof problem.stdin === 'string' ? problem.stdin : ''
  const isDescription = problem.answerIsDescription === true
  if (code.trim().length === 0) return { kind: 'no-code' }
  if (expected.trim().length === 0) return { kind: 'no-answer', code, isDescription }
  if (needsStdin(code) && stdin.length === 0) {
    return {
      kind: 'ok',
      code,
      expected,
      stdin,
      runnableLive: false,
      blockedReason: '本题程序要读 stdin，而题库没有附带输入数据（数据缺口），实机对照会撞 EOF 得到垃圾输出，故禁用；判分仍以取证过的预存 stdout 为准。',
    }
  }
  return { kind: 'ok', code, expected, stdin, runnableLive: true }
}

export interface LineDiff {
  /** 1 起，与 base.ts 的 firstDiffLine 同口径 */
  line: number
  kind: 'mismatch' | 'actual-missing' | 'expected-missing'
  actual: string
  expected: string
}

export interface ExactGrade {
  /** 结论只由 base.ts 的 matchOutput 给出，本文件不自造判定规则 */
  state: 'accepted' | 'wrong-answer'
  firstDiffLine: number | null
  /** 两侧都已归一化，直接进 UI */
  actual: string
  expected: string
  diffs: LineDiff[]
  diffCount: number
  actualLineCount: number
  expectedLineCount: number
  /** true = 连归一化都不需要就逐字符相同（用于提示「差异只在空白」） */
  byteIdentical: boolean
}

/** 差异明细最多列这么多行，避免 8KB stdout 糊进 DOM（同 base.ts preview 的动机） */
export const MAX_DIFF_ROWS = 8

export function gradeExact(userText: string, expectedText: string): ExactGrade {
  const actual = normalizeOutput(userText)
  const expected = normalizeExpected(expectedText)
  const a = actual.split('\n')
  const e = expected.split('\n')
  const diffs: LineDiff[] = []
  let diffCount = 0
  const n = Math.max(a.length, e.length)
  for (let i = 0; i < n; i += 1) {
    // noUncheckedIndexedAccess：越界读回来的是 undefined，必须显式兜成空串
    const av = a[i] ?? ''
    const ev = e[i] ?? ''
    if (av === ev) continue
    diffCount += 1
    if (diffs.length < MAX_DIFF_ROWS) {
      diffs.push({
        line: i + 1,
        kind: i >= a.length ? 'actual-missing' : i >= e.length ? 'expected-missing' : 'mismatch',
        actual: av,
        expected: ev,
      })
    }
  }
  return {
    state: matchOutput(userText, expectedText) ? 'accepted' : 'wrong-answer',
    firstDiffLine: firstDiffLine(userText, expectedText),
    actual,
    expected,
    diffs,
    diffCount,
    actualLineCount: a.length,
    expectedLineCount: e.length,
    byteIdentical: userText === expectedText,
  }
}

export type SelfCheckKind =
  /** 实机 stdout 与预存 answer 一致：这份答案今天仍然可复现 */
  | 'matched'
  /** 实机 stdout 与预存 answer 不一致：数据可能过期，或题目对输入/环境敏感 */
  | 'mismatch'
  /** 题目代码自身跑不通（编译错误 / 崩溃 / 超时 / 截断）：数据缺陷信号，不是学生答错 */
  | 'defect'
  /** 后端抖动或未判定：绝不给「通过」 */
  | 'inconclusive'

export interface SelfCheckOutcome {
  kind: SelfCheckKind
  state: ResultState | null
  summary: string
  /** 归一化后的实机 stdout；未判定时为空串 */
  actual: string
  expected: string
  firstDiffLine: number | null
  totalMs: number
  cacheHit: boolean
}

/**
 * 可选的「实机对照」：把题目代码原样跑一遍，与预存 answer 比对。
 * 单组用例，仍走 runStdinTests（串行 / 节流 / 缓存 / 看门狗 / 降级全在那一层）。
 *
 * 断言链：godbolt.ts 已对 didExecute !== true 抛传输层错误（不会静默拿到空串），
 * 这里再对 truncated 断言一次 —— 截断的 stdout 不可采信，按规则转自评。
 */
export async function runReadingSelfCheck(
  client: JudgeClient,
  code: string,
  expected: string,
  stdin = '',
): Promise<SelfCheckOutcome> {
  const normExpected = normalizeExpected(expected)
  const cases: ProblemTestCase[] = [{ stdin, expected }]
  const outcome = await runStdinTests(client, code, cases)
  if (outcome.kind === 'error') {
    return {
      kind: 'inconclusive',
      state: null,
      summary: outcome.summary,
      actual: '',
      expected: normExpected,
      firstDiffLine: null,
      totalMs: 0,
      cacheHit: false,
    }
  }
  const result: TestCaseResult | undefined = outcome.report.results[0]
  if (!result) {
    return {
      kind: 'inconclusive',
      state: null,
      summary: '判分层没有返回本组的执行结果（未预期形状），本次未判定，不计正确率。',
      actual: '',
      expected: normExpected,
      firstDiffLine: null,
      totalMs: outcome.report.totalMs,
      cacheHit: false,
    }
  }
  const res = result.response
  const base = {
    actual: normalizeOutput(res.actual),
    expected: normExpected,
    totalMs: outcome.report.totalMs,
    cacheHit: result.cacheHit,
  }
  // truncated 的 stdout 被后端砍过，逐行比对没有意义 -> 转自评
  if (res.state === 'truncated') {
    return {
      ...base,
      kind: 'inconclusive',
      state: res.state,
      summary: '实机输出被截断（truncated），按判分顺序规则转自评，不采信为对照结论。',
      firstDiffLine: null,
    }
  }
  if (res.degraded || isInconclusive(res.state)) {
    return {
      ...base,
      kind: 'inconclusive',
      state: res.state,
      summary: res.summary,
      firstDiffLine: null,
    }
  }
  if (res.state === 'accepted') {
    return {
      ...base,
      kind: 'matched',
      state: res.state,
      summary: `实机 stdout 与预存答案完全一致（${outcome.report.totalMs} ms）：这份答案今天仍可复现。`,
      firstDiffLine: null,
    }
  }
  if (res.state === 'wrong-answer') {
    return {
      ...base,
      kind: 'mismatch',
      state: res.state,
      summary: '实机 stdout 与预存答案不一致：预存答案可能过期，或本题对环境/输入敏感。判分仍以预存答案为准，此处只做提示。',
      firstDiffLine: firstDiffLine(res.actual, res.expected),
    }
  }
  return {
    ...base,
    kind: 'defect',
    state: res.state,
    summary: `题目代码自身没跑通（${res.state}）：${res.summary}`,
    firstDiffLine: null,
  }
}