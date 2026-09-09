/**
 * 模块 3（程序填空 code_completion）验收实测。
 *
 * 为什么值得为它引一次 Vite（沿用 scripts/judge-verify.ts 的既有做法）：
 * 判分链路 blank-match.ts / stdin-run.ts / judge/client.ts / backends/godbolt.ts 用了
 * import.meta.env，裸 node 加载不了；用 middlewareMode + ssrLoadModule 直接跑**应用真正
 * 会执行的那份代码**，验收口径与线上口径同源，不会出现「脚本一套实现、页面另一套实现」。
 *
 * 四个场景 × 18 道题，全部真实打 Godbolt（cg132 + executorRequest/filters.execute 双开关，
 * 严格串行 —— runTests 内部是 for await，本脚本外层也不并发）：
 *   correct   每空填 blanks[].answer            → 文本 exact 全命中 + 实机全组 accepted
 *   accepted  每空填 accepted[0]（无则 answer）  → 实机仍须全组 accepted
 *           （这一条就是「坑 1：等价写法必须连同上下文有效」的实测闸门）
 *   wrong     按下表填一个能编译但语义必错的写法 → 实机不得全组 accepted，且给出差异
 *   special   分号有无 / 词法粘连 / 语义翻转 的定向复现
 *
 * 判分事实一律取自实机结果，文本比对只作提示；任何一组 backend-unavailable 都算验收失败
 * （未判定 ≠ 通过），脚本以退出码 1 拒绝放行。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const IDS = [
  'c-ch04-cc-001', 'c-ch04-cc-002', 'c-ch04-cc-003', 'c-ch04-cc-004', 'c-ch04-cc-005', 'c-ch04-cc-006',
  'c-ch05-cc-001',
  'c-ch06-cc-001', 'c-ch06-cc-002', 'c-ch06-cc-003', 'c-ch06-cc-004',
  'c-ch07-cc-001',
  'c-ch09-cc-001', 'c-ch09-cc-002',
  'c-ch10-cc-001', 'c-ch10-cc-002', 'c-ch10-cc-003', 'c-ch10-cc-004',
]

/**
 * 「错误答案」表。逐题手写而不是自动生成：自动改写要猜上下文（for 的三段、if 的条件、
 * 参数列表），猜错就会退化成编译失败或死循环（死循环要吃满 Godbolt 20 s 执行时限），
 * 反而验不到「输出比对」这件事。下面每条都保证：能编译、不挂死、输出必与参考不同。
 */
const WRONG: Record<string, Record<number, string>> = {
  'c-ch04-cc-001': { 1: 'y>z' },
  'c-ch04-cc-002': { 1: 'c=c+6', 2: 'c=c-22' },
  'c-ch04-cc-003': { 1: "ch>'A'&&ch<='Z'" },
  'c-ch04-cc-004': { 1: 'x>2&&x<=4' },
  'c-ch04-cc-005': { 1: 'y%4==0&&y%100==0', 2: 'f=2' },
  'c-ch04-cc-006': { 1: 'len=30' },
  'c-ch05-cc-001': { 1: 'sum%4!=0' },
  'c-ch06-cc-001': { 1: '&a[0]' },
  'c-ch06-cc-002': { 2: 'b[i]=a[i-1]-a[i];' },
  'c-ch06-cc-003': { 1: 'j=3' },
  'c-ch06-cc-004': { 1: 'if(age>=16&&age<=30) a[age-16]++' },
  'c-ch07-cc-001': { 2: 'j%x1==0 || j%x2==0 || j%x3==0' },
  'c-ch09-cc-001': { 1: '*pk=n-1' },
  'c-ch09-cc-002': { 1: 'num=*a+1', 2: 'num=*c+1' },
  'c-ch10-cc-001': { 1: 'sizeof(bt)-1' },
  'c-ch10-cc-002': { 3: '||' },
  'c-ch10-cc-003': { 3: '&b,&a' },
  'c-ch10-cc-004': { 1: '<person+2' },
}

interface Blank { index: number; answer: string; accepted: string[] }
interface Case { stdin: string; expected: string; note?: string }
interface Problem { id: string; type: string; code: string; blanks: Blank[]; testCases: Case[]; solution?: string }

/**
 * SSR 加载到的**应用真实模块**的形状。这里手写本地结构类型而不是 typeof import('../src/…')：
 * tsconfig.scripts.json 是 nodenext + include:['scripts']，跨项目 import src 会触发 TS6307
 * （src 不在本项目文件清单里），且 src 内部用的是无扩展名相对导入，与 nodenext 不兼容。
 * scripts/judge-verify.ts 早就是同一套做法（本地 Backend / ExecResult 接口）。
 */
interface BlankMatchView {
  index: number
  kind: 'exact' | 'accepted' | 'mismatch' | 'empty'
  givenRaw: string
  given: string
  expected: string
  accepted: string[]
  matchedVariant: string | null
  whitespaceOnly: boolean
  hint?: string
  diff: { given: string; closest: string; closestFrom: 'answer' | 'accepted'; distance: number | null; firstDiffColumn: number | null; hint: string } | null
}
interface BlankGradeView {
  perBlank: BlankMatchView[]
  total: number
  filled: number
  emptyIndexes: number[]
  exactCount: number
  acceptedCount: number
  mismatchCount: number
  allFilled: boolean
  allMatched: boolean
}
interface Target {
  template: string
  slots: Array<{ index: number; start: number; end: number }>
  blanks: Blank[]
  caseCount: number
  solution: string
  blocking: string | null
  warnings: string[]
}
interface ProblemTestCase { stdin: string; expected: string; note?: string }
interface TestCaseResult {
  index: number
  stdin: string
  note?: string
  ms: number
  cacheHit: boolean
  response: { state: string; summary: string; diagnostics?: Array<{ line: number; column: number; severity: string; message: string }> }
}
interface BatchReport {
  results: TestCaseResult[]
  timings: number[]
  cacheHits: number
  totalMs: number
  acceptedCount: number
}
type StdinRunResult = { kind: 'done'; report: BatchReport } | { kind: 'error'; summary: string }
interface Client { runTests(code: string, testCases: ProblemTestCase[], onProgress?: (p: unknown) => void): Promise<BatchReport> }
interface BM {
  blankMarkerRe(): RegExp
  assembleCompletion(template: string, values: Record<number, string>): string
  gradeBlanks(values: Record<number, string>, blanks: Blank[]): BlankGradeView
  completionTarget(problem: Problem): Target
}
interface SR {
  createJudgeClient(): Client
  toProblemTestCases(cases: Case[] | undefined): ProblemTestCase[]
  runStdinTests(client: Client, code: string, testCases: ProblemTestCase[], onProgress?: (p: unknown) => void): Promise<StdinRunResult>
}
type Cases = ProblemTestCase[]

interface Row {
  scenario: string
  id: string
  textExact: number
  textAccepted: number
  textMismatch: number
  execPass: number
  execTotal: number
  firstBad: string
  diff: string
  ms: number
  /** 传输层故障导致的串行复跑轮数（0 = 一次就拿到稳定结论） */
  retries: number
  verdict: 'PASS' | 'FAIL'
  reason?: string
}

function loadProblems(): Map<string, Problem> {
  const shards = new Map<string, Problem[]>()
  const out = new Map<string, Problem>()
  for (const id of IDS) {
    const ch = id.slice(0, 6)
    if (!shards.has(ch)) {
      const doc = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'problems', ch + '.json'), 'utf8')) as { problems: Problem[] }
      shards.set(ch, doc.problems)
    }
    const p = shards.get(ch)?.find((x) => x.id === id)
    if (!p) throw new Error('题库里找不到 ' + id)
    out.set(id, p)
  }
  return out
}

const rows: Row[] = []
let requests = 0

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

  const bm = (await server.ssrLoadModule('/src/modules/problems/grading/blank-match.ts')) as unknown as BM
  const sr = (await server.ssrLoadModule('/src/modules/problems/grading/stdin-run.ts')) as unknown as SR
  const client = sr.createJudgeClient()
  console.log('SSR 就绪。开始实机验收（严格串行）\n')

  // ── 前置：模板标记必须能被 blank-match 认出（本轮修的就是这条） ──
  const targets = new Map<string, Target>()
  for (const id of IDS) {
    const t = bm.completionTarget(problems.get(id) as Problem)
    targets.set(id, t)
    if (t.blocking !== null) {
      rows.push(blankRow('precondition', id, 'FAIL', 'completionTarget 判 blocking：' + t.blocking))
      continue
    }
    if (t.slots.length !== t.blanks.length) {
      rows.push(blankRow('precondition', id, 'FAIL', `标记数 ${t.slots.length} != blanks 数 ${t.blanks.length}`))
    }
  }

  for (const id of IDS) {
    const p = problems.get(id) as Problem
    const t = targets.get(id)
    if (!t || t.blocking !== null) continue
    const cases = sr.toProblemTestCases(p.testCases)

    // correct
    const vCorrect: Record<number, string> = {}
    for (const b of t.blanks) vCorrect[b.index] = b.answer
    await run('correct', id, t, vCorrect, cases, 'pass', bm, sr, client)

    // accepted（只有存在 accepted 的题才跑）
    if (t.blanks.some((b) => b.accepted.length > 0)) {
      const vAcc: Record<number, string> = {}
      for (const b of t.blanks) vAcc[b.index] = b.accepted[0] ?? b.answer
      await run('accepted', id, t, vAcc, cases, 'pass', bm, sr, client)
    }

    // wrong
    const w = WRONG[id] ?? {}
    const vWrong: Record<number, string> = {}
    for (const b of t.blanks) vWrong[b.index] = w[b.index] ?? b.answer
    await run('wrong', id, t, vWrong, cases, 'fail', bm, sr, client)
  }

  // ── 定向复现：坑 1 / 坑 2 / 分号 ──
  await specials(problems, targets, bm, sr, client)

  await server.close()
  report()
}

function blankRow(scenario: string, id: string, verdict: 'PASS' | 'FAIL', reason?: string): Row {
  return { scenario, id, textExact: 0, textAccepted: 0, textMismatch: 0, execPass: 0, execTotal: 0, firstBad: '-', diff: '-', ms: 0, retries: 0, verdict, reason }
}

const TRANSPORT_STATES = new Set(['backend-unavailable'])

function isTransportOnly(outcome: StdinRunResult): boolean {
  if (outcome.kind === 'error') return true
  const states = outcome.report.results.map((r) => r.response.state)
  return states.length > 0 && states.every((s) => TRANSPORT_STATES.has(s))
}

const RETRY_ROUNDS = 2
const RETRY_BACKOFF_MS = 3000

/**
 * 传输层故障（后端 5xx / 网络失败 / 冷却期降级）按 AGENTS.md 裁决**串行复跑 2 轮**：
 * 「未判定」不等于「失败」，一次 502 不该把整道题的验收结论带沟里。
 * 内容错误（编译失败 / 输出不符）一律不重试 —— 那是稳定结论，重放只是烧时间。
 * 复跑不会重复计费已成功的用例：JudgeClient 只缓存成功结果，降级结果不入缓存。
 */
async function execWithRetry(
  sr: SR, client: Client, assembled: string, cases: Cases, label: string,
): Promise<{ outcome: StdinRunResult; retries: number }> {
  let outcome = await sr.runStdinTests(client, assembled, cases)
  let retries = 0
  for (let round = 1; round <= RETRY_ROUNDS; round += 1) {
    if (!isTransportOnly(outcome)) break
    retries = round
    console.log(`  ↻ ${label}：判分后端不可用（未判定），串行复跑第 ${round}/${RETRY_ROUNDS} 轮（先等 ${RETRY_BACKOFF_MS / 1000} s 冷却）…`)
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
    outcome = await sr.runStdinTests(client, assembled, cases)
  }
  return { outcome, retries }
}

async function run(
  scenario: string,
  id: string,
  t: Target,
  values: Record<number, string>,
  cases: Cases,
  expect: 'pass' | 'fail',
  bm: BM,
  sr: SR,
  client: Client,
): Promise<void> {
  const grade = bm.gradeBlanks(values, t.blanks)
  const assembled = bm.assembleCompletion(t.template, values)
  const t0 = Date.now()
  const before = requests
  const { outcome, retries } = await execWithRetry(sr, client, assembled, cases, scenario + ' ' + id)
  const ms = Date.now() - t0
  if (outcome.kind === 'error') {
    rows.push({ ...blankRow(scenario, id, 'FAIL', outcome.summary), ms, retries })
    return
  }
  const rep = outcome.report
  requests = before + rep.results.filter((r) => !r.cacheHit).length
  const bad = rep.results.find((r) => r.response.state !== 'accepted')
  const states = rep.results.map((r) => r.response.state)
  const inconclusive = states.filter((s) => s === 'backend-unavailable' || s === 'truncated').length
  const allAccepted = rep.results.length > 0 && states.every((s) => s === 'accepted')

  let verdict: 'PASS' | 'FAIL' = expect === 'pass' ? (allAccepted ? 'PASS' : 'FAIL') : (allAccepted ? 'FAIL' : 'PASS')
  const reason: string[] = []
  if (inconclusive > 0) {
    verdict = 'FAIL'
    reason.push(`${inconclusive} 组未判定（后端不可用/截断）—— 未判定不得当作验收通过`)
  }
  if (expect === 'pass' && !allAccepted && reason.length === 0) {
    reason.push(`期望全组通过，实际 ${rep.acceptedCount}/${rep.results.length}`)
  }
  if (expect === 'fail' && allAccepted) {
    reason.push('期望判错，实机却全组通过：错误答案没被抓住')
  }
  if (expect === 'pass' && !grade.allMatched) {
    reason.push(`文本比对未全命中（exact ${grade.exactCount} / accepted ${grade.acceptedCount} / mismatch ${grade.mismatchCount}）`)
  }

  const mismatch = grade.perBlank.find((m) => m.kind === 'mismatch')
  rows.push({
    scenario, id,
    textExact: grade.exactCount, textAccepted: grade.acceptedCount, textMismatch: grade.mismatchCount,
    execPass: rep.acceptedCount, execTotal: rep.results.length,
    firstBad: bad ? `#${bad.index} ${bad.response.state}` : '-',
    diff: mismatch?.diff ? `${mismatch.diff.hint}｜closest=${JSON.stringify(mismatch.diff.closest)}｜col=${String(mismatch.diff.firstDiffColumn)}` : '-',
    ms, retries, verdict, reason: reason.join('；') || undefined,
  })
  console.log(
    `${verdict} ${scenario.padEnd(9)} ${id.padEnd(15)} 文本 ${grade.exactCount}e/${grade.acceptedCount}a/${grade.mismatchCount}m` +
    ` 实机 ${rep.acceptedCount}/${rep.results.length}` +
    (bad ? ` 首个非通过 #${bad.index}=${bad.response.state}` : '') +
    (reason.length ? ` ← ${reason.join('；')}` : ''),
  )
}

async function specials(
  problems: Map<string, Problem>,
  targets: Map<string, Target>,
  bm: BM,
  sr: SR,
  client: Client,
): Promise<void> {
  console.log('\n── 定向复现 ──')

  // 坑 2：词法粘连。else/*__BLANK_3__*/ + len=28 曾拼成 elselen=28 → 编译失败。
  for (const id of IDS) {
    const t = targets.get(id)
    if (!t) continue
    const values: Record<number, string> = {}
    for (const b of t.blanks) values[b.index] = b.answer
    const asm = bm.assembleCompletion(t.template, values)
    const problemsFound: string[] = []
    if (bm.blankMarkerRe().test(asm)) problemsFound.push('拼装后仍残留空位标记')
    for (const b of t.blanks) {
      if (!asm.includes(' ' + b.answer + ' ')) problemsFound.push(`空位 ${b.index} 的答案没有被空格包裹`)
    }
    if (/else[A-Za-z_(]/.test(asm)) problemsFound.push('出现 else 与后续 token 粘连')
    rows.push(blankRow('glue', id, problemsFound.length === 0 ? 'PASS' : 'FAIL', problemsFound.join('；') || undefined))
  }
  const glueFail = rows.filter((r) => r.scenario === 'glue' && r.verdict === 'FAIL')
  console.log(`${glueFail.length === 0 ? 'PASS' : 'FAIL'} glue      全部 ${IDS.length} 题：答案空格包裹、无标记残留、无 else 粘连` +
    (glueFail.length ? ` ← ${glueFail.map((r) => r.id + ': ' + r.reason).join(' | ')}` : ''))

  const t601 = targets.get('c-ch06-cc-001') as Target
  const p601 = problems.get('c-ch06-cc-001') as Problem
  const c601 = sr.toProblemTestCases(p601.testCases)

  // 坑 1a：模板自带分号 → 填不带分号的 printf("\n") 必须判错（缺分号语法错），不能蒙混过关
  {
    const v: Record<number, string> = { 1: '&a[i]', 2: 'i%4==0', 3: 'printf("\\n")' }
    await runSpecial('semicolon-missing', 'c-ch06-cc-001', t601, v, c601, 'fail', bm, sr, client,
      '空位 3 填不带分号的 printf("\\n")：模板此处没有分号，拼装后应为编译失败')
  }
  // 分号正例：带分号 → 通过
  {
    const v: Record<number, string> = { 1: '&a[i]', 2: 'i%4==0', 3: 'printf("\\n");' }
    await runSpecial('semicolon-ok', 'c-ch06-cc-001', t601, v, c601, 'pass', bm, sr, client,
      '空位 3 填带分号的 printf("\\n");：应全组通过')
  }
  // 坑 1b：if(/*__BLANK_3__*/==0) 里填 i%3==0 → (i%3==0)==0 语义翻转，必须判错
  const t602 = targets.get('c-ch06-cc-002') as Target
  const p602 = problems.get('c-ch06-cc-002') as Problem
  const c602 = sr.toProblemTestCases(p602.testCases)
  {
    const v: Record<number, string> = { 1: 'i=1', 2: 'b[i]=a[i-1]+a[i];', 3: 'i%3==0' }
    await runSpecial('ctx-flip', 'c-ch06-cc-002', t602, v, c602, 'fail', bm, sr, client,
      '空位 3 在 if(<<3>>==0) 里填 i%3==0 → 变成 (i%3==0)==0，语义翻转必须判错')
  }
  // 模板自带分号 → 填 y=-1 与 y=-1; 都应通过（accepted 里正是这两种写法）
  const t404 = targets.get('c-ch04-cc-004') as Target
  const p404 = problems.get('c-ch04-cc-004') as Problem
  const c404 = sr.toProblemTestCases(p404.testCases)
  for (const third of ['y=-1', 'y=-1;']) {
    const v: Record<number, string> = { 1: 'x>2&&x<=10', 2: 'x>-1&&x<=2', 3: third }
    await runSpecial('semi-optional', 'c-ch04-cc-004', t404, v, c404, 'pass', bm, sr, client,
      `模板为 else <<3>>; ，空位 3 填 ${JSON.stringify(third)} 都应通过`)
  }
  // for(<<2>>i++) 里填缺末尾分号的 i=16;i<=31 → 必须判错（坑 1 第三例）
  const t604 = targets.get('c-ch06-cc-004') as Target
  const p604 = problems.get('c-ch06-cc-004') as Problem
  const c604 = sr.toProblemTestCases(p604.testCases)
  {
    const v: Record<number, string> = { 1: 'if(age>=16&&age<=31) a[age-16]++', 2: 'i=16;i<=31' }
    await runSpecial('for-semi', 'c-ch06-cc-004', t604, v, c604, 'fail', bm, sr, client,
      '空位 2 在 for(<<2>>i++) 里填缺末尾分号的 i=16;i<=31 → 应为编译失败')
  }
}

async function runSpecial(
  scenario: string, id: string, t: Target, values: Record<number, string>,
  cases: Cases, expect: 'pass' | 'fail',
  bm: BM, sr: SR, client: Client, note: string,
): Promise<void> {
  const grade = bm.gradeBlanks(values, t.blanks)
  const assembled = bm.assembleCompletion(t.template, values)
  const t0 = Date.now()
  const before = requests
  const { outcome, retries } = await execWithRetry(sr, client, assembled, cases, scenario + ' ' + id)
  const ms = Date.now() - t0
  if (outcome.kind === 'error') { rows.push({ ...blankRow(scenario, id, 'FAIL', outcome.summary), ms, retries }); console.log(`FAIL ${scenario} ${id} ← ${outcome.summary}`); return }
  const rep = outcome.report
  requests = before + rep.results.filter((r) => !r.cacheHit).length
  const states = rep.results.map((r) => r.response.state)
  const allAccepted = rep.results.length > 0 && states.every((s) => s === 'accepted')
  const bad = rep.results.find((r) => r.response.state !== 'accepted')
  const inconclusive = states.filter((s) => s === 'backend-unavailable' || s === 'truncated').length
  let verdict: 'PASS' | 'FAIL' = expect === 'pass' ? (allAccepted ? 'PASS' : 'FAIL') : (allAccepted ? 'FAIL' : 'PASS')
  const reason: string[] = []
  if (inconclusive > 0) { verdict = 'FAIL'; reason.push(`${inconclusive} 组未判定`) }
  if (expect === 'fail' && allAccepted) reason.push('期望判错却全组通过')
  if (expect === 'pass' && !allAccepted) reason.push(`期望通过，实际 ${rep.acceptedCount}/${rep.results.length}`)
  const mismatch = grade.perBlank.find((m) => m.kind === 'mismatch')
  rows.push({
    scenario, id,
    textExact: grade.exactCount, textAccepted: grade.acceptedCount, textMismatch: grade.mismatchCount,
    execPass: rep.acceptedCount, execTotal: rep.results.length,
    firstBad: bad ? `#${bad.index} ${bad.response.state}` + (bad.response.diagnostics?.[0]?.message ? ' ' + bad.response.diagnostics[0].message.slice(0, 70) : '') : '-',
    diff: mismatch?.diff ? mismatch.diff.hint : '-',
    ms, retries, verdict, reason: reason.join('；') || undefined,
  })
  console.log(`${verdict} ${scenario.padEnd(16)} ${id.padEnd(15)} 实机 ${rep.acceptedCount}/${rep.results.length}` +
    (bad ? ` 首个非通过 #${bad.index}=${bad.response.state}` : '') + ` ｜ ${note}` + (reason.length ? ` ← ${reason.join('；')}` : ''))
}

function report(): void {
  const fail = rows.filter((r) => r.verdict === 'FAIL')
  const byScenario = new Map<string, { pass: number; fail: number }>()
  for (const r of rows) {
    const e = byScenario.get(r.scenario) ?? { pass: 0, fail: 0 }
    if (r.verdict === 'PASS') e.pass += 1; else e.fail += 1
    byScenario.set(r.scenario, e)
  }
  console.log('\n════ 汇总 ════')
  for (const [k, v] of byScenario) console.log(`  ${k.padEnd(17)} PASS ${String(v.pass).padStart(2)}  FAIL ${v.fail}`)
  const totalMs = rows.reduce((a, r) => a + r.ms, 0)
  console.log(`  真实网络请求 ${requests} 次（严格串行），执行合计 ${(totalMs / 1000).toFixed(1)} s`)
  console.log(`  传输层复跑 ${rows.filter((r) => r.retries > 0).length} 项（后端抖动按「未判定」串行复跑，内容错误不重试）`)
  console.log(`  总判定 ${rows.length} 项，失败 ${fail.length} 项`)
  if (fail.length > 0) {
    console.log('\n失败明细：')
    for (const f of fail) console.log(`  ${f.scenario} / ${f.id}: ${f.reason ?? f.firstBad}`)
  }
  writeFileSync(join(ROOT, 'tmp', 'acceptance-cc.json'), JSON.stringify({ requests, rows }, null, 2), 'utf8')
  console.log('\n证据已写入 tmp/acceptance-cc.json')
  if (fail.length > 0) process.exitCode = 1
}

await main()