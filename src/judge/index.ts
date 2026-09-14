/**
 * 后端注册处。全站只从这里取后端实例，任何页面都不得直接 fetch Godbolt/Piston。
 *
 * ── 关于 Piston 与 Judge0 ──────────────────────────────────────────────
 * 原计划在这里保留两份休眠实现，经 2026-09-06 裁决砍掉，理由是它们此刻必然是死代码：
 *   · Piston 公共 API 自 2026-02-15 起白名单化，POST /piston/execute 实测返回 401
 *     （GET /runtimes 仍 200），拿到白名单之前任何实现都无法验证；
 *   · Judge0 CE 公共实例需要 API key，而本站是纯静态站，key 只能写进前端 bundle，
 *     等于公开泄露，故在能自托管之前不写。
 * 抽象层（JudgeBackend 契约 + client 的队列/缓存/降级）照旧保留，切换成本仍然只有一个文件。
 *
 * ── 新增一个后端要做的事（契约见 src/judge/types.ts 的 JudgeBackend）──────
 * 1. 新建 src/judge/backends/<id>.ts，export function create<Id>Backend(opts): JudgeBackend，
 *    实现 4 个只读配置 + 1 个方法：
 *      id             后端名，进缓存键与日志，必须全局唯一（'godbolt' 等）
 *      maxConcurrency 实测出来的并发上限，不要照抄文档说的数字
 *      minIntervalMs  相邻两次请求的最小间隔
 *      timeoutMs      单请求软超时
 *      execute(req)   成功返回 ExecutionResult（只描述事实，不判对错）；
 *                     仅在传输层故障时抛 JudgeTransportError，
 *                     并按 kind 决定 retryable：401/403 → backend-auth 不可重试，
 *                     429 → quota 可重试但要退避，5xx/网络/超时 → busy/network 可重试。
 *    编译失败、运行崩溃、超时、输出截断都属 ExecutionResult.errorClass，不是异常 —— 学生
 *    代码写错不是故障。若后端把这几类都塞进同一个非零退出码（Godbolt 就是这样，
 *    顶层 code=-1 同指编译失败与超时），必须在此按 buildResult.code / timedOut 优先区分。
 * 2. 输出字段若是 Array<{text: string}> 这种「一行一项」结构，用 base.ts 的 joinTextLines
 *    拼接、stripAnsi 去色码，不要在页面里做。
 * 3. 在下面 BACKENDS 里注册，并在 src/app/config.ts 增补该后端的实测参数；
 *    .env.example 的 VITE_JUDGE_BACKEND 注释同步加上取值。
 * 4. 必须实测四项再提交：stdout 能否取到、stdin 能否被 scanf 读到、
 *    连续 20 次的限流表现、编译错误的字段结构。结论写进 docs/adr/ 新 ADR，
 *    不要只写在代码注释里。
 * 5. 浏览器直连的前端后端禁止任何需要密钥的方案（key 必然泄露）；
 *    需要服务端运行的方案一律否决（纯静态 + 开源可 fork 是硬约束）。
 */
import { judge } from '../app/config'
import type { JudgeBackend } from './types'
import { createGodboltBackend } from './backends/godbolt'
import { createFailoverBackend } from './failover'

type Factory = () => JudgeBackend

/**
 * 主后端 = Godbolt 编译器梯队（ADR-0002）。
 *
 * 链 id 沿用 'godbolt'（createFailoverBackend 的默认值），所以 client.ts 的结果缓存键、
 * 跨标签页锁名、JudgeLab 上显示的后端名都不变 —— 容灾对学生和既有进度是完全透明的。
 * 关掉梯队（failoverEnabled=false 或 tiers 为空）时返回裸后端，行为与 2026-09-14 之前一致。
 */
const godbolt: Factory = () => {
  const primary = createGodboltBackend()
  if (!judge.failoverEnabled) return primary
  const tiers = judge.godboltFailoverTiers
    .filter((c) => c !== judge.godboltCompiler)
    .map((c) => createGodboltBackend({ id: `godbolt:${c}`, compiler: c }))
  if (tiers.length === 0) return primary
  return createFailoverBackend([primary, ...tiers], {
    cooldownMs: judge.failoverCooldownMs,
    budgetMs: judge.failoverBudgetMs,
  })
}

const BACKENDS: Record<string, Factory> = { godbolt }

let cached: { key: string; backend: JudgeBackend } | null = null

/** 默认后端；未知取值一律回落 godbolt 并在控制台说明，避免整站因配置笔误而瘫掉 */
export function getBackend(): JudgeBackend {
  const key = judge.backend
  const factory = BACKENDS[key] ?? godbolt
  if (!BACKENDS[key]) {
    console.warn(`[judge] 未知后端 "${key}"，已回落到 godbolt。可用取值：${Object.keys(BACKENDS).join(', ')}`)
  }
  const resolvedKey = BACKENDS[key] ? key : 'godbolt(回落)'
  if (cached && cached.key === resolvedKey) return cached.backend
  const backend = factory()
  cached = { key: resolvedKey, backend }
  return backend
}

/**
 * 按编译器 id 取后端实例（任务 3-1 代码游乐场用）。
 *
 * 仍然走注册表这一个出口 —— 页面不许自己 fetch Godbolt（见本文件顶部约定）。
 * 每个编译器一个独立实例，且 id 带上编译器名（'godbolt:cg152'）：
 * client.ts 的结果缓存键与跨标签页锁名都吃 backend.id，共用一个 id 会让
 * 「同一份代码换个编译器」的结果互相顶掉（godbolt.ts 的 GodboltOptions.id 注释里写过这条坑）。
 * 默认编译器直接复用 getBackend() 的单例，不多建一份、不多开一把锁。
 *
 * 这里**故意不挂容灾梯队**：用户在游乐场里显式挑了「gcc 14.2」，主后端故障时悄悄换成
 * 13.1 出结果，就是拿另一个编译器冒充他的选择。显式选择宁可如实报「后端不可用」，
 * 让用户自己决定重试还是换编译器。默认编译器（走 getBackend()）才享受梯队。
 */
const perCompiler = new Map<string, JudgeBackend>()

export function getBackendFor(compilerId: string): JudgeBackend {
  if (!compilerId || compilerId === judge.godboltCompiler) return getBackend()
  const hit = perCompiler.get(compilerId)
  if (hit) return hit
  const backend = createGodboltBackend({ id: `godbolt:${compilerId}`, compiler: compilerId })
  perCompiler.set(compilerId, backend)
  return backend
}

/** 单测/联调用：注入替身后端 */
export function registerBackend(id: string, factory: Factory): void {
  BACKENDS[id] = factory
  cached = null
}

export function availableBackends(): string[] {
  return Object.keys(BACKENDS)
}