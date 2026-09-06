/**
 * 判分客户端：排队、节流、缓存、跨标签页互斥、降级。上层页面只调 run / runTests。
 * 限流参数的实测依据见 docs/adr/0001-judge-backend.md 4.3 —— Godbolt 上并发越高吞吐越低，
 * 所以这里的核心不是「尽快并发」，而是「按节拍排队」。
 */
import { judge } from '../app/config'
import { JudgeTransportError } from './types'
import type {
  BatchReport, ExecutionResult, JudgeBackend, JudgeProgress, JudgeResponse,
  QueueStatus, RunRequest, TestCaseResult,
} from './types'
import { firstDiffLine, matchOutput, normalizeExpected, normalizeOutput } from './backends/base'

/** 构建期预存的真实输出：(归一化代码, stdin) -> stdout。后端不可用时供学生自评 */
export type PrecomputedLookup = (code: string, stdin: string) => string | null

interface Task {
  req: RunRequest
  priority: number
  /** 0 常规，1 表示「跑完这一组还要跑下一组」，排到队首避免自锁 */
  resolve: (r: ExecutionResult) => void
  reject: (e: unknown) => void
  onStatus?: (s: QueueStatus) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 简易同步哈希（FNV-1a）。crypto.subtle 在非安全上下文不可用，故不依赖它 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function cacheKey(backendId: string, req: RunRequest): string {
  const args = req.userArguments ?? judge.userArguments
  return [
    backendId,
    fnv1a(backendId === 'godbolt' ? judge.godboltCompiler + args : args),
    req.compileOnly ? 'build' : 'exec',
    fnv1a(normalizeExpected(req.code)),
    fnv1a(normalizeExpected(req.stdin)),
  ].join(':')
}
export interface JudgeClientOptions {
  /** 同一浏览器内跨标签页互斥（等效串行）。Godbolt 并发无收益，默认开 */
  exclusiveAcrossTabs?: boolean
  /** 传输故障后的重试次数（不含首次），默认 1 */
  retries?: number
  /** 构建期预存输出的查询函数，缺省表示无降级数据 */
  precomputed?: PrecomputedLookup
  onStatus?: (s: QueueStatus) => void
}

const DEFAULTS = { exclusiveAcrossTabs: true, retries: 1 } as const

export class JudgeClient {
  readonly backend: JudgeBackend
  private readonly exclusive: boolean
  private readonly retries: number
  private readonly precomputed?: PrecomputedLookup
  private readonly onStatus?: (s: QueueStatus) => void
  private readonly lockName: string
  private readonly cache = new Map<string, ExecutionResult>()
  private readonly queue: Task[] = []
  private running = 0
  private lastStartAt = 0
  /** 后端故障后的冷却期：期内不再打请求，直接走降级，避免把公共实例往死里敲 */
  private cooldownUntil = 0

  constructor(backend: JudgeBackend, options: JudgeClientOptions = {}) {
    this.backend = backend
    this.exclusive = options.exclusiveAcrossTabs ?? DEFAULTS.exclusiveAcrossTabs
    this.retries = options.retries ?? DEFAULTS.retries
    this.precomputed = options.precomputed
    this.onStatus = options.onStatus
    this.lockName = `judge:${backend.id}`
  }

  status(): QueueStatus {
    return {
      running: this.running,
      waiting: this.queue.length,
      ahead: this.queue.length,
      concurrency: this.backend.maxConcurrency,
    }
  }

  get cacheSize(): number { return this.cache.size }
  get inCooldown(): number { return Math.max(0, this.cooldownUntil - Date.now()) }

  clearCache(): void { this.cache.clear() }

  /** 入队。priority 越大越先跑（同一批内的续跑任务用 1，避免自己排在队尾自锁） */
  private enqueue(req: RunRequest, priority: number): Promise<ExecutionResult> {
    return new Promise<ExecutionResult>((resolve, reject) => {
      this.queue.push({ req, priority, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    while (this.running < this.backend.maxConcurrency && this.queue.length > 0) {
      let pick = 0
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i]
        const b = this.queue[pick]
        if (a && b && a.priority > b.priority) pick = i
      }
      const task = this.queue.splice(pick, 1)[0]
      if (!task) return
      this.running += 1
      void this.runTask(task)
    }
  }

  private async runTask(task: Task): Promise<void> {
    try {
      task.resolve(await this.withLock(() => this.dispatch(task)))
    } catch (error) {
      task.reject(error)
    } finally {
      this.running -= 1
      this.notify()
      this.pump()
    }
  }

  /** 节拍 + 重试退避。只有传输层故障才重试，学生代码编译失败绝不重投 */
  private async dispatch(task: Task): Promise<ExecutionResult> {
    const gap = this.lastStartAt + this.backend.minIntervalMs - Date.now()
    if (gap > 0) await sleep(gap)
    this.lastStartAt = Date.now()
    let attempt = 0
    for (;;) {
      try {
        return await this.backend.execute(task.req)
      } catch (error) {
        if (!(error instanceof JudgeTransportError) || !error.retryable || attempt >= this.retries) {
          if (error instanceof JudgeTransportError) this.cooldownUntil = Date.now() + 30_000
          throw error
        }
        attempt += 1
        await sleep(800 * attempt)
      }
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!this.exclusive || !locks) return fn()
    return locks.request(this.lockName, { mode: 'exclusive' }, fn)
  }

  private notify(): void {
    this.onStatus?.(this.status())
  }
  // ── 判分入口 ───────────────────────────────────────────────────
  /** 走缓存的提交；cacheHit 为 true 时没有产生任何网络请求 */
  async request(req: RunRequest, priority = 0): Promise<{ result: ExecutionResult; cacheHit: boolean }> {
    const key = cacheKey(this.backend.id, req)
    const hit = this.cache.get(key)
    if (hit) return { result: hit, cacheHit: true }
    const result = await this.enqueue(req, priority)
    this.cache.set(key, result)
    return { result, cacheHit: false }
  }

  /** 单组用例：跑一次并给出结论，后端故障时自动降级 */
  async run(req: RunRequest, expected: string): Promise<JudgeResponse> {
    try {
      const { result } = await this.request(req)
      return verdict(req, expected, result)
    } catch (error) {
      return this.fallback(req, expected, error)
    }
  }

  /**
   * 一道编程题的多组用例 —— 串行执行，不用并发。
   * 实测依据（ADR-0001 4.3）：并发 20 时完成速率从 1.36 QPS 跌到 0.52 QPS，
   * 而 4 组用例在浏览器里冷跑实测 2861 / 3090 / 3627 ms 三次（ADR-0001 9.3，真实鼠标点击 +
   * fetch 层逐请求计时），串行既快又稳；缓存命中时同一批 4 组只要 10 ms、0 次网络请求。
   * UI 靠 onProgress 显示「第 N/M 组」，回调在**每组开始执行前**触发，显示的是正在进行的那一组。
   */
  async runTests(code: string, testCases: ProblemTestCase[], onProgress?: (p: JudgeProgress) => void): Promise<BatchReport> {
    const results: TestCaseResult[] = []
    const timings: number[] = []
    const t0 = Date.now()
    let cacheHits = 0
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]
      if (!tc) continue
      const req: RunRequest = { code, stdin: tc.stdin }
      const started = Date.now()
      onProgress?.({ caseIndex: i + 1, total: testCases.length, status: this.status() })
      let response: JudgeResponse
      let cacheHit = false
      try {
        const r = await this.request(req, 1)
        cacheHit = r.cacheHit
        response = verdict(req, tc.expected, r.result)
      } catch (error) {
        response = this.fallback(req, tc.expected, error)
        if (response.state === 'backend-unavailable') {
          // 后端已进入冷却期：剩下的用例逐个降级标注，不再去撞墙
          for (let j = i; j < testCases.length; j++) {
            const rest = testCases[j]
            if (!rest) continue
            const ms = Date.now() - started
            results.push({
              index: j + 1, stdin: rest.stdin, note: rest.note, ms, cacheHit: false,
              response: this.fallback({ code, stdin: rest.stdin }, rest.expected, error),
            })
            timings.push(ms)
          }
          break
        }
      }
      const ms = Date.now() - started
      if (cacheHit) cacheHits += 1
      results.push({ index: i + 1, stdin: tc.stdin, note: tc.note, response, ms, cacheHit })
      timings.push(ms)
    }
    return {
      results, timings, cacheHits,
      totalMs: Date.now() - t0,
      acceptedCount: results.filter((r) => r.response.state === 'accepted').length,
    }
  }

  /** 降级：读构建期预存的真实输出供自评；没有预存数据就明说不可用，绝不给出「通过」 */
  private fallback(req: RunRequest, expected: string, error: unknown): JudgeResponse {
    const reason = error instanceof JudgeTransportError ? `${error.kind}：${error.message}` : '判分服务异常'
    const pre = this.precomputed?.(req.code, req.stdin)
    if (typeof pre === 'string') {
      return {
        state: 'degraded',
        summary: `判分后端暂不可用（${reason}）。下面给出构建期预存的参考输出供自评，不计正确率、不置 verified。`,
        expected: normalizeExpected(expected), actual: normalizeOutput(pre),
        diagnostics: [], compilerMessage: reason, degraded: true, source: 'precomputed',
      }
    }
    return {
      state: 'backend-unavailable',
      summary: `判分后端暂不可用（${reason}），本题暂无预存输出可自评，请稍后重试`,
      expected: normalizeExpected(expected), actual: '',
      diagnostics: [], compilerMessage: reason, degraded: false, source: 'backend',
    }
  }
}

/** 与 schema/Problem.schema.json 的 definitions.testCases 同构 */
export interface ProblemTestCase {
  stdin: string
  expected: string
  note?: string
}

/** 把执行事实判成结论。纯函数，可单测，也是阶段 4 判分器唯一出口 */
export function verdict(req: RunRequest, expected: string, result: ExecutionResult): JudgeResponse {
  const exp = normalizeExpected(expected)
  const act = normalizeOutput(result.stdout)
  const base = {
    expected: exp, actual: act,
    diagnostics: result.diagnostics, compilerMessage: result.compilerMessage,
    exitCode: result.exitCode, execTimeMs: result.execTimeMs,
    degraded: false, source: 'backend' as const,
  }
  const errCount = result.diagnostics.filter((d) => d.severity === 'error').length
  if (req.compileOnly) {
    return errCount > 0 || result.errorClass === 'compile-error'
      ? { ...base, state: 'compile-error', summary: `编译失败，共 ${errCount} 条错误` }
      : { ...base, state: 'accepted', summary: '编译通过（未执行）' }
  }
  switch (result.errorClass) {
    case 'compile-error':
      return { ...base, state: 'compile-error', summary: result.diagnostics[0]?.message ?? '编译失败，请查看编译输出' }
    case 'timeout':
      return { ...base, state: 'timeout', summary: '运行超时：检查死循环，或该用例规模是否过大' }
    case 'runtime-error':
      return { ...base, state: 'runtime-error', summary: `程序异常退出（exit code ${result.exitCode}）：${result.stderr.split('\n')[0] ?? ''}` }
    case 'truncated':
      return { ...base, state: 'truncated', summary: '输出过长被后端截断，本次不予判分' }
    case 'ok':
      return matchOutput(result.stdout, expected)
        ? { ...base, state: 'accepted', summary: '输出正确' }
        : { ...base, state: 'wrong-answer', summary: firstDiffLine(result.stdout, expected) === null ? '输出与期望不符' : `第 ${firstDiffLine(result.stdout, expected)} 行与期望不符` }
  }
}
