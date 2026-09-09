/**
 * 阶段 3 · 构建期实机验证：把「代码题必须先跑通才许 verified:true」这条硬约束变成脚本。
 *
 * 为什么值得为它引一次 Vite：godbolt.ts 与 config.ts 用了 import.meta.env，裸 node 加载不了；
 * 用 Vite 的 middlewareMode + ssrLoadModule 直接加载**应用真正会用的那份代码**，
 * 校验口径与线上判分口径同源，不会出现「脚本里一套实现、页面里另一套实现」。
 *
 * 两条纪律写死在这里：
 *   1. 严格串行 + 尊重 backend.minIntervalMs。实测（ADR-0001 4.3）并发 20 时完成速率从
 *      1.36 QPS 跌到 0.52 QPS，批量脚本并发没有任何好处。
 *   2. code_reading 的 answer 只能来自真实 stdout：占位符 PENDING-REAL-STDOUT 先跑一遍取回
 *      真实输出，独立复跑一遍确认两次一致，才写回数据文件。绝不手写推断值。
 *
 * 用法：
 *   node scripts/judge-verify.ts                     校验 public/data 全部代码题并写回 verified
 *   node scripts/judge-verify.ts --no-write          只跑不改数据（复核用；注意此模式不落盘 answer，
 *                                                    占位符题的最终判定会如实报 FAIL）
 *   node scripts/judge-verify.ts --doc04             改校 04_题型规范与样例.md 的样例（裁决二第 1 条）
 *
 * 产物：public/data/problems/verification-report.json（真实 stdout 存档，后端下线也能复核）
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRunnableSource, readDocSamples } from './lib/problem-code.ts'
import type { Runnable } from './lib/problem-code.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBLEM_DIR = join(ROOT, 'public', 'data', 'problems')
const NON_SHARD = new Set(['index.json', 'verification-report.json'])
const GENERATED = 'GENERATED — 由 npm run judge:verify 生成，禁止手工编辑（verified:true 的唯一证据链）'
const PLACEHOLDER = 'PENDING-REAL-STDOUT'
const FENCE = String.fromCharCode(96, 96, 96)

interface ExecResult {
  errorClass: string; compiled: boolean; exitCode: number; stdout: string; stderr: string
  diagnostics: Array<{ line: number; column: number; severity: string; message: string }>
  compilerMessage: string; execTimeMs?: number
}
interface RunRequest { code: string; stdin: string; compileOnly?: boolean; userArguments?: string }
interface Backend {
  id: string; maxConcurrency: number; minIntervalMs: number; timeoutMs: number
  execute(req: RunRequest): Promise<ExecResult>
}
type Norm = (text: string) => string
type Problem = Record<string, unknown>

interface CaseRecord {
  index: number; stdin: string; ms: number; http_ok: boolean
  error_class: string; exit_code: number; exec_ms: number | null
  observed: string; expected: string; match: boolean; warnings: string[]
}
interface ProblemRecord {
  id: string; type: string; file: string; checked_field: string
  /** 本题实际用的编译器：libm 题会被路由到 g132，其余是配置里的 cg132 */
  compiler?: string
  request_count: number; wall_ms: number; ok: boolean; adopted_answer: string | null
  /** inconclusive = 本轮遇到后端抖动（5xx/网络），根本没拿到判定；attempts = 本轮为这道题跑了几遍 */
  inconclusive: boolean; attempts: number
  /** carried_over = 本轮未判定，ok 沿用最近一次真实跑通的证据（verified 与证据链都不动）
   *  carried_from = 那次成功取证的时刻（来自报告里的 last_known_good，不会被后续抖动覆盖） */
  carried_over?: boolean; carried_from?: string | null
  cases: CaseRecord[]; diagnostics_preview: string
}
/** last_known_good：某个 id 最近一次「真实跑通」的证据；只增不减，后端抖动抹不掉它。 */
interface GoodProof { at: string; wall_ms: number; requests: number }
interface ReportShape {
  generated_at?: string; results?: ProblemRecord[]; last_known_good?: Record<string, GoodProof>
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
function preview(text: string, max = 300): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : one.slice(0, max) + '…'
}

const noWrite = process.argv.includes('--no-write')
const asDoc04 = process.argv.includes('--doc04')
/**
 * 负例对照用：把后端换成「必定抛 5xx」的替身，验证「未判定」三件事——
 * 不翻 verified、不冲掉已有证据、退出码非 0。它只影响本进程，不写进任何配置。
 */
const simulate5xx = process.argv.includes('--simulate-5xx')
const DOC04 = '04_题型规范与样例.md'

/**
 * libm 路由。实测（tmp/probe-math.mjs，2026-09-09）：cg132 的执行链路不吃 userArguments 里的
 * -lm，含 sqrt 的源码必然 undefined reference → didExecute=false；换 g132 能链上。
 * 代价：g132 是 C++ 前端，被路由过去的参考实现必须是「C++ 也能编译的 C」
 * （malloc 返回值要显式强转）。全库只有 2 道题走这条支路，故只在构建期脚本里做，
 * 线上判分后端不动 —— 这条前端缺口已登记，留给阶段 5。
 */
const MATH_COMPILER = 'g132'
const MATH_LIB_RE = /\b(sqrt|pow|sin|cos|tan|asin|acos|atan|atan2|log|log10|exp|fabs|floor|ceil|fmod|hypot|sinh|cosh|tanh)\s*\(/

/**
 * --only=<id 或 id 前缀>[,...]：只跑子集。内容返工时逐批改数据用，
 * 免得每批都重跑 300+ 个真实请求。子集跑的报告会与上一份报告合并（见文件末尾），
 * 未跑的题原样带下去，否则 verify-data 的 VERIFIED-NO-PROOF 会把它们全判成无证。
 */
const onlyArg = process.argv.find((a) => a.startsWith('--only=')) ?? ''
const onlyTokens = onlyArg.slice('--only='.length).split(',').map((x) => x.trim()).filter(Boolean)
function wanted(id: string): boolean {
  return onlyTokens.length === 0 || onlyTokens.some((t) => id === t || id.startsWith(t))
}

console.log('启动 Vite SSR 以加载应用真实的判分后端…')
const boot = Date.now()
const server = await createServer({
  configFile: false,
  root: resolve(ROOT).split('\\').join('/'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
})
let backend: Backend
/** libm 专用后端（g132）。只有 needsMathLib 命中的题会走它。 */
let backendMath: Backend | null = null
let normalize: Norm
let cfg: { godboltCompiler: string; userArguments: string }
try {
  const mod = (await server.ssrLoadModule('/src/judge/backends/godbolt.ts')) as { createGodboltBackend: (o: Record<string, unknown>) => Backend }
  const base = (await server.ssrLoadModule('/src/judge/backends/base.ts')) as { normalizeOutput: Norm }
  const conf = (await server.ssrLoadModule('/src/app/config.ts')) as { judge: typeof cfg }
  backend = mod.createGodboltBackend({})
  backendMath = mod.createGodboltBackend({ compiler: MATH_COMPILER })
  normalize = base.normalizeOutput
  cfg = conf.judge
  if (simulate5xx) {
    backend = {
      id: 'simulate-5xx', maxConcurrency: 1, minIntervalMs: 0, timeoutMs: 1000,
      execute: async (): Promise<ExecResult> => { throw new Error('HTTP 502 Bad Gateway（--simulate-5xx 负例对照，不是真实请求）') },
    }
    backendMath = backend
    console.log('!! --simulate-5xx：后端已换成必然 5xx 的替身，只用于验证「未判定」路径')
  }
} finally {
  await server.close()
}
console.log('后端就绪（' + (Date.now() - boot) + 'ms）id=' + backend.id + ' compiler=' + cfg.godboltCompiler +
  ' args="' + cfg.userArguments + '" minIntervalMs=' + backend.minIntervalMs + ' timeoutMs=' + backend.timeoutMs)
if (onlyTokens.length) console.log('--only 子集：' + onlyTokens.join(', ') + '（报告将与上一份合并，未跑的题原样带下去）')

function needsMathLib(code: string): boolean {
  return MATH_LIB_RE.test(code)
}
function backendFor(code: string): Backend {
  return needsMathLib(code) && backendMath !== null ? backendMath : backend
}
function compilerOf(be: Backend): string {
  return backendMath !== null && be === backendMath ? MATH_COMPILER : cfg.godboltCompiler
}

interface Target { file: string; problem: Problem; runnable: Runnable }

function shardNames(): string[] {
  return readdirSync(PROBLEM_DIR).sort().filter((n) => n.endsWith('.json') && !NON_SHARD.has(n))
}

function targetsFromShards(): Target[] {
  const out: Target[] = []
  for (const name of shardNames()) {
    const parsed = JSON.parse(readFileSync(join(PROBLEM_DIR, name), 'utf8')) as { problems?: Problem[] }
    for (const p of parsed.problems ?? []) {
      if (!wanted(String(p.id))) continue
      const r = buildRunnableSource(p as never)
      if (r) out.push({ file: name, problem: p, runnable: r })
    }
  }
  return out
}

function doc04Samples(): Problem[] {
  return readDocSamples(readFileSync(join(ROOT, DOC04), 'utf8')) as unknown as Problem[]
}

function targetsFromDoc04(): Target[] {
  const out: Target[] = []
  for (const p of doc04Samples()) {
    const r = buildRunnableSource(p as never)
    if (r) out.push({ file: DOC04, problem: p, runnable: r })
  }
  return out
}

async function verifyOne(code: string, cases: Array<{ stdin: string; expected: string }>, be: Backend = backend): Promise<CaseRecord[]> {
  const out: CaseRecord[] = []
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i]
    const expected = normalize(tc.expected)
    await sleep(be.minIntervalMs)
    const t0 = Date.now()
    let res: ExecResult | null = null
    let boom = ''
    try {
      res = await be.execute({ code, stdin: tc.stdin, compileOnly: false })
    } catch (e) {
      boom = e instanceof Error ? e.message : String(e)
    }
    const ms = Date.now() - t0
    if (!res) {
      out.push({ index: i, stdin: tc.stdin, ms, http_ok: false, error_class: 'transport-error', exit_code: -1, exec_ms: null, observed: '', expected, match: false, warnings: ['传输层异常：' + boom] })
      continue
    }
    const observed = normalize(res.stdout)
    out.push({
      index: i, stdin: tc.stdin, ms, http_ok: true,
      error_class: res.errorClass, exit_code: res.exitCode, exec_ms: res.execTimeMs ?? null,
      observed, expected, match: res.errorClass === 'ok' && observed === expected,
      warnings: res.diagnostics.map((d) => d.severity + '@' + d.line + ':' + d.column + ' ' + preview(d.message, 140)),
    })
  }
  return out
}

/**
 * 定点替换：只改围栏里指定顶层键的那一行，其余字节一律不动。
 *
 * 为什么不用 JSON.stringify(obj, null, 2) 整块重写：04 里 "accepted": ["a","b"]
 * 这种紧凑数组会被炸成多行，一次 verified 翻转能制造上百行格式化噪声，
 * 规范文档的 diff 就没法审。这里只替换目标行，并在写回前重新解析一遍，
 * 断言「除目标键之外没有任何语义变化」，防止把文档改坏。
 */
function patchDocSample(md: string, id: string, fields: Record<string, unknown>): { md: string; changed: string[] } {
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim().indexOf(FENCE + 'json') !== 0) { i += 1; continue }
    let j = i + 1
    while (j < lines.length && lines[j].trim() !== FENCE) j += 1
    const body = lines.slice(i + 1, j)
    let parsed: Problem | null = null
    try { parsed = JSON.parse(body.join('\n')) as Problem } catch { parsed = null }
    if (!parsed || parsed.id !== id) { i = j + 1; continue }
    const next = body.slice()
    const changed: string[] = []
    for (const key of Object.keys(fields)) {
      /** 顶层键固定两空格缩进，嵌套对象里的同名键（缩进更深）不会被误伤 */
      const re = new RegExp('^ {2}"' + key + '"[ \\t]*:[ \\t]*([^\\r\\n]*?)(,?)(\\r?)$')
      const at = next.findIndex((ln) => re.test(ln))
      if (at < 0) throw new Error('围栏 ' + id + ' 里没有顶层键 ' + key + '，不敢猜格式')
      const m = re.exec(next[at]) as RegExpExecArray
      const replacement = '  "' + key + '": ' + JSON.stringify(fields[key]) + m[2] + m[3]
      if (next[at] !== replacement) { next[at] = replacement; changed.push(key) }
    }
    const newText = next.join('\n')
    const after = JSON.parse(newText) as Problem
    for (const k of new Set([...Object.keys(parsed), ...Object.keys(after)])) {
      const want = Object.prototype.hasOwnProperty.call(fields, k) ? fields[k] : (parsed as Record<string, unknown>)[k]
      if (JSON.stringify((after as Record<string, unknown>)[k]) !== JSON.stringify(want)) {
        throw new Error('定点替换后语义变化超出预期（' + k + '），拒绝写回')
      }
    }
    return { md: lines.slice(0, i + 1).join('\n') + '\n' + newText + '\n' + lines.slice(j).join('\n'), changed }
  }
  throw new Error('在 ' + DOC04 + ' 里找不到 id=' + id + ' 的 json 围栏')
}

/** answer 占位符 → 真实 stdout。必须两遍独立运行一致才落盘 */
async function adoptAnswer(t: Target): Promise<string | null> {
  const raw = String(t.problem.answer ?? '')
  if (t.runnable.checkedField !== 'answer' || raw.trim() !== PLACEHOLDER) return null
  const c0 = t.runnable.cases[0]
  const be = backendFor(t.runnable.code)
  const first = await verifyOne(t.runnable.code, [{ stdin: c0.stdin, expected: PLACEHOLDER }], be)
  const a = first[0]
  if (!a || a.error_class !== 'ok' || a.observed === '') {
    console.log('  ✗ ' + String(t.problem.id) + ' 取不到真实 stdout：class=' + String(a?.error_class) + ' exit=' + String(a?.exit_code) + ' ms=' + String(a?.ms))
    if (a?.warnings.length) console.log('    编译诊断: ' + a.warnings.join(' | '))
    if (a && !a.http_ok) console.log('    后端不可用 —— 本题保持 verified:false，不回填、不猜测')
    return null
  }
  console.log('  第一遍真实 stdout = ' + JSON.stringify(a.observed) + '（' + a.ms + 'ms）')
  await sleep(be.minIntervalMs)
  const second = await verifyOne(t.runnable.code, [{ stdin: c0.stdin, expected: a.observed }], be)
  const b = second[0]
  if (!b || !b.match) {
    console.log('  ✗ 拒绝回填：第二遍 = ' + JSON.stringify(String(b?.observed)) + '，与第一遍不一致')
    return null
  }
  console.log('  ✓ 第二遍独立复跑一致 = ' + JSON.stringify(b.observed) + '（' + b.ms + 'ms，含一次真实网络请求）')
  t.problem.answer = b.observed
  const c = t.runnable.cases[0]
  if (c) c.expected = b.observed
  return b.observed
}

/**
 * 把采纳到的真实 stdout 落盘。
 * 必须在「最终判定」之前完成 —— 最终判定刻意重新读盘，
 * 只有落盘之后的数据才是被判 verified 的数据，否则内存改动与报告口径不一致。
 */
function persistAdopted(adopted: Map<string, string>): void {
  if (adopted.size === 0) return
  if (noWrite) {
    console.log('  (--no-write：采纳的 stdout 不落盘，最终判定会如实报 FAIL)')
    return
  }
  if (asDoc04) {
    let md = readFileSync(join(ROOT, DOC04), 'utf8')
    for (const [id, answer] of adopted) {
      const patched = patchDocSample(md, id, { answer })
      md = patched.md
      console.log('  落盘 answer：' + DOC04 + ' ' + id + (patched.changed.length ? '（已改写）' : '（值已相同）'))
    }
    writeFileSync(join(ROOT, DOC04), md, 'utf8')
    return
  }
  for (const name of shardNames()) {
    const path = join(PROBLEM_DIR, name)
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { problems: Problem[] }
    let dirty = false
    for (const p of parsed.problems) {
      const got = adopted.get(String(p.id))
      if (got !== undefined && p.answer !== got) { p.answer = got; dirty = true }
    }
    if (dirty) writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
    console.log('  落盘 answer：' + name + (dirty ? '（已写）' : '（无变化）'))
  }
}

const targets = asDoc04 ? targetsFromDoc04() : targetsFromShards()
console.log('待验证代码题：' + targets.length + ' 道（' + (asDoc04 ? DOC04 + ' 样例' : 'public/data/problems 分片') + '），共 ' +
  targets.reduce((n, t) => n + t.runnable.cases.length, 0) + ' 个请求，严格串行')

const adopted = new Map<string, string>()
for (const t of targets) {
  const got = await adoptAnswer(t)
  if (got !== null) adopted.set(String(t.problem.id), got)
}
persistAdopted(adopted)

console.log('\n=== 最终判定（以数据文件当前内容为准，重新读盘）===')
const finalTargets = asDoc04 ? targetsFromDoc04() : targetsFromShards()
const reportPath = asDoc04 ? join(ROOT, 'docs', 'verification-report-doc04.json') : join(PROBLEM_DIR, 'verification-report.json')

/**
 * 「后端抖动」和「题目错了」是两回事。HTTP 5xx / 网络失败 / 401 根本没观察到学生代码的行为，
 * 属于**未判定**：既不许据此把 verified 翻成 false，也不许用它覆盖上一次的成功证据。
 * 2026-09-06 实测踩到：串行第 5 个请求遇到 HTTP 502，没有这条区分时一次网络抖动
 * 就把一道已验证通过的题悄悄降级，还把它的证据从报告里冲掉了。
 */
function isInconclusive(cases: CaseRecord[]): boolean {
  return cases.some((c) => !c.http_ok || c.error_class === 'transport-error')
}

const nowIso = new Date().toISOString()
const prevReport: ReportShape = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, 'utf8')) as ReportShape
  : {}
/** 成功证据累积表：以报告里已存档的 last_known_good 为底，
 *  旧报告没有这个字段时，才从上一轮 results 里补一份近似证据。 */
const prevGood = new Map<string, GoodProof>(Object.entries(prevReport.last_known_good ?? {}))
for (const r of prevReport.results ?? []) {
  if (r.ok && !r.inconclusive && !prevGood.has(r.id)) {
    prevGood.set(r.id, { at: prevReport.generated_at ?? 'unknown', wall_ms: r.wall_ms, requests: r.request_count })
  }
}

const MAX_ATTEMPTS = 2
const results: ProblemRecord[] = []
/** 本轮真正跑过的 id：--only 子集模式下，合并进来的历史记录不算本轮结果 */
const ranIds = new Set<string>()
for (const t of finalTargets) {
  const id = String(t.problem.id)
  const be = backendFor(t.runnable.code)
  ranIds.add(id)
  let cases: CaseRecord[] = []
  let wall = 0
  let attempts = 0
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    if (a > 0) {
      console.log('  ↻ ' + id + ' 上一轮遇到后端抖动（5xx/网络），等 1500ms 后严格串行复跑（不重试内容错误）')
      await sleep(1500)
    }
    const start = Date.now()
    cases = await verifyOne(t.runnable.code, t.runnable.cases, be)
    wall += Date.now() - start
    attempts += 1
    if (!isInconclusive(cases)) break
  }
  const inc = isInconclusive(cases)
  const prev = prevGood.get(id)
  const carried = inc && Boolean(prev)
  const rec: ProblemRecord = {
    id, type: String(t.problem.type), file: t.file, checked_field: t.runnable.checkedField,
    compiler: compilerOf(be),
    request_count: attempts * cases.length, wall_ms: wall,
    // 未判定 + 有上一次成功证据 → 沿用旧结论（verified 不动，报告不丢证据）；没有旧证据就是硬失败
    ok: inc ? Boolean(carried) : cases.length > 0 && cases.every((c) => c.match),
    adopted_answer: adopted.get(id) ?? null,
    inconclusive: inc, attempts,
    carried_over: carried || undefined,
    // 取证时刻取自 last_known_good，别让「沿用」看起来像是这一轮刚验证的
    carried_from: carried ? prev!.at : undefined,
    cases,
    diagnostics_preview: cases.flatMap((c) => c.warnings).slice(0, 6).join(' | '),
  }
  results.push(rec)
  const head = inc ? '🚩 未判定 ' : (rec.ok ? '✓ PASS ' : '✗ FAIL ')
  console.log(head + rec.id + ' [' + rec.type + '] 字段=' + rec.checked_field +
    ' 轮次=' + rec.attempts + ' 请求=' + rec.request_count + ' 墙钟=' + rec.wall_ms + 'ms 末轮各请求=' +
    cases.map((c) => c.ms + 'ms').join('/') + ' 执行=' + cases.map((c) => (c.exec_ms ?? '?') + 'ms').join('/'))
  if (carried) console.log('    沿用 ' + String(rec.carried_from) + ' 那次成功的实机证据；verified 保持原值，请复跑本命令复核')
  if (inc && !carried) console.log('    没有可沿用的历史证据 → 本题按未验证处理（不会写 verified:true）')
  for (const c of cases) if (!c.match && c.http_ok) console.log('    用例' + (c.index + 1) + ' 期望=' + JSON.stringify(c.expected) + ' 实际=' + JSON.stringify(c.observed) + ' class=' + c.error_class + ' exit=' + c.exit_code + ' http=' + c.http_ok)
  if (rec.diagnostics_preview) console.log('    编译诊断: ' + rec.diagnostics_preview)
}
/**
 * --only 子集模式必须合并报告：verification-report.json 是 verified:true 的唯一证据链，
 * 只写本轮结果会让未跑的已验证题在 verify-data 里变成 VERIFIED-NO-PROOF（error）。
 * 合并规则：本轮跑过的以本轮为准，没跑的原样带下去（含 ok / inconclusive / cases）。
 */
if (onlyTokens.length > 0) {
  const carried = (prevReport.results ?? []).filter((r) => !ranIds.has(r.id))
  results.push(...carried)
  results.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  console.log('\n--only 子集：本轮实跑 ' + ranIds.size + ' 道，从上一份报告带入 ' + carried.length + ' 道历史结果')
}
/** 本轮结论只统计真跑过的题；带入的历史记录不参与退出码 */
const ranResults = results.filter((r) => ranIds.has(r.id))
const inconclusiveCount = ranResults.filter((r) => r.inconclusive).length
// 本轮真实跑通的，立刻刷新 last_known_good；未判定沿用的不算新证据，保留原始时刻。
for (const r of results) {
  if (r.ok && !r.inconclusive) prevGood.set(r.id, { at: nowIso, wall_ms: r.wall_ms, requests: r.request_count })
}

/* ---- 写回：verified 翻转只允许发生在这一段；未判定的一律跳过 ---- */
const flipped: string[] = []
if (!noWrite) {
  if (asDoc04) {
    let md = readFileSync(join(ROOT, DOC04), 'utf8')
    let touched = 0
    for (const r of results) {
      if (r.inconclusive) continue                            // 未判定：一个字节都不写
      const patched = patchDocSample(md, r.id, { verified: r.ok })
      md = patched.md
      touched += patched.changed.length
      if (r.ok) flipped.push(r.id)
    }
    if (touched > 0) {
      writeFileSync(join(ROOT, DOC04), md, 'utf8')
      console.log('写回 ' + DOC04 + '：定点改写 ' + touched + ' 处 verified')
    } else {
      console.log('无需改 ' + DOC04)
    }
  } else {
    const byFile = new Map<string, ProblemRecord[]>()
    for (const r of results) {
      const list = byFile.get(r.file) ?? []
      list.push(r)
      byFile.set(r.file, list)
    }
    for (const [name, list] of byFile) {
      const path = join(PROBLEM_DIR, name)
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { problems: Problem[] }
      let dirty = false
      for (const r of list) {
        const p = parsed.problems.find((x) => String(x.id) === r.id)
        if (!p) continue
        if (!ranIds.has(r.id)) continue                       // --only 带入的历史记录：数据一个字都不动
        if (r.inconclusive) continue                          // 未判定：verified 一个字都不动
        if (Boolean(p.verified) !== r.ok) { p.verified = r.ok; dirty = true }
        if (r.ok) flipped.push(r.id)
      }
      if (dirty) writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
      console.log((dirty ? '写回 ' : '无需改 ') + name + '  ' +
        list.map((r) => r.id + (r.inconclusive ? ' 未判定(verified 不动)' : ' verified=' + Boolean(r.ok))).join(' '))
    }
  }
}

const totalReqs = results.reduce((n, r) => n + r.request_count, 0)
const totalMs = results.reduce((n, r) => n + r.wall_ms, 0)
writeFileSync(reportPath, JSON.stringify({
  _generated: GENERATED,
  generated_at: nowIso,
  backend: backend.id, compiler: cfg.godboltCompiler, user_arguments: cfg.userArguments,
  serial_only: true, min_interval_ms: backend.minIntervalMs,
  scope: asDoc04 ? DOC04 : 'public/data/problems/*.json',
  only: onlyTokens.length ? onlyTokens : undefined,
  problems: results.length, requests: totalReqs, total_wall_ms: totalMs,
  mean_request_ms: totalReqs ? Math.round(totalMs / totalReqs) : 0,
  adopted_answer_of: [...adopted.keys()],
  /** 后端抖动（5xx/网络）不算题目失败：这些题 verified 未改动；
   *  有历史成功证据的，报告里 ok 沿用旧值并标 carried_over，避免一次 502 冲掉证据链 */
  inconclusive_this_run: results.filter((r) => r.inconclusive).map((r) => r.id),
  /** 成功证据只增不减：本轮没跑通的历史成功记录原样带下去 */
  last_known_good: Object.fromEntries(prevGood.entries()),
  results,
}, null, 2) + '\n', 'utf8')
console.log('\n存档 ' + reportPath.replace(ROOT + '\\', '').replace(ROOT + '/', '') +
  '  题目=' + results.length + ' 请求=' + totalReqs + ' 总墙钟=' + totalMs + 'ms 均值=' +
  (totalReqs ? Math.round(totalMs / totalReqs) : 0) + 'ms/请求')

const passed = ranResults.filter((r) => r.ok).length
const hardFailed = ranResults.filter((r) => !r.ok).length
const carriedCount = ranResults.filter((r) => r.carried_over).length
console.log('通过 ' + passed + '/' + ranResults.length + (onlyTokens.length ? '（本轮 --only 子集；报告共存档 ' + results.length + ' 道）' : '') +
  // 「沿用旧证据」不是本轮复核，别让它看起来像绿灯
  (carriedCount ? '（⚠ 其中 ' + carriedCount + ' 道是沿用 last_known_good 的旧证据，本轮未实机复核）' : '') +
  (flipped.length ? '  已置 verified:true → ' + flipped.join(', ') : ''))
if (inconclusiveCount > 0) {
  console.log('🚩 本轮 ' + inconclusiveCount + ' 道因后端抖动（HTTP 5xx / 网络）未判定：' +
    ranResults.filter((r) => r.inconclusive).map((r) => r.id + (r.carried_over ? '(沿用旧证据)' : '(无旧证据)')).join(', ') +
    ' —— 这些数据文件未被改动，请复跑本命令复核')
}
process.exit(hardFailed === 0 && inconclusiveCount === 0 ? 0 : 1)
