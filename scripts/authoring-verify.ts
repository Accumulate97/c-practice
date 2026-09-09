/**
 * 出题期实机验证 —— debug 三条硬要求 + code_completion 救援（solution / accepted 备选）。
 *
 * 为什么复用 Vite SSR 加载 src/judge：归一化与分类逻辑必须与线上判分同源（base.normalizeOutput、
 * godbolt.classify），脚本里另写一套等于给自己埋「脚本判过、页面判不过」的坑。
 *
 * debug 题的三条（缺一不可，否则不是合格的改错题）：
 *   ① bug 版必须**能编译**（errorClass != compile-error）——编译不过就成语法题了
 *   ② bug 版至少有一组用例输出与 expected 不同——否则 bug 被用例掩盖，学生改不改都一样
 *   ③ fixed_code 三组用例全部与 expected 逐字一致（normalizeOutput 之后）
 *
 * 救援题：solution 全组匹配；每个 accepted 备选**连同上下文**拼装回空白标记（__BLANK_n__ 形式的注释占位符）后编译运行，
 * 输出必须与 solution 逐字一致，否则该备选是「字符串像对、语义翻转/语法错」的假备选，剔除。
 *
 * 用法：
 *   node scripts/authoring-verify.ts            跑全部请求，结果写 tmp/authoring-verify-result.json（不改源数据）
 *   node scripts/authoring-verify.ts --apply    离线读结果 JSON，把 verification 写回两个源文件并剔除假备选
 *   node scripts/authoring-verify.ts --only=题9.78,c-ch05-dbg-006   只跑指定题（返工用，省请求）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEBUG_FILE = join(ROOT, 'authored', 'debug-batch1.json')
const RESCUE_FILE = join(ROOT, 'rescued', 'cc10b.json')
const RESULT_FILE = join(ROOT, 'tmp', 'authoring-verify-result.json')
/** 出题期验证统一用 -O0：优化会把很多初学者错误「优化没了」，与教学目的相反 */
const ARGS = '-std=c99 -w -O0'
const TODAY = '2026-09-08'
const NORM_NOTE = "Godbolt 返回 stdout[].text 按行数组；比对前经 base.normalizeOutput（CRLF→LF、逐行剥行尾空白、剥末尾空行）"

const APPLY = process.argv.includes('--apply')
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)) : null

interface RunRec {
  stdin: string
  expected: string | null
  actual: string | null
  normExpected: string | null
  normActual: string | null
  match: boolean | null
  errorClass: string | null
  exitCode: number | null
  execTimeMs: number | null
  timedOut: boolean
  truncated: boolean
  didExecute: boolean | null
  stderr: string
  transportError: string | null
  compileError: string | null
  /** raw 断言失败（didExecute!==true / truncated!==false）时写明原因，禁止静默兜底 */
  invalid: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const cut = (s: string, n = 260) => (s.length <= n ? s : s.slice(0, n) + '…')

/* ------------------------------------------------------------------ 应用（离线） */
if (APPLY) {
  if (!existsSync(RESULT_FILE)) { console.error('缺少 ' + RESULT_FILE + '，请先不带 --apply 跑一次'); process.exit(1) }
  const R = JSON.parse(readFileSync(RESULT_FILE, 'utf8')) as ApplyShape
  const dbg = JSON.parse(readFileSync(DEBUG_FILE, 'utf8')) as Array<Record<string, unknown>>
  const rsc = JSON.parse(readFileSync(RESCUE_FILE, 'utf8')) as Array<Record<string, unknown>>
  let dropped = 0
  for (const d of R.debug) {
    const p = dbg.find((x) => x.id === d.id)
    if (!p) { console.error('源文件缺题 ' + d.id); process.exit(1) }
    if (!d.pass) { console.error('!! ' + d.id + ' 未通过三条验证，拒绝写入 verification'); continue }
    p.verification = {
      backend: 'Godbolt cg132 (gcc 13.2)', userArguments: ARGS, date: TODAY, stdoutNormalization: NORM_NOTE,
      buggy: d.buggy, fixed: d.fixed, summary: d.summary,
    }
  }
  for (const r of R.rescue) {
    const p = rsc.find((x) => x.originalId === r.originalId)
    if (!p) { console.error('源文件缺题 ' + r.originalId); process.exit(1) }
    if (!r.solutionPass) { console.error('!! ' + r.originalId + ' solution 未全组通过，拒绝写入 verification'); continue }
    const blanks = p.blanks as Array<{ index: number; answer: string; accepted?: string[] }>
    for (const bad of r.dropped) {
      const b = blanks.find((x) => x.index === bad.blank)
      if (b?.accepted?.includes(bad.answer)) {
        b.accepted = b.accepted.filter((a) => a !== bad.answer)
        if (b.accepted.length === 0) delete b.accepted
        dropped++
      }
    }
    p.verification = {
      backend: 'Godbolt cg132 (gcc 13.2)', userArguments: ARGS, date: TODAY, stdoutNormalization: NORM_NOTE,
      runs: r.runs, acceptedChecks: r.acceptedChecks, droppedAccepted: r.dropped, summary: r.summary,
    }
  }
  writeFileSync(DEBUG_FILE, JSON.stringify(dbg, null, 2) + '\n', 'utf8')
  writeFileSync(RESCUE_FILE, JSON.stringify(rsc, null, 2) + '\n', 'utf8')
  const dbgOk = R.debug.filter((d) => d.pass).length
  const rscOk = R.rescue.filter((r) => r.solutionPass).length
  console.log('APPLY 完成：debug verification 写入 ' + dbgOk + '/' + R.debug.length +
    '，rescue 写入 ' + rscOk + '/' + R.rescue.length + '，剔除假备选 ' + dropped + ' 条')
  process.exit(0)
}

/* ------------------------------------------------------------------ 后端启动 */
console.log('启动 Vite SSR 以加载应用真实的判分后端…')
const boot = Date.now()
const server = await createServer({
  configFile: false,
  root: resolve(ROOT).split('\\').join('/'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
})
type Backend = { id: string; maxConcurrency: number; minIntervalMs: number; timeoutMs: number; execute: (req: Record<string, unknown>) => Promise<ExecRes> }
type ExecRes = { errorClass: string; compiled: boolean; exitCode: number; stdout: string; stderr: string; compilerMessage: string; execTimeMs?: number; raw?: unknown; diagnostics?: Array<{ message: string }> }
let backend: Backend
let normalize: (s: string) => string
try {
  const mod = (await server.ssrLoadModule('/src/judge/backends/godbolt.ts')) as { createGodboltBackend: (o: Record<string, unknown>) => Backend }
  const base = (await server.ssrLoadModule('/src/judge/backends/base.ts')) as { normalizeOutput: (s: string) => string }
  backend = mod.createGodboltBackend({})
  normalize = base.normalizeOutput
} finally {
  await server.close()
}
console.log('后端就绪（' + (Date.now() - boot) + 'ms）id=' + backend.id + ' minIntervalMs=' + backend.minIntervalMs + ' timeoutMs=' + backend.timeoutMs + ' args="' + ARGS + '"')

/* ------------------------------------------------------------------ 串行执行器 */
let lastAt = 0
let reqCount = 0
async function run(code: string, stdin: string, expected: string | null): Promise<RunRec> {
  const rec: RunRec = {
    stdin, expected, actual: null, normExpected: expected === null ? null : normalize(expected), normActual: null,
    match: null, errorClass: null, exitCode: null, execTimeMs: null, timedOut: false, truncated: false,
    didExecute: null, stderr: '', transportError: null, compileError: null, invalid: null,
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const gap = backend.minIntervalMs - (Date.now() - lastAt)
    if (gap > 0) await sleep(gap)
    lastAt = Date.now(); reqCount++
    try {
      const res = await backend.execute({ code, stdin, userArguments: ARGS, compileOnly: false })
      // 硬断言：响应是扁平的，raw 就是它。didExecute!==true / truncated!==false 一律视为不可信结果。
      const raw = res.raw
      if (!raw || typeof raw !== 'object') { rec.invalid = '后端响应缺 raw，无法断言 didExecute/truncated'; return rec }
      const j = raw as { didExecute?: unknown; truncated?: unknown; timedOut?: unknown }
      rec.didExecute = j.didExecute === true
      rec.truncated = j.truncated === true
      rec.timedOut = j.timedOut === true
      rec.errorClass = res.errorClass
      rec.exitCode = res.exitCode
      rec.execTimeMs = res.execTimeMs ?? null
      rec.stderr = res.stderr ?? ''
      rec.compileError = res.errorClass === 'compile-error' ? cut(res.compilerMessage ?? res.diagnostics?.map((d) => d.message).join('\n') ?? '', 500) : null
      rec.actual = res.stdout ?? ''
      rec.normActual = normalize(rec.actual)
      rec.match = expected === null ? null : rec.normActual === rec.normExpected
      // 编译失败时 Godbolt 不返回 truncated/didExecute，这是**确定结论**不是「不可信」，
      // 若在这里误标 invalid，上层会把它当成后端抖动而掩盖真正的数据缺陷（题4.99 就是这么被埋掉的）。
      if (res.errorClass === 'compile-error') rec.invalid = null
      else if (j.didExecute !== true) rec.invalid = 'didExecute=' + String(j.didExecute) + '（结果不可信，禁止兜底）'
      else if (j.truncated !== false) rec.invalid = 'truncated=' + String(j.truncated) + '（输出被截断）'
      return rec
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      rec.transportError = cut(msg, 200)
      if (attempt < 3) { await sleep(900); continue }   // 传输层故障串行复跑 2 轮；内容错误不重试
    }
  }
  return rec
}

/* ------------------------------------------------------------------ 数据 */
const dbgProbs = JSON.parse(readFileSync(DEBUG_FILE, 'utf8')) as Array<{
  id: string; code: string; fixed_code: string; bugs: string[]
  testCases: Array<{ stdin: string; expected: string; note?: string }>
}>
const rscProbs = JSON.parse(readFileSync(RESCUE_FILE, 'utf8')) as Array<{
  originalId: string; code: string; solution: string
  blanks: Array<{ index: number; answer: string; accepted?: string[] }>
  testCases: Array<{ stdin: string; expected: string; note?: string }>
}>
const keep = (k: string) => !ONLY || ONLY.has(k)

interface DebugOut { id: string; pass: boolean; buggyCompiled: boolean; maskedCases: number; diffCases: number; fixedPass: number; buggy: { compiled: boolean; runs: RunRec[] }; fixed: { runs: RunRec[] }; notes: string[]; summary: string }
interface RescueOut { originalId: string; solutionPass: boolean; runs: RunRec[]; acceptedChecks: Array<{ blank: number; answer: string; identical: boolean; runs: RunRec[] }>; dropped: Array<{ blank: number; answer: string; reason: string }>; notes: string[]; summary: string }
interface ApplyShape { debug: DebugOut[]; rescue: RescueOut[] }

const debugOut: DebugOut[] = []
const rescueOut: RescueOut[] = []
const t0 = Date.now()

/* ---------------- debug：三条 ---------------- */
for (const p of dbgProbs.filter((x) => keep(x.id))) {
  const notes: string[] = []
  const buggyRuns: RunRec[] = []
  const fixedRuns: RunRec[] = []
  let buggyCompiled = true
  let diffCases = 0
  let masked = 0
  let inconclusive = 0
  for (const tc of p.testCases) {
    const b = await run(p.code, tc.stdin, tc.expected)
    buggyRuns.push(b)
    if (b.transportError || b.invalid) { inconclusive++; buggyCompiled = buggyCompiled && !b.compileError; notes.push('bug 版用例「' + (tc.note ?? '') + '」未判定：' + (b.transportError ?? b.invalid)) }
    else if (b.errorClass === 'compile-error') { buggyCompiled = false; notes.push('① 失败：bug 版编译不过 → ' + cut(b.compileError ?? '', 160)) }
    else if (b.match === true) { masked++; notes.push('② 用例「' + (tc.note ?? '') + '」被掩盖（bug 版输出与正确答案相同）') }
    else diffCases++
  }
  let fixedPass = 0
  for (const tc of p.testCases) {
    const f = await run(p.fixed_code, tc.stdin, tc.expected)
    fixedRuns.push(f)
    if (f.transportError || f.invalid) { inconclusive++; notes.push('fixed 版用例「' + (tc.note ?? '') + '」未判定：' + (f.transportError ?? f.invalid)) }
    else if (f.match !== true) notes.push('③ 失败：fixed 版用例「' + (tc.note ?? '') + '」' + f.errorClass + ' actual=' + JSON.stringify(cut(f.normActual ?? '', 120)) + ' expected=' + JSON.stringify(cut(f.normExpected ?? '', 120)))
    else fixedPass++
  }
  if (inconclusive > 0) notes.push('存在 ' + inconclusive + ' 组「未判定」（后端抖动），本题结论不下')
  if (buggyCompiled && diffCases === 0 && inconclusive === 0) notes.push('② 失败：三组用例全部掩盖了 bug，需换用例')
  const pass = inconclusive === 0 && buggyCompiled && diffCases >= 1 && fixedPass === p.testCases.length
  const summary = pass
    ? 'bug 版编译通过且 ' + diffCases + '/' + p.testCases.length + ' 组用例暴露错误' + (masked ? '（' + masked + ' 组被掩盖，已在 note 标注）' : '') +
      '；fixed_code ' + fixedPass + '/' + p.testCases.length + ' 组与 expected 逐字一致（Godbolt cg132 gcc13.2 ' + ARGS + '，' + TODAY + '）'
    : '未通过：' + notes.join('；')
  debugOut.push({ id: p.id, pass, buggyCompiled, maskedCases: masked, diffCases, fixedPass, buggy: { compiled: buggyCompiled, runs: buggyRuns }, fixed: { runs: fixedRuns }, notes, summary })
  console.log((pass ? 'PASS ' : 'FAIL ') + p.id + ' ①compile=' + buggyCompiled + ' ②diff=' + diffCases + '/' + p.testCases.length + ' masked=' + masked + ' ③fixed=' + fixedPass + '/' + p.testCases.length + (notes.length ? '\n     ' + cut(notes.join(' | '), 400) : ''))
}

/* ---------------- rescue：solution + accepted 上下文拼装 ---------------- */
for (const p of rscProbs.filter((x) => keep(x.originalId))) {
  const notes: string[] = []
  const runs: RunRec[] = []
  let solutionPass = true
  let inconclusive = 0
  for (const tc of p.testCases) {
    const r = await run(p.solution, tc.stdin, tc.expected)
    runs.push(r)
    if (r.transportError || r.invalid) { inconclusive++; solutionPass = false; notes.push('solution 用例「' + (tc.note ?? '') + '」未判定：' + (r.transportError ?? r.invalid)) }
    else if (r.match !== true) {
      solutionPass = false
      notes.push('solution 用例「' + (tc.note ?? '') + '」' + r.errorClass + (r.compileError ? '\n       compile=' + cut(r.compileError, 300) : '') + '\n       actual  =' + JSON.stringify(cut(r.normActual ?? '', 200)) + '\n       expected=' + JSON.stringify(cut(r.normExpected ?? '', 200)))
    }
  }
  const acceptedChecks: RescueOut['acceptedChecks'] = []
  const dropped: RescueOut['dropped'] = []
  for (const b of p.blanks) {
    for (const alt of b.accepted ?? []) {
      const assembled = p.code.replace(/\/\*__BLANK_(\d+)__\*\//g, (_, k) => (Number(k) === b.index ? alt : (p.blanks.find((x) => x.index === Number(k))?.answer ?? '')))
      const altRuns: RunRec[] = []
      let identical = true
      let why = ''
      for (let i = 0; i < p.testCases.length; i++) {
        const tc = p.testCases[i]
        const r = await run(assembled, tc.stdin, tc.expected)
        altRuns.push(r)
        if (r.transportError || r.invalid) { inconclusive++; identical = false; why = '未判定：' + (r.transportError ?? r.invalid ?? ''); break }
        if (r.errorClass === 'compile-error') { identical = false; why = '拼装后编译失败（缺分号/语法错）：' + cut(r.compileError ?? '', 160); break }
        if (r.normActual !== normalize(runs[i]?.actual ?? '')) { identical = false; why = '输出与 solution 不同（语义翻转）：' + JSON.stringify(cut(r.normActual ?? '', 100)) + ' vs ' + JSON.stringify(cut(runs[i]?.normActual ?? '', 100)); break }
      }
      acceptedChecks.push({ blank: b.index, answer: alt, identical, runs: altRuns })
      if (!identical) { dropped.push({ blank: b.index, answer: alt, reason: why }); notes.push('剔除备选【' + b.index + '】' + JSON.stringify(alt) + ' → ' + cut(why, 200)) }
    }
  }
  if (inconclusive > 0) notes.push('存在 ' + inconclusive + ' 组「未判定」（后端抖动）')
  const kept = p.blanks.reduce((s, b) => s + ((b.accepted?.length ?? 0) - dropped.filter((d) => d.blank === b.index).length), 0)
  const summary = solutionPass && inconclusive === 0
    ? p.testCases.length + '/' + p.testCases.length + ' 组用例实机编译+执行通过，stdout 与建模预测逐字一致；accepted 备选连同上下文拼装复验，保留 ' + kept + ' 条、剔除 ' + dropped.length + ' 条（Godbolt cg132 gcc13.2 ' + ARGS + '，' + TODAY + '）'
    : '未通过：' + notes.join('；')
  rescueOut.push({ originalId: p.originalId, solutionPass: solutionPass && inconclusive === 0, runs, acceptedChecks, dropped, notes, summary })
  console.log((solutionPass && inconclusive === 0 ? 'PASS ' : 'FAIL ') + p.originalId + ' solution=' + runs.filter((r) => r.match === true).length + '/' + p.testCases.length +
    ' accepted 保留=' + kept + ' 剔除=' + dropped.length + (notes.length ? '\n     ' + cut(notes.join(' | '), 500) : ''))
}

// 合并而非覆盖：--only 返工时不能冲掉其余题的既有结论
const prev = existsSync(RESULT_FILE) ? (JSON.parse(readFileSync(RESULT_FILE, 'utf8')) as ApplyShape) : { debug: [], rescue: [] }
const merged: ApplyShape = {
  debug: [...prev.debug.filter((d) => !debugOut.some((x) => x.id === d.id)), ...debugOut],
  rescue: [...prev.rescue.filter((r) => !rescueOut.some((x) => x.originalId === r.originalId)), ...rescueOut],
}
merged.debug.sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(RESULT_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8')
const dbgPass = merged.debug.filter((d) => d.pass).length
const rscPass = merged.rescue.filter((r) => r.solutionPass).length
console.log('\n===== 汇总 =====')
console.log('请求数=' + reqCount + ' 耗时=' + Math.round((Date.now() - t0) / 1000) + 's（严格串行，minIntervalMs=' + backend.minIntervalMs + '）')
console.log('debug  PASS ' + dbgPass + '/' + merged.debug.length + (dbgPass < merged.debug.length ? '  失败：' + merged.debug.filter((d) => !d.pass).map((d) => d.id).join(',') : ''))
console.log('rescue PASS ' + rscPass + '/' + merged.rescue.length + (rscPass < merged.rescue.length ? '  失败：' + merged.rescue.filter((r) => !r.solutionPass).map((r) => r.originalId).join(',') : ''))
console.log('假备选剔除共 ' + merged.rescue.reduce((s, r) => s + r.dropped.length, 0) + ' 条')
console.log('结果已写 ' + RESULT_FILE + '；确认无误后跑 node scripts/authoring-verify.ts --apply')
process.exit(dbgPass === merged.debug.length && rscPass === merged.rescue.length ? 0 : 1)