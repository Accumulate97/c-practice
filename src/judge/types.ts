/**
 * 判分后端的类型契约。所有字段语义来自 docs/adr/0001-judge-backend.md 第 4 节
 * （Godbolt 实机探测结论）与第 5 节（接口设计），不是凭想象写的抽象。
 *
 * 分层原则：
 *   后端适配器只做「传输 + 事实分类」，返回 ExecutionResult；
 *   client.ts 做「排队 / 节流 / 缓存 / 降级」，并把 ExecutionResult 判成 JudgeResponse；
 *   比对 expected 的归一化规则唯一来源是 04_题型规范与样例.md 第〇节。
 */

/** 一次「编译并（可选）运行」的请求 */
export interface RunRequest {
  /** 完整可编译的标准 C99 源码，禁止类C伪码与 C++ 语法 */
  code: string
  /** 送入 stdin 的内容；无输入必须传空串而不是 undefined */
  stdin: string
  /** 覆盖默认编译参数（默认取 config.judge.userArguments） */
  userArguments?: string
  /** true = 只要编译诊断，不执行 */
  compileOnly?: boolean
}

/** 一条编译诊断，已剥掉 ANSI 色码 */
export interface CompileDiag {
  /** 1 起 */
  line: number
  /** 1 起，未知为 0 */
  column: number
  severity: 'warning' | 'error'
  message: string
}

/** 后端返回的执行事实，不含「对不对」的判断 */
export interface ExecutionResult {
  /**
   * 执行层面的分类：
   *   ok 编译成功且进程正常返回（答案对不对由 client 判）
   *   compile-error 编译失败，看 diagnostics
   *   runtime-error 运行期崩溃/非零退出（如 SIGSEGV → exitCode 139）
   *   timeout 后端判定的运行超时
   *   truncated 输出被后端截断
   */
  errorClass: 'ok' | 'compile-error' | 'runtime-error' | 'timeout' | 'truncated'
  compiled: boolean
  exitCode: number
  stdout: string
  /** 运行期 stderr；编译期错误在 diagnostics / compilerMessage 里 */
  stderr: string
  diagnostics: CompileDiag[]
  /** 编译期完整输出（含 warning），用于展示 -Wall -Wextra 的结果 */
  compilerMessage: string
  execTimeMs?: number
  /** 后端原始响应，仅调试面板使用 */
  raw?: unknown
}

/** 传输层故障：这类才允许重试，学生代码写错不算故障 */
export type TransportClass = 'network' | 'busy' | 'quota' | 'backend-auth'

/** 判分结论的状态 */
export type ResultState =
  | 'accepted'
  | 'wrong-answer'
  | 'compile-error'
  | 'runtime-error'
  | 'timeout'
  | 'truncated'
  | 'degraded'
  | 'backend-unavailable'

/** 单道题（或单组用例）的最终判分结果 */
export interface JudgeResponse {
  state: ResultState
  /** 一句话结论，直接进 UI 顶栏 */
  summary: string
  /** 本题比对用的期望输出（已归一化） */
  expected: string
  /** 实际 stdout（已归一化）；降级模式下来自构建期预存 */
  actual: string
  diagnostics: CompileDiag[]
  compilerMessage: string
  exitCode?: number
  execTimeMs?: number
  /** true = 后端不可用，走了预存 stdout 自评，不产生「通过」效力 */
  degraded: boolean
  source: 'backend' | 'precomputed'
}

/** 一组测试用例的结果 */
export interface TestCaseResult {
  index: number
  stdin: string
  note?: string
  response: JudgeResponse
  /** 本次请求端到端耗时 */
  ms: number
  /** 缓存命中时不产生网络请求 */
  cacheHit: boolean
}

/** 多组用例串行跑的完整报告 */
export interface BatchReport {
  results: TestCaseResult[]
  totalMs: number
  acceptedCount: number
  /** 每个请求耗时，用于「第 N/M 组」进度条与限流复诊 */
  timings: number[]
  cacheHits: number
}

/** 队列的实时状态，回调给 UI */
export interface QueueStatus {
  running: number
  waiting: number
  /** 排在本人前面还有几个 */
  ahead: number
  concurrency: number
}

export interface JudgeProgress {
  /** 第几组（1 起） */
  caseIndex: number
  total: number
  status: QueueStatus
}

/** 后端适配器契约。新增后端只需实现这 4 个成员，见 src/judge/index.ts */
export interface JudgeBackend {
  /** 'godbolt' 等，进缓存键与日志 */
  readonly id: string
  /** 该后端允许的最大并发；ADR-0001 实测 Godbolt = 2，更高反而降低吞吐 */
  readonly maxConcurrency: number
  /** 相邻两次请求的最小间隔毫秒 */
  readonly minIntervalMs: number
  /** 单次请求软超时毫秒 */
  readonly timeoutMs: number
  /** 成功返回事实；传输层故障抛 JudgeTransportError */
  execute(req: RunRequest): Promise<ExecutionResult>
}

/** 传输层异常（HTTP 非 2xx、fetch 抛错、超时） */
export class JudgeTransportError extends Error {
  readonly kind: TransportClass
  readonly retryable: boolean
  readonly status?: number

  constructor(kind: TransportClass, message: string, options?: { retryable?: boolean; status?: number }) {
    super(message)
    this.name = 'JudgeTransportError'
    this.kind = kind
    this.status = options?.status
    this.retryable = options?.retryable ?? kind !== 'backend-auth'
  }
}