/**
 * 模块 4（程序改错 debug）验收实测。
 *
 * 与 acceptance-cc.ts 同口径：Vite middlewareMode + ssrLoadModule 加载**应用真实的判分链路**
 * （stdin-run.ts → judge/client.ts → backends/godbolt.ts），验收与线上同源；严格串行。
 *
 * 场景：
 *   unchanged      15 道：原样提交 bug 版代码 → 必须「判分失败」且**不是 compile-error**
 *                （改错题的 bug 是逻辑错不是语法错；若某题 bug 版编译不过 = 植入缺陷，报题号）
 *   fixed          15 道：提交 fixed_code → 必须全组 accepted（与 verified:true 互证）
 *   partial        c-ch04-dbg-001：只修 bug 1、保留 bug 2（按 bugs 文本行号做行级替换）→ 不得全组通过
 *   partial-scan   每章抽 1 道同上构造 → 不得全组通过；若某题「只剩最后一个 bug 却全组通过」
 *                说明该 bug 没被任何用例覆盖（数据弱点），判 FAIL 报题号
 *   syntax         c-ch04-dbg-001：人为删一个分号 → 首组必须 compile-error 且流程不崩（走正常判分面板）
 *
 * 任何一组 backend-unavailable / degraded 都算 FAIL（未判定 ≠ 通过）；传输层抖动串行复跑 2 轮。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const IDS = [
  'c-ch04-dbg-001', 'c-ch04-dbg-002', 'c-ch04-dbg-003',
  'c-ch05-dbg-004', 'c-ch05-dbg-005', 'c-ch05-dbg-006',
  'c-ch06-dbg-007', 'c-ch06-dbg-008', 'c-ch06-dbg-009',
  'c-ch07-dbg-010', 'c-ch07-dbg-011', 'c-ch07-dbg-012',
  'c-ch09-dbg-013', 'c-ch09-dbg-014', 'c-ch09-dbg-015',
]
/** partial-scan：每章抽一道，构造「只保留最后一个 bug」的部分修正 */
const SCAN = ['c-ch04-dbg-002', 'c-ch05-dbg-004', 'c-ch06-dbg-007', 'c-ch07-dbg-010', 'c-ch09-dbg-013']

interface Case { stdin: string; expected: string; note?: string }
interface Problem {
  id: string
  type: string
  code: string
  bugs: string[]
  fixed_code: string
  testCases: Case[]
  verified?: boolean
}
interface SR {
  createJudgeClient: (o?: unknown) => JudgeClientView
  toProblemTestCases: (c: Case[] | undefined) => ProblemTestCase[]
  runStdinTests: (
    c: JudgeClientView,
    code: string,
    cases: ProblemTestCase[],
    onProgress?: (p: unknown) => void,
  ) => Promise<StdinRunView>
}
interface JudgeClientView { runTests: (...args: unknown[]) => Promise<unknown> }
interface ProblemTestCase { stdin: string; expected: string; note?: string }
interface StdinRunView { kind: 'done' | 'error'; summary?: string; report?: BatchReportView }
interface BatchReportView {
  acceptedCount: number
  totalMs: number
  cacheHits: number
  results: Array<{ index: number; response: { state: string; summary: string } }>
}

interface Row {
  scenario: string
  id: string
  verdict: 'PASS' | 'FAIL'
  detail: string
  ms: number
  retries: number
}
const rows: Row[] = []
let requests = 0

function row(scenario: string, id: string, verdict: 'PASS' | 'FAIL', detail: string, ms = 0, retries = 0): void {
  rows.push({ scenario, id, verdict, detail, ms, retries })
  console.log(`${verdict} ${scenario.padEnd(13)} ${id.padEnd(14)} ${detail}`)
}

function loadProblems(): Map<string, Problem> {
  const dir = join(ROOT, 'public', 'data', 'problems')
  const out = new Map<string, Problem>()
  for (const name of IDS.map((id) => id.slice(0, 6) + '.json').filter((v, i, a) => a.indexOf(v) === i)) {
    const json = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { problems: Problem[] }
    for (const p of json.problems) if (IDS.includes(p.id)) out.set(p.id, p)
  }
  return out
}

/** bugs 文本开头「第 N 行」→ prose 行号（1 起）。**仅作取证对照，不用于构造代码** */
function proseLines(p: Problem): number[] {
  return p.bugs.map((b) => {
    const m = /^第\s*(\d+)\s*行/.exec(b)
    return m ? Number(m[1]) : 0
  })
}

/**
 * 真实需要改动的行：逐行**大小写敏感**比对 code 与 fixed_code。
 * 2026-09-09 全量扫描：15 道 debug 题里 14 道的 prose 行号与真实差异行不符（偏移 ±1~±2，
 * 个别指向非错误行）。上一版 harness 按 prose 行做「部分修正」，把一条**没有 bug 的行**
 * 原样换回去，结果退化成完全正确的代码 → 3/3 全通过 → partial / partial-scan 假 FAIL。
 * 现在一律以 diff 行为准（缺陷本身登记在 docs/待办-backlog.md TODO 3，属内容阶段返工）。
 */
function diffLines(p: Problem): number[] {
  const a = p.code.split('\n')
  const b = p.fixed_code.split('\n')
  const n = Math.max(a.length, b.length)
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    const x = i < a.length ? a[i] : null
    const y = i < b.length ? b[i] : null
    if (x !== y) out.push(i + 1)
  }
  return out
}

/** 部分修正：fixed_code 的第 keepLine 行换回 bug 版原行 = 「其余都修好、只留这一处错」 */
function partialCode(p: Problem, keepLine: number): string {
  const fixed = p.fixed_code.split('\n')
  const orig = p.code.split('\n')
  fixed[keepLine - 1] = orig[keepLine - 1]
  return fixed.join('\n')
}

const origFetch = globalThis.fetch
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  requests += 1
  return origFetch(...args)
}) as typeof fetch

async function runOnce(
  sr: SR,
  client: JudgeClientView,
  code: string,
  cases: ProblemTestCase[],
): Promise<{ report: BatchReportView; retries: number; ms: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const t0 = Date.now()
    const outcome = await sr.runStdinTests(client, code, cases)
    const ms = Date.now() - t0
    if (outcome.kind === 'done' && outcome.report) {
      const inconclusive = outcome.report.results.filter((r) =>
        r.response.state === 'backend-unavailable' || r.response.state === 'degraded')
      // 传输层抖动 = 未判定：串行复跑（最多 2 轮）；内容错误不重试
      if (inconclusive.length > 0 && attempt < 2) continue
      return { report: outcome.report, retries: attempt, ms }
    }
    if (attempt < 2) continue
    throw new Error(outcome.summary ?? 'runStdinTests 返回 error 且复跑用尽')
  }
  throw new Error('不可达')
}

function statesOf(report: BatchReportView): string {
  const counts = new Map<string, number>()
  for (const r of report.results) counts.set(r.response.state, (counts.get(r.response.state) ?? 0) + 1)
  return [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(',')
}

async function main(): Promise<void> {
  const problems = loadProblems()
  console.log('启动 Vite SSR 以加载应用真实的判分链路…')
  const server = await createServer({
    configFile: false,
    root: resolve(ROOT).split('\\').join('/'),
    logLevel: 'silent',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  })
  const sr = (await server.ssrLoadModule('/src/modules/problems/grading/stdin-run.ts')) as unknown as SR
  const client = sr.createJudgeClient()
  console.log('SSR 就绪。开始实机验收（严格串行）\n')

  for (const id of IDS) {
    const p = problems.get(id)
    if (!p) { row('preload', id, 'FAIL', '分片里查无此题'); continue }
    const cases = sr.toProblemTestCases(p.testCases)

    // unchanged：bug 版必须能编译、必须判分失败
    const u = await runOnce(sr, client, p.code, cases)
    const uStates = u.report.results.map((r) => r.response.state)
    const uBad: string[] = []
    if (uStates.includes('compile-error')) uBad.push('bug 版编译失败（植入缺陷）')
    if (u.report.acceptedCount === u.report.results.length) uBad.push('bug 版竟全组通过（用例没覆盖 bug）')
    if (uStates.some((s) => s === 'backend-unavailable' || s === 'degraded')) uBad.push('存在未判定组')
    row('unchanged', id, uBad.length === 0 ? 'PASS' : 'FAIL',
      `实机 ${u.report.acceptedCount}/${u.report.results.length} states=${statesOf(u.report)}` +
      (uBad.length ? ' ← ' + uBad.join('；') : ''), u.ms, u.retries)

    // fixed：参考修正必须全组通过
    const f = await runOnce(sr, client, p.fixed_code, cases)
    const fOk = f.report.acceptedCount === f.report.results.length &&
      f.report.results.every((r) => r.response.state === 'accepted')
    row('fixed', id, fOk ? 'PASS' : 'FAIL',
      `实机 ${f.report.acceptedCount}/${f.report.results.length} states=${statesOf(f.report)}`, f.ms, f.retries)
  }

  // partial：只修 bug 1、保留 bug 2（c-ch04-dbg-001）
  const p1 = problems.get('c-ch04-dbg-001')!
  const lines1 = diffLines(p1)
  const prose1 = proseLines(p1)
  const part = partialCode(p1, lines1[lines1.length - 1])
  const pr = await runOnce(sr, client, part, sr.toProblemTestCases(p1.testCases))
  row('partial', p1.id, pr.report.acceptedCount < pr.report.results.length ? 'PASS' : 'FAIL',
    `真实差异行 [${lines1}]（prose 声称 [${prose1}]，不符）、只保留第 ${lines1[lines1.length - 1]} 行 → 实机 ${pr.report.acceptedCount}/${pr.report.results.length} states=${statesOf(pr.report)}`,
    pr.ms, pr.retries)

  // partial-scan：每章一道，只保留最后一个 bug
  for (const id of SCAN) {
    const p = problems.get(id)!
    const lines = diffLines(p)
    const keep = lines[lines.length - 1]
    const r = await runOnce(sr, client, partialCode(p, keep), sr.toProblemTestCases(p.testCases))
    const all = r.report.acceptedCount === r.report.results.length
    const mixed = r.report.acceptedCount > 0 && !all
    row('partial-scan', id, all ? 'FAIL' : 'PASS',
      `真实差异行 [${lines}]（prose [${proseLines(p)}]）、保留第 ${keep} 行 → 实机 ${r.report.acceptedCount}/${r.report.results.length}` +
      (mixed ? '（混合：部分用例通过部分失败）' : '') +
      (all ? ' ← 该 bug 未被任何用例覆盖（数据弱点）' : ''), r.ms, r.retries)
  }

  // syntax：删一个分号 → 首组 compile-error，流程不崩
  const broken = p1.code.replace('scanf("%d %d %d", &x, &y, &z);', 'scanf("%d %d %d", &x, &y, &z)')
  const sy = await runOnce(sr, client, broken, sr.toProblemTestCases(p1.testCases))
  const syOk = sy.report.results[0]?.response.state === 'compile-error'
  row('syntax', p1.id, syOk ? 'PASS' : 'FAIL',
    `删分号后首组 state=${sy.report.results[0]?.response.state}（应 compile-error 且走正常判分面板）`, sy.ms, sy.retries)

  const fail = rows.filter((r) => r.verdict === 'FAIL')
  const byScenario = new Map<string, { pass: number; fail: number }>()
  for (const r of rows) {
    const e = byScenario.get(r.scenario) ?? { pass: 0, fail: 0 }
    if (r.verdict === 'PASS') e.pass += 1; else e.fail += 1
    byScenario.set(r.scenario, e)
  }
  console.log('\n════ 汇总 ════')
  for (const [k, v] of byScenario) console.log(`  ${k.padEnd(13)} PASS ${String(v.pass).padStart(2)}  FAIL ${v.fail}`)
  const totalMs = rows.reduce((a, r) => a + r.ms, 0)
  console.log(`  真实网络请求 ${requests} 次（严格串行），执行合计 ${(totalMs / 1000).toFixed(1)} s`)
  console.log(`  传输层复跑 ${rows.filter((r) => r.retries > 0).length} 项`)
  console.log(`  总判定 ${rows.length} 项，失败 ${fail.length} 项`)
  if (fail.length > 0) {
    console.log('\n失败明细：')
    for (const f of fail) console.log(`  ${f.scenario} / ${f.id}: ${f.detail}`)
  }
  writeFileSync(join(ROOT, 'tmp', 'acceptance-dbg.json'), JSON.stringify({ requests, rows }, null, 2), 'utf8')
  console.log('\n证据已写入 tmp/acceptance-dbg.json')
  await server.close()
  if (fail.length > 0) process.exitCode = 1
}

await main()