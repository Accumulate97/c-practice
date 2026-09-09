/**
 * Godbolt 适配器 —— ADR-0001 选定的现役后端，浏览器直连、无需 key。
 * 字段语义全部来自 2026-09-06 实机探测，证据见 docs/adr/0001-judge-backend.md 第 4 节。
 * 三条坑写在下面，改代码前先读那段证据。
 */
import { judge } from '../../app/config'
import { JudgeTransportError } from '../types'
import type { CompileDiag, ExecutionResult, JudgeBackend, RunRequest } from '../types'
import { joinTextLines, stripAnsi } from './base'

const ENDPOINT = 'https://godbolt.org/api'

interface RawTag { line?: number; column?: number; severity?: number }
interface RawLine { text?: string; tag?: RawTag }

// 实测 severity 是数字：2 = warning、3 = error（不是字符串）
function toDiag(line: RawLine): CompileDiag | null {
  const tag = line.tag
  if (!tag || typeof tag.line !== 'number') return null
  const message = stripAnsi(line.text ?? '').trim()
  if (!message) return null
  return {
    line: tag.line,
    column: typeof tag.column === 'number' ? tag.column : 0,
    severity: tag.severity === 3 ? 'error' : 'warning',
    message,
  }
}

function collect(rows: RawLine[] | undefined): CompileDiag[] {
  if (!Array.isArray(rows)) return []
  return rows.map(toDiag).filter((d): d is CompileDiag => d !== null)
}

// 坑 1：顶层 code = -1 同时表示「编译失败」与「运行超时」，必须按
// buildResult.code -> timedOut -> code -> truncated 的顺序判，顺序错了会把超时判成编译错误。
function classify(json: Record<string, unknown>): ExecutionResult['errorClass'] {
  const build = json.buildResult as { code?: number } | undefined
  if (build && typeof build.code === 'number' && build.code !== 0) return 'compile-error'
  if (json.timedOut === true) return 'timeout'
  const code = typeof json.code === 'number' ? json.code : 0
  if (code !== 0) return 'runtime-error'
  if (json.truncated === true) return 'truncated'
  return 'ok'
}
export interface GodboltOptions {
  /** 编译器 id，默认 cg132 = GCC 13.2 x86-64 */
  compiler?: string
  /** 编译参数，默认 -std=c99 -Wall -Wextra */
  userArguments?: string
}

export function createGodboltBackend(options: GodboltOptions = {}): JudgeBackend {
  const compiler = options.compiler ?? judge.godboltCompiler
  const args = options.userArguments ?? judge.userArguments

  return {
    id: 'godbolt',
    maxConcurrency: judge.maxConcurrency,
    minIntervalMs: judge.minIntervalMs,
    timeoutMs: judge.timeoutMs,

    async execute(req: RunRequest): Promise<ExecutionResult> {
      const body = {
        compiler,
        lang: 'c',
        source: req.code,
        options: {
          compilerOptions: {
            // 坑 2：executorRequest 与 filters.execute 两个都要给，缺一个就拿不到 stdout。
            // 公共端点对执行请求的鉴权与只出汇编的请求不同。
            executorRequest: true,
            userArguments: req.userArguments ?? args,
            filters: { execute: true },
          },
          executeParameters: { stdin: req.stdin },
        },
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), judge.timeoutMs)
      let res: Response
      try {
        res = await fetch(`${ENDPOINT}/compiler/${compiler}/compile`, {
          method: 'POST',
          // 坑 3：自定义头会被 CORS 预检拒掉，实测只允许下面这两个
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (cause) {
        const aborted = cause instanceof Error && cause.name === 'AbortError'
        // 被我方软超时掐断时不再重试：实测 Godbolt 对死循环要 20~21 s 才回，
        // 重试等于让用户多等一倍时间（JudgeLab 实测 40841 ms 才出结论）。直接降级。
        throw new JudgeTransportError(
          aborted ? 'busy' : 'network',
          aborted ? `请求超过 ${judge.timeoutMs} ms 被中止` : '网络不可达或被 CORS 拦截',
          { retryable: !aborted },
        )
      } finally {
        clearTimeout(timer)
      }

      // 鉴权/配额类故障不可重试：重试只会更快被限流
      if (res.status === 401 || res.status === 403) {
        throw new JudgeTransportError('backend-auth', `Godbolt 拒绝该请求（HTTP ${res.status}）`, {
          retryable: false,
          status: res.status,
        })
      }
      if (res.status === 429) {
        throw new JudgeTransportError('quota', 'Godbolt 触发限流（HTTP 429）', { retryable: true, status: res.status })
      }
      if (!res.ok) {
        throw new JudgeTransportError('busy', `Godbolt 返回 HTTP ${res.status}`, { retryable: true, status: res.status })
      }

      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!json) throw new JudgeTransportError('busy', 'Godbolt 响应不是合法 JSON', { retryable: true })

      const build = json.buildResult as
        | { code?: number; stderr?: RawLine[]; stdout?: RawLine[] }
        | undefined
      // 坑 4（阶段 4 模块 1 补，用户明令断言）：Godbolt 响应是扁平的，没有 execResult 包裹层。
      // didExecute !== true 说明后端只给了编译产物（executorRequest / filters.execute 少给一个，
      // 或公共实例降级），此时顶层 stdout 是空数组，classify() 仍会判成 ok，再被 verdict()
      // 静默比成「实际输出为空」的假 wrong-answer。历史事故：用 j.execResult||{} 兜底不抛错，
      // 30/30 验证全废。故这里显式抛传输层错误，交给 client 的重试 / 降级路径处理。
      const buildCode = typeof build?.code === 'number' ? build.code : 0
      if (!req.compileOnly && buildCode === 0 && json.didExecute !== true) {
        throw new JudgeTransportError(
          'busy',
          `Godbolt 未执行本次程序（didExecute=${String(json.didExecute)}），结果不可信`,
          { retryable: true },
        )
      }
      const diagnostics = collect(build?.stderr).concat(collect(build?.stdout))
        // 编译期信息：buildResult.stderr 是真正的诊断，顶层 stderr 在编译失败时只放一句 "Build failed"
        const compilerMessage = [stripAnsi(joinTextLines(build?.stderr)), stripAnsi(joinTextLines(json.stderr))]
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join('\n')

      return {
        errorClass: classify(json),
        compiled: diagnostics.every((d) => d.severity !== 'error') && (build?.code ?? 0) === 0,
        exitCode: typeof json.code === 'number' ? json.code : 0,
        stdout: joinTextLines(json.stdout),
        stderr: stripAnsi(joinTextLines(json.stderr)),
        diagnostics,
        compilerMessage,
        execTimeMs: typeof json.execTime === 'number' ? json.execTime : undefined,
        raw: json,
      }
    },
  }
}