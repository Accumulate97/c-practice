/**
 * 容灾梯队 —— ADR-0002 的实现。
 *
 * ── 为什么是「同厂编译器梯队」而不是 Piston / Wandbox ─────────────────────
 * 2026-09-14 用 scripts/probe-backends.mjs 实机探活（证据存 tmp/backend-probe.json）：
 *   · Piston  POST https://emkc.org/api/v2/piston/execute → **HTTP 401**
 *     "Public Piston API is now whitelist only as of 2/15/2026"（GET /runtimes 仍 200，
 *     所以「列表能拉、执行不能跑」，光看文档会误判成可用）；
 *   · Wandbox POST https://wandbox.org/api/compile.json → **HTTP 500**
 *     "Failed to get uid: status=exit status: 125"（gcc-head-c / clang 同错，是它自己的
 *     沙箱起不来，与我们的请求体无关）；
 *   · OneCompiler 要 access_token、Judge0 CE 要 API key —— 纯静态站的 key 只能进 bundle，
 *     等于公开泄露，ADR-0001 已否决；
 *   · Godbolt 自身三个 x86-64 gcc 梯队 **全部 HTTP 200 / didExecute=true / stdout="ok"**
 *     （cg132 929ms、cg142 991ms、cg131 1086ms）。
 * 结论：此刻没有任何「不需要密钥、能被浏览器直连、真的能执行 C」的第二厂商。
 * 于是把容灾做成**通用的梯队抽象**，现役梯队填 Godbolt 的三个编译器版本 ——
 * 它能挡住真实发生过的故障类型（单编译器容器 502 / 该版本被下架 / didExecute 缺失），
 * 挡不住 godbolt.org 整站挂掉；后者仍由 client.ts 的降级自评兜底。
 * 第三方厂商哪天活了，按 src/judge/index.ts 顶部的契约补一个适配器塞进梯队即可，
 * 本文件一行都不用改。
 *
 * ── 切换口径（三条硬规则，改之前先读）────────────────────────────────────
 * 1. **只有传输层故障才切换**。学生代码编译失败 / 运行崩溃 / TLE 是 ExecutionResult
 *    的 errorClass（事实），不是故障 —— 切换只会得到同样的事实，白等一倍时间。
 * 2. **retryable === false 的错误立即抛出，不切换**。这一类里最重要的是「被我方软超时
 *    掐断」（godbolt.ts 对 AbortError 故意置 retryable:false）：死循环在 Godbolt 上要
 *    跑满 ~20 s，若再切一个梯队重跑，学生要等 40 s 才看到「运行超时」。
 *    backend-auth（401/403）同理：整站被拒，换个编译器 id 也一样被拒。
 * 3. **判分口径必须一致**：梯队内每一级都用同一份 userArguments（config.judge.userArguments
 *    = `-std=c99 -Wall -Wextra`，gcc 默认优化级别就是 -O0，与出题期 authoring-verify 的
 *    `-std=c99 -w -O0` 同优化档），且返回值原样透传 ExecutionResult，不做任何「修补」。
 *    验收脚本 scripts/acceptance-failover.mjs 会用真实 Godbolt 对同一份代码跑两级做交叉验证。
 *
 * ── 与 client.ts 的分工 ───────────────────────────────────────────────────
 * client 的重试是「同一条链再来一遍」，本文件的重试是「这一次换一级」。
 * 因此 client 的 retries 不需要改：链内已经逐级试过，链外再给两轮，
 * 最坏情况 = 梯队长度 × (1 + retries) 个请求。默认梯队 3 级 + retries 2 → 上限 9 个，
 * 但规则 2 保证「慢」的那类（软超时）根本不会进链内顺延，实际最坏仍是快失败（5xx ~1 s）。
 * 另加一道 budgetMs 墙钟闸：整条链超过预算就停手，绝不让容灾把用户拖到分钟级。
 */
import { JudgeTransportError } from './types'
import type { ExecutionResult, JudgeBackend, RunRequest } from './types'

export interface FailoverEvent {
  /** 故障级 id */
  from: string
  /** 接手的下一级 id；全部失败时为 null */
  to: string | null
  kind: string
  message: string
  /** 故障级消耗的毫秒 */
  ms: number
}

export interface FailoverStats {
  /** 进入 execute 的次数 */
  requests: number
  /** 发生过的切换次数（一次 execute 里可以切多次） */
  switches: number
  /** 每级实际服务成功的次数 */
  servedBy: Record<string, number>
  /** 每级当前还剩多少毫秒被判为不健康 */
  unhealthy: Record<string, number>
  /** 整条链全灭的次数（此时抛给 client，由它走降级） */
  exhausted: number
}

export interface FailoverOptions {
  /** 链 id。默认取第一级（主后端）的 id —— 见下面「为什么不能换 id」 */
  id?: string
  /** 一级被判不健康后，多久之内直接跳过它（默认 60 s） */
  cooldownMs?: number
  /** 单次 execute 走完整条链的墙钟预算（默认 30 s） */
  budgetMs?: number
  /** 切换时的回调；默认打一条 console.info（不是 warn/error，验收要求控制台干净） */
  onFailover?: (event: FailoverEvent) => void
}

export interface FailoverBackend extends JudgeBackend {
  /** 梯队里各级的 id，按优先级排列 */
  readonly chain: readonly string[]
  stats(): FailoverStats
  /** 清空健康记忆（验收脚本 / 「重试后端」按钮用） */
  resetHealth(): void
}

/**
 * 为什么链 id 必须沿用主后端的 id：client.ts 的结果缓存键与跨标签页锁名都吃 backend.id
 * （cacheKey 里还专门给 'godbolt' 加了编译器指纹）。换 id 会让已有的进度缓存与锁全部失效，
 * 并且让「同一份代码」在切换前后各存一份缓存。
 * 代价是缓存里可能存着由第二级产出的结果 —— 对本站可接受：判分口径一致（规则 3），
 * 且题目 stdout 全是确定性 printf 输出。真要区分，看 stats().servedBy。
 */
export function createFailoverBackend(tiers: JudgeBackend[], options: FailoverOptions = {}): FailoverBackend {
  if (!Array.isArray(tiers)) {
    throw new Error('[judge] 容灾梯队至少要有一级后端')
  }
  const primary = tiers[0]
  if (primary === undefined) {
    throw new Error('[judge] 容灾梯队至少要有一级后端')
  }
  const cooldownMs = options.cooldownMs ?? 60_000
  const budgetMs = options.budgetMs ?? 30_000

  const unhealthyUntil = new Map<string, number>()
  const servedBy: Record<string, number> = {}
  let requests = 0
  let switches = 0
  let exhausted = 0

  /** 同一对 (from,to) 60 s 内只播报一次，避免真出故障时刷屏 */
  const announced = new Map<string, number>()
  const notify = options.onFailover ?? ((ev: FailoverEvent) => {
    const key = ev.from + '->' + String(ev.to)
    const now = Date.now()
    if ((announced.get(key) ?? 0) + 60_000 > now) return
    announced.set(key, now)
    console.info(`[judge] 后端 ${ev.from} 不可用（${ev.kind}：${ev.message}），已自动切到 ${ev.to ?? '降级路径'}`)
  })

  /** 健康级优先；全都不健康时仍按原顺序试一遍（记忆可能是错的，不能因此直接放弃） */
  function order(now: number): JudgeBackend[] {
    const healthy = tiers.filter((t) => (unhealthyUntil.get(t.id) ?? 0) <= now)
    const sick = tiers.filter((t) => (unhealthyUntil.get(t.id) ?? 0) > now)
    return healthy.length > 0 ? healthy.concat(sick) : tiers.slice()
  }

  return {
    id: options.id ?? primary.id,
    chain: tiers.map((t) => t.id),
    // 取最保守的一档：并发按最小的算，间隔按最大的算，超时按最长的算。
    // 同厂梯队三者本来就相同，这段是为「将来混入别的厂商」准备的。
    maxConcurrency: Math.min(...tiers.map((t) => t.maxConcurrency)),
    minIntervalMs: Math.max(...tiers.map((t) => t.minIntervalMs)),
    timeoutMs: Math.max(...tiers.map((t) => t.timeoutMs)),

    stats(): FailoverStats {
      const unhealthy: Record<string, number> = {}
      const now = Date.now()
      for (const t of tiers) {
        const until = unhealthyUntil.get(t.id) ?? 0
        if (until > now) unhealthy[t.id] = until - now
      }
      return { requests, switches, servedBy: { ...servedBy }, unhealthy, exhausted }
    },

    resetHealth(): void {
      unhealthyUntil.clear()
      announced.clear()
    },

    async execute(req: RunRequest): Promise<ExecutionResult> {
      requests += 1
      const started = Date.now()
      const failures: string[] = []
      let lastError: JudgeTransportError | null = null
      // 出发时定好路线（健康级在前）。中途不重排：一次 execute 里改路线会让人看不懂
      // 「为什么第二级跳过了第三级」，而且重排也救不回已经花掉的时间。
      const plan = order(started)

      for (const [k, tier] of plan.entries()) {
        if (lastError !== null && Date.now() - started > budgetMs) {
          failures.push(`${tier.id}：跳过（整条链已超出 ${budgetMs} ms 预算）`)
          continue
        }
        const t0 = Date.now()
        try {
          const result = await tier.execute(req)
          servedBy[tier.id] = (servedBy[tier.id] ?? 0) + 1
          return result
        } catch (error) {
          const ms = Date.now() - t0
          // 非传输层异常（我们自己写错了）不该被容灾吞掉，直接抛出去暴露 bug
          if (!(error instanceof JudgeTransportError)) throw error
          // 规则 2：不可重试 = 慢故障或全站被拒，换一级只是让学生多等一轮
          if (!error.retryable) throw error
          lastError = error
          unhealthyUntil.set(tier.id, Date.now() + cooldownMs)
          failures.push(`${tier.id}：${error.kind} ${error.message}`)
          switches += 1
          notify({
            from: tier.id,
            to: plan[k + 1]?.id ?? null,
            kind: error.kind,
            message: error.message,
            ms,
          })
        }
      }

      exhausted += 1
      // 全灭：把每一级的失败原因拼进消息，方便 JudgeLab 与报告里定位是「谁」挂了。
      // kind / retryable / status 沿用最后一级，client 的既有重试与降级逻辑无需改动。
      throw new JudgeTransportError(
        lastError?.kind ?? 'network',
        `判分后端全链不可用（${tiers.length} 级）：${failures.join(' | ')}`,
        { retryable: lastError?.retryable ?? true, status: lastError?.status },
      )
    },
  }
}
