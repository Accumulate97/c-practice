/**
 * 阶段 5（进度体系 + 七个概念题渲染器）UI 验收：真实浏览器里跑 dist 产物。
 *
 * ── 与其它 acceptance 脚本的分工 ────────────────────────────────────────
 * acceptance-list-ui  模块 5 列表页（筛选 / 分页 / 三色状态）
 * acceptance-cc-ui    模块 3 程序填空（Godbolt 实机判分）
 * acceptance-dbg-ui   模块 4 程序改错（Godbolt 实机判分）
 * 本脚本              进度体系（迁移 / 错题本 / 统计 / 导出导入）+ 概念题即时判定
 *
 * ── 三条验收原则 ────────────────────────────────────────────────────────
 *   1. 分母一律拿 index.json 现算，脚本里不抄死数字（题库会长，抄死就会假绿）；
 *   2. 分子（已通过 / 尝试过 / 错题 / 收藏 / 笔记）在 Node 侧**从 localStorage 原始记录直接数布尔字段**，
 *      不 import 前端 stats.ts —— 用被测代码自己算基准等于没测；
 *   3. 概念题硬约束「不联网、不耗 Godbolt 额度」是**可测量的**：全程记录请求 URL，
 *      出现任何 godbolt.org 请求即判失败。
 *
 * ── 两处必须靠 route 注入 fixture 的地方（如实说明，不是掩盖）──────────────
 *   · fill_blank：库内 89 道题 blanks[].answer 全是空串（提取阶段的既成数据缺口），
 *     真实数据只能验到「缺陷面板 + 禁用提交」；判分路径要注入带答案的 fixture 才能跑通。
 *   · true_false / code_ordering / complexity / matching：库内 0 道，渲染器只能靠 fixture 验。
 *   fixture 只活在 page.route 的响应体里，一个字节都不写回仓库。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4176
const BASE = `http://127.0.0.1:${PORT}/`
const TMP = join(ROOT, 'tmp')
const PROGRESS_KEY = 'cpractice:progress:v1'

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }
mkdirSync(TMP, { recursive: true })

// ── 基准：全部从 index.json / 分片现算 ───────────────────────────────────
const INDEX = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/index.json'), 'utf8'))
const shardKeyOf = (file) => String(file).replace(/\.json$/i, '')
const entryOf = (id) => INDEX.problems.find((p) => p.id === id)
const shardOf = (id) => shardKeyOf(entryOf(id).file)
const readShard = (key) => JSON.parse(readFileSync(join(ROOT, 'public/data/problems', `${key}.json`), 'utf8'))
const problemOf = (id) => readShard(shardOf(id)).problems.find((p) => p.id === id)

const SC_ID = 'c-ch01-sc-001'          // single_choice，answer 是合法下标，可判分
const FB_ID = 'c-ch01-fb-001'          // fill_blank，库内 answer 为空 → 缺陷面板
const SA_REF_ID = 'c-ch09-sa-004'      // 18 道简答题里唯一带 reference_answer 的一道
const SC = problemOf(SC_ID)
const SC_ANSWER = SC.answer
const SC_WRONG = SC_ANSWER === 0 ? 1 : 0
const FB_BLANK_COUNT = (problemOf(FB_ID).blanks ?? []).length
const DEFECT_CR = INDEX.defects?.codeReadingNoAnswer ?? null

/**
 * 阶段 10-5：这三处的目标题一律现扫分片，不再写死 id。
 * 原因：写死那会儿库里确有数据缺口（概念填空 answer 全空 / 简答无参考答案 / 阅读题无 answer），
 * 后续阶段的详解与答案回填把缺口补齐了，写死的 id 指到的题已经「有答案」，断言必然假失败。
 * 扫不到缺口就退化成验当前真实形态（能作答 / 有参考答案 / 文字描述题的诚实说明），
 * 将来加 _staging 真题、数据结构题带进新缺口时，这段又会自己切回缺口分支。
 */
const ALL_PROBLEMS = (() => {
  const out = []
  for (const f of new Set(INDEX.problems.map((x) => x.file))) out.push(...readShard(String(f).replace(/\.json$/i, '')).problems)
  return out
})()
const FB_NO_ANSWER = (problemOf(FB_ID).blanks ?? []).every((b) => !(b.answer ?? '').trim())
const SA_GAP = ALL_PROBLEMS.find((x) => x.type === 'short_answer' && !(x.reference_answer ?? '').trim()) ?? null
const SA_NOREF_ID = SA_GAP?.id ?? ALL_PROBLEMS.find((x) => x.type === 'short_answer' && x.id !== SA_REF_ID)?.id
const CR_GAP = ALL_PROBLEMS.find((x) => x.type === 'code_reading' && !(x.answer ?? '').trim() && !x.answerIsDescription) ?? null
const CR_DESC_COUNT = ALL_PROBLEMS.filter((x) => x.type === 'code_reading' && x.answerIsDescription).length
const CR_GAP_COUNT = ALL_PROBLEMS.filter((x) => x.type === 'code_reading' && !(x.answer ?? '').trim() && !x.answerIsDescription).length
const CR_DEFECT_ID = CR_GAP?.id ?? ALL_PROBLEMS.find((x) => x.type === 'code_reading' && x.answerIsDescription)?.id
const CR_IS_DESC = CR_GAP === null

// fill_blank 判分路径的 fixture 答案（注入到 route 响应里，不写回仓库）
const FB_FIX = [{ index: 1, answer: '编译' }, { index: 2, answer: 'link' }]

/** 四个库内 0 题的题型：渲染器必须能跑，用 fixture 验 */
const FIXTURES = [
  { id: 'x-fix-tf', type: 'true_false', stem: '判断题 fixture：C 语言的数组下标从 0 开始。', answer: true, explanation: 'fixture：库内暂无 true_false 题，本条只用于验渲染器。' },
  { id: 'x-fix-order', type: 'code_ordering', stem: '排序 fixture：把三行排成正确顺序。', lines: ['L0', 'L1', 'L2'], correct_order: [1, 2, 0], explanation: 'fixture' },
  { id: 'x-fix-cx', type: 'complexity', stem: '复杂度 fixture：写出下面循环的时间复杂度。', code: 'for (int i = 0; i < n; i++) s += a[i];', answer: 'O(n)', accepted: ['n'], askSpace: false, explanation: 'fixture' },
  { id: 'x-fix-match', type: 'matching', stem: '匹配 fixture：把左边的类型名连到右边的中文。', pairs: [{ left: 'int', right: '整型' }, { left: 'char', right: '字符型' }], explanation: 'fixture' },
]

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}

const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
let previewErr = ''
preview.stderr.on('data', (d) => { previewErr += d.toString() })
async function waitPreview() {
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch(BASE); if (r.ok) return } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('vite preview 起不来：' + previewErr.slice(0, 400))
}

let browser = null   // 提到模块作用域：出错路径也要能关掉它（见文件末尾 finally）
const consoleMsgs = []
const pageErrors = []
const allRequests = []

// ── Node 侧独立算基准：只数 localStorage 原始记录里的布尔/数值字段 ──────────
function statusOfRaw(r) {
  if (!r) return 'todo'
  if (r.everPassed === true) return 'passed'
  if ((r.attempts ?? 0) > 0 || r.selfAssessed === true) return 'attempted'
  return 'todo'
}
function inBookRaw(r) {
  if (!r) return false
  if (r.result !== 'attempted') return false
  if (!((r.wrongCount ?? 0) > 0 || r.selfAssessed === true)) return false
  if (r.wrongDismissedAt === null || r.wrongDismissedAt === undefined) return true
  return r.wrongDismissedAt < (r.lastWrongAt ?? 0) || r.wrongDismissedAt < r.lastAt
}
/** 逐桶（总览 / 章节 / 题型）的期望值。records 直接来自浏览器 localStorage */
function tally(records) {
  const blank = () => ({ total: 0, passed: 0, attempted: 0, todo: 0, attempts: 0, wrongCount: 0, selfAssessed: 0, wrongBook: 0, starred: 0, noted: 0 })
  const overall = blank()
  const byChapter = new Map()
  const byType = new Map()
  const seen = new Set()
  const bump = (b, r) => {
    b.total += 1
    if (!r) { b.todo += 1; return }
    const s = statusOfRaw(r)
    if (s === 'passed') b.passed += 1
    else if (s === 'attempted') b.attempted += 1
    else b.todo += 1
    b.attempts += r.attempts ?? 0
    b.wrongCount += r.wrongCount ?? 0
    if (r.selfAssessed === true) b.selfAssessed += 1
    if (inBookRaw(r)) b.wrongBook += 1
    if (r.starred === true) b.starred += 1
    if (String(r.note ?? '').trim().length > 0) b.noted += 1
  }
  for (const e of INDEX.problems) {
    seen.add(e.id)
    const r = records[e.id]
    bump(overall, r)
    const ck = shardKeyOf(e.file)
    if (!byChapter.has(ck)) byChapter.set(ck, blank())
    bump(byChapter.get(ck), r)
    if (!byType.has(e.type)) byType.set(e.type, blank())
    bump(byType.get(e.type), r)
  }
  return {
    overall,
    byChapter,
    byType,
    recordCount: Object.keys(records).length,
    orphans: Object.keys(records).filter((id) => !seen.has(id)).sort(),
  }
}
async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)
  console.log(`基准（Node 侧从 index.json 现算）：总题数 ${INDEX.count} · single_choice ${INDEX.problems.filter((p) => p.type === 'single_choice').length} · fill_blank ${INDEX.problems.filter((p) => p.type === 'fill_blank').length} · short_answer ${INDEX.problems.filter((p) => p.type === 'short_answer').length} · 阅读题缺 answer ${String(DEFECT_CR)}`)
  console.log(`fixture：${SC_ID} 正确选项下标 ${SC_ANSWER}（点错用 ${SC_WRONG}）· ${FB_ID} 有 ${FB_BLANK_COUNT} 个空`)

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true })
  const hook = (p) => {
    p.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
    p.on('pageerror', (e) => pageErrors.push(e.message))
    p.on('request', (r) => allRequests.push(r.url()))
  }
  hook(page)

  let nonce = 0
  /** 整页加载：文档 URL 带 nonce 强制真刷新（hash 路由下只有这样才能重置模块级缓存） */
  async function load(hash, readySelector = '[data-role="overview"]') {
    nonce += 1
    await page.goto(`${BASE}index.html?nav=${nonce}#${hash}`, { waitUntil: 'networkidle' })
    if (readySelector !== null) await page.waitForSelector(readySelector, { timeout: 30000 })
  }
  const gotoProblem = (id) => load(`/problems/p/${id}`, '[data-role="progress-panel"]')
  const gotoProgress = () => load('/progress')

  const lsEnvelope = () => page.evaluate((k) => {
    const raw = localStorage.getItem(k)
    return raw === null ? null : JSON.parse(raw)
  }, PROGRESS_KEY)
  const lsRecords = async () => (await lsEnvelope())?.state?.records ?? {}
  const overview = () => page.evaluate(() => {
    const el = document.querySelector('[data-role="overview"]')
    if (el === null) return null
    const d = el.dataset
    return {
      total: Number(d.total), passed: Number(d.passed), attempted: Number(d.attempted), todo: Number(d.todo),
      attempts: Number(d.attempts), wrong: Number(d.wrong), accuracy: d.accuracy ?? '',
      selfAssessed: Number(d.selfAssessed), records: Number(d.records),
    }
  })
  const bucketRows = (role, keyAttr) => page.evaluate(([r, k]) => [...document.querySelectorAll(`[data-role="${r}"] [data-role="bucket-row"]`)].map((row) => ({
    key: row.dataset[k], total: Number(row.dataset.total), passed: Number(row.dataset.passed),
    attempted: Number(row.dataset.attempted), todo: Number(row.dataset.todo),
  })), [role, keyAttr])
  const attr = async (sel, name) => page.evaluate(([s, n]) => document.querySelector(s)?.dataset?.[n] ?? null, [sel, name])
  const text = async (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel)
  const countSel = async (sel) => page.locator(sel).count()
  const clearLs = () => page.evaluate((k) => { localStorage.clear(); void k }, PROGRESS_KEY)

  /** 总览 + 两张桶表 与 index.json / localStorage 原始记录逐项对账 */
  async function reconcile(tag) {
    const records = await lsRecords()
    const exp = tally(records)
    const ov = await overview()
    check(`${tag}：总览六个数字与 Node 侧独立统计一致`,
      ov !== null && ov.total === exp.overall.total && ov.passed === exp.overall.passed
      && ov.attempted === exp.overall.attempted && ov.todo === exp.overall.todo
      && ov.attempts === exp.overall.attempts && ov.wrong === exp.overall.wrongCount
      && ov.selfAssessed === exp.overall.selfAssessed && ov.records === exp.recordCount,
      ov === null ? 'overview 不存在' : `UI ${JSON.stringify(ov)} ｜ 期望 ${JSON.stringify({ ...exp.overall, records: exp.recordCount })}`)

    check(`${tag}：总览 total == index.json 的 count，且 passed+attempted+todo == total`,
      ov !== null && ov.total === INDEX.count && ov.passed + ov.attempted + ov.todo === ov.total,
      `total=${ov?.total} index.count=${INDEX.count} 三段和=${ov === null ? 'n/a' : ov.passed + ov.attempted + ov.todo}`)

    for (const [role, keyAttr, expMap, label] of [
      ['chapter-stats', 'chapter', exp.byChapter, '按章节'],
      ['type-stats', 'type', exp.byType, '按题型'],
    ]) {
      const rows = await bucketRows(role, keyAttr)
      const expRows = [...expMap.entries()]
      const sum = (f) => rows.reduce((a, r) => a + f(r), 0)
      const badKeys = rows.filter((r) => {
        const e = expMap.get(r.key)
        return e === undefined || e.total !== r.total || e.passed !== r.passed || e.attempted !== r.attempted || e.todo !== r.todo
      }).map((r) => r.key)
      check(`${tag}：${label}表 ${rows.length} 行与 index.json 逐桶对上（行数 == 桶数、每桶四个数字全等、纵向求和 == 总览）`,
        rows.length === expRows.length && badKeys.length === 0
        && sum((r) => r.total) === INDEX.count && sum((r) => r.passed) === exp.overall.passed
        && sum((r) => r.attempted) === exp.overall.attempted && sum((r) => r.todo) === exp.overall.todo
        && rows.every((r) => r.passed + r.attempted + r.todo === r.total),
        badKeys.length > 0 ? `不符的桶：${badKeys.join(',')}` : `Σtotal=${sum((r) => r.total)} Σpassed=${sum((r) => r.passed)} Σattempted=${sum((r) => r.attempted)} Σtodo=${sum((r) => r.todo)}`)
    }
    return { records, exp }
  }

  // ════ 阶段 0：干净起点 ════════════════════════════════════════════════
  await load('/problems', null)
  await clearLs()
  await gotoProgress()
  const zero = await overview()
  check('起点：localStorage 清空后总览全零、错题本为空',
    zero !== null && zero.passed === 0 && zero.attempted === 0 && zero.todo === INDEX.count && zero.records === 0
    && (await attr('[data-role="wrongbook"]', 'count')) === '0' && (await countSel('[data-role="wrongbook-empty"]')) === 1,
    JSON.stringify(zero))
  check('起点：正确率显示「—」而不是假的 0% / 100%', (await text('[data-role="overview"] [data-role="accuracy"]')) === '—',
    String(await text('[data-role="overview"] [data-role="accuracy"]')))
  check('起点：数据急救区干净（无迁移 / 无备份）',
    (await attr('[data-role="issues"]', 'count')) === '0' && (await attr('[data-role="backups"]', 'count')) === '0')

  // ════ 阶段 1：选择题即时判定 → 错题本收录 / 次数 / 移出 ════════════════
  const dataReqCount = () => allRequests.filter((u) => u.includes('/data/problems/')).length
  const reqBefore = dataReqCount()
  await gotoProblem(SC_ID)
  check('选择题：作答区可判分、选项数与分片一致',
    (await attr('[data-role="choice-options"]', 'answerable')) === 'true'
    && Number(await attr('[data-role="choice-options"]', 'count')) === SC.options.length,
    `answerable=${await attr('[data-role="choice-options"]', 'answerable')} count=${await attr('[data-role="choice-options"]', 'count')}`)

  await page.locator(`[data-role="choice-option"][data-index="${SC_WRONG}"] input`).click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  check(`选择题：点错选项（下标 ${SC_WRONG}）→ 即时出「答错」横幅，无任何网络请求`,
    (await attr('[data-role="verdict"]', 'tone')) === 'bad' && dataReqCount() === reqBefore + 2,
    `本次加载只发了 ${dataReqCount() - reqBefore} 个数据请求（index.json + 分片），0 个判分请求`)
  check('选择题：详情页「我的记录」变「尝试过未通过」且已进错题本',
    (await attr('[data-role="progress-panel"]', 'status')) === 'attempted'
    && (await attr('[data-role="wrongbook-state"]', 'inWrongbook') ?? await attr('[data-role="wrongbook-state"]', 'inWrongBook')) === 'true')
  let rec = (await lsRecords())[SC_ID]
  check('选择题：落盘 attempts=1 wrongCount=1 everPassed=false，存档形态是 choice',
    rec?.attempts === 1 && rec?.wrongCount === 1 && rec?.everPassed === false && rec?.lastAnswerKind === 'choice'
    && typeof rec?.lastAnswer === 'string' && rec.lastAnswer.length > 0 && rec?.selfAssessed === false,
    JSON.stringify(rec))
  check('选择题：firstAttemptAt / lastAt / lastWrongAt 都是合法时刻',
    [rec?.firstAttemptAt, rec?.lastAt, rec?.lastWrongAt].every((n) => typeof n === 'number' && n > 1_600_000_000_000))

  await page.locator('[data-role="choice-reset"]').click()
  await page.locator(`[data-role="choice-option"][data-index="${SC_WRONG}"] input`).click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  rec = (await lsRecords())[SC_ID]
  check('选择题：再错一次 → attempts=2 wrongCount=2（错误次数真的在累加）',
    rec?.attempts === 2 && rec?.wrongCount === 2, JSON.stringify({ attempts: rec?.attempts, wrongCount: rec?.wrongCount }))

  await gotoProgress()
  check('进度页：错题本收录 1 道，正是刚错的那道，且显示「错 2 次」与最近错误时刻',
    (await attr('[data-role="wrongbook"]', 'count')) === '1'
    && (await attr(`[data-role="wrongbook-row"][data-id="${SC_ID}"]`, 'id')) === SC_ID
    && (await attr(`[data-role="wrongbook-row"][data-id="${SC_ID}"] [data-role="wrong-count"]`, 'count')) === '2'
    && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(await text(`[data-role="wrongbook-row"][data-id="${SC_ID}"]`))),
    String(await text(`[data-role="wrongbook-row"][data-id="${SC_ID}"]`)).slice(0, 120))
  check('进度页：总览「错题本在册」= 1、「错误次数」= 2、正确率 0%（2 次提交全错）',
    (await attr('[data-role="overview"]', 'wrong')) === '2'
    && (await text('[data-role="overview"] [data-role="wrongbook-count"]')) === '1'
    && (await text('[data-role="overview"] [data-role="accuracy"]')) === '0%')

  await page.locator(`[data-role="wrongbook-row"][data-id="${SC_ID}"] [data-role="wrong-dismiss"]`).click()
  await page.waitForFunction(() => document.querySelector('[data-role="wrongbook"]')?.dataset.count === '0', null, { timeout: 10000 })
  check('进度页：点「我已掌握，移出」→ 错题本立刻变 0 道', true)

  // ════ 阶段 2：收藏 + 笔记 + 做对后自动出册 ════════════════════════════
  await gotoProblem(SC_ID)
  check('详情页：移出后显示「放回错题本」而不是「不在错题本里」（isDismissed 与 inWrongBook 互斥）',
    (await countSel('[data-role="wrong-restore"]')) === 1 && (await attr('[data-role="wrongbook-state"]', 'inWrongbook') ?? await attr('[data-role="wrongbook-state"]', 'inWrongBook')) === 'false')
  await page.locator('[data-role="star-toggle"]').click()
  await page.waitForFunction(() => document.querySelector('[data-role="star-toggle"]')?.dataset.starred === 'true', null, { timeout: 10000 })
  const NOTE = '错在把 main 当成"第一个函数"；记住：执行从 main 开始，到 main 结束。'
  await page.locator('[data-role="note-input"]').fill(NOTE)
  await page.locator('[data-role="note-save"]').click()
  await page.waitForFunction(([k, n]) => {
    const raw = localStorage.getItem(k)
    return raw !== null && JSON.parse(raw).state.records['c-ch01-sc-001']?.note === n
  }, [PROGRESS_KEY, NOTE], { timeout: 10000 })
  rec = (await lsRecords())[SC_ID]
  check('详情页：收藏与个人笔记都落了盘（笔记全文无损，含中文标点）',
    rec?.starred === true && rec?.note === NOTE, JSON.stringify({ starred: rec?.starred, noteLen: rec?.note?.length }))

  // 从进度页返回详情页 = 组件重挂载，作答区本就是干净的：「重做本题」此时**不渲染**
  // （没作答时它是个灰的死按钮，见 SingleChoiceRenderer 里的注释）。所以先验它不在，
  // 再只在它真的在时才点 —— 不能靠"点了没反应"蒙混过关。
  check('选择题：重访（组件重挂载）后作答区干净，不渲染灰掉的「重做本题」死按钮',
    (await countSel('[data-role="choice-reset"]')) === 0
    && (await attr('[data-role="choice-options"]', 'answerable')) === 'true')
  if ((await countSel('[data-role="choice-reset"]')) > 0) await page.locator('[data-role="choice-reset"]').click()
  await page.locator(`[data-role="choice-option"][data-index="${SC_ANSWER}"] input`).click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  rec = (await lsRecords())[SC_ID]
  check(`选择题：点正确选项（下标 ${SC_ANSWER}）→ 即时判「答对」，everPassed 置真且 wrongCount 不再涨`,
    (await attr('[data-role="verdict"]', 'tone')) === 'good' && rec?.everPassed === true && rec?.wrongCount === 2
    && rec?.attempts === 3 && rec?.result === 'passed' && (await attr('[data-role="progress-panel"]', 'status')) === 'passed',
    JSON.stringify({ everPassed: rec?.everPassed, attempts: rec?.attempts, wrongCount: rec?.wrongCount, result: rec?.result }))
  check('选择题：做对后自动出册（错题本状态回到「不在错题本里」，不用学生手工清）',
    (await attr('[data-role="wrongbook-state"]', 'inWrongbook') ?? await attr('[data-role="wrongbook-state"]', 'inWrongBook')) === 'false'
    && (await countSel('[data-role="wrong-dismiss"]')) === 0 && (await countSel('[data-role="wrong-restore"]')) === 0)
  check('详情页：回看上次作答区存在，且标注为「上次选择的选项」（choice 形态）',
    (await attr('[data-role="last-answer"]', 'kind')) === 'choice')

  await gotoProgress()
  check('进度页：做对之后错题本仍是 0 道、已通过 1 道、收藏 1 道、笔记 1 道',
    (await attr('[data-role="wrongbook"]', 'count')) === '0'
    && (await text('[data-role="overview"] [data-role="passed"]')) === '1'
    && (await text('[data-role="overview"] [data-role="starred-count"]')) === '1'
    && (await text('[data-role="overview"] [data-role="noted"]')) === '1'
    && (await text('[data-role="overview"] [data-role="accuracy"]')) === '33%',
    `accuracy=${await text('[data-role="overview"] [data-role="accuracy"]')}（3 次提交 2 次错）`)
  check('进度页：收藏区列出该题', (await attr('[data-role="starred"]', 'count')) === '1'
    && (await countSel(`[data-role="starred-row"][data-id="${SC_ID}"]`)) === 1)
  await reconcile('阶段 2 结束')
  // ════ 阶段 3：概念填空 —— 缺口在则走缺陷面板，缺口已补齐则验真作答形态 ════
  await gotoProblem(FB_ID)
  if (FB_NO_ANSWER) {
    check('概念填空（库内 answer 为空）：缺陷面板 + 禁用作答，绝不拿空串当期望',
      (await countSel('[data-role="defect"]')) === 1
      && (await attr('[data-role="blank-inputs"]', 'answerable')) === 'false'
      && (await countSel('[data-role="blank-submit"]')) === 0
      && Number(await attr('[data-role="blank-inputs"]', 'count')) === FB_BLANK_COUNT,
      `answerable=${await attr('[data-role="blank-inputs"]', 'answerable')} 缺陷文案=${String(await text('[data-role="defect"]')).slice(0, 90)}`)
  } else {
    check(`概念填空（真实数据 ${FB_ID}，answer 已补齐）：不出缺陷面板、允许作答、空位数与分片一致`,
      (await countSel('[data-role="defect"]')) === 0
      && (await attr('[data-role="blank-inputs"]', 'answerable')) === 'true'
      && (await countSel('[data-role="blank-submit"]')) === 1
      && Number(await attr('[data-role="blank-inputs"]', 'count')) === FB_BLANK_COUNT,
      `answerable=${await attr('[data-role="blank-inputs"]', 'answerable')} 空位=${await attr('[data-role="blank-inputs"]', 'count')}/${FB_BLANK_COUNT}`)
  }
  check('概念填空：没点提交之前不写任何记录（不计入正确率与错题本）',
    (await lsRecords())[FB_ID] === undefined)

  // ════ 阶段 4：概念填空 —— 注入带答案的 fixture，验判分路径 ════════════
  const ch01Fix = JSON.parse(JSON.stringify(readShard('c-ch01')))
  const fbProb = ch01Fix.problems.find((p) => p.id === FB_ID)
  fbProb.blanks = FB_FIX.map((f) => ({ index: f.index, answer: f.answer }))
  await page.route('**/data/problems/c-ch01.json', (route) => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ch01Fix) }))
  await gotoProblem(FB_ID)
  check('概念填空（fixture）：answer 补齐后立即可判分（同一渲染器，只换了数据）',
    (await attr('[data-role="blank-inputs"]', 'answerable')) === 'true' && (await countSel('[data-role="defect"]')) === 0)
  await page.locator('[data-role="blank-input"][data-index="1"]').fill('编译。')
  await page.locator('[data-role="blank-input"][data-index="2"]').fill('WRONG')
  await page.locator('[data-role="blank-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  check('概念填空：一空对一空错 → 整题判未通过（空是同一个答案的几部分），并逐空标出期望',
    (await countSel('[data-role="blank-results"] li')) === 2
    && /期望/.test(String(await text('[data-role="verdict"]')))
    && (await attr('[data-role="progress-panel"]', 'status')) === 'attempted',
    String(await text('[data-role="verdict"]')).replace(/\s+/g, ' ').slice(0, 100))
  rec = (await lsRecords())[FB_ID]
  check('概念填空：落盘 attempts=1 wrongCount=1，存档形态是 text 且含学生填的内容',
    rec?.attempts === 1 && rec?.wrongCount === 1 && rec?.lastAnswerKind === 'text' && /编译/.test(rec?.lastAnswer ?? ''),
    JSON.stringify(rec?.lastAnswer))
  await page.locator('[data-role="blank-reset"]').click()
  await page.locator('[data-role="blank-input"][data-index="1"]').fill('  编译  ')
  await page.locator('[data-role="blank-input"][data-index="2"]').fill(' LINK ')
  await page.locator('[data-role="blank-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  rec = (await lsRecords())[FB_ID]
  check('概念填空：大小写 / 首尾空白 / 句末标点都不计较（归一化后判对），everPassed 置真',
    (await attr('[data-role="verdict"]', 'tone')) === 'good' && rec?.everPassed === true && rec?.attempts === 2 && rec?.wrongCount === 1)
  await page.unroute('**/data/problems/c-ch01.json')

  // ════ 阶段 5：简答题 —— 不自动判分，只给参考答案让学生自评 ════════════
  await gotoProblem(SA_REF_ID)
  check('简答题：页面打开就有作答区，且**没有任何自动判分结论**',
    (await countSel('[data-role="sa-input"]')) === 1 && (await countSel('[data-role="verdict"]')) === 0)
  await page.locator('[data-role="sa-input"]').fill('输出前缀是 89,7, 之后是第三个元素的地址。')
  await page.waitForTimeout(300)
  check('简答题：写完作答仍然不产生记录（不联网、不判分、不动 attempts）',
    (await lsRecords())[SA_REF_ID] === undefined && (await attr('[data-role="progress-panel"]', 'status')) === 'todo')
  await page.locator('[data-role="sa-reveal"]').click()
  await page.waitForSelector('[data-role="sa-reference"]', { timeout: 10000 })
  check('简答题：点「显示参考答案」后给出参考答案正文（不联网、不判分，只供自评）',
    (await attr('[data-role="sa-reference"]', 'hasReference') ?? await attr('[data-role="sa-reference"]', 'has-reference')) === 'true'
    && String(await text('[data-role="sa-reference"]')).length > 30,
    String(await text('[data-role="sa-reference"]')).replace(/\s+/g, ' ').slice(0, 80))
  await page.locator('[data-role="sa-self-pass"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  rec = (await lsRecords())[SA_REF_ID]
  check('简答题：自评「答对了」→ 结论落盘但标为自评，attempts/wrongCount 一律不动（不污染机器判分正确率）',
    rec?.selfAssessed === true && rec?.everPassed === true && rec?.attempts === 0 && rec?.wrongCount === 0
    && rec?.lastAnswerKind === 'self' && (await attr('[data-role="progress-panel"]', 'status')) === 'passed',
    JSON.stringify({ selfAssessed: rec?.selfAssessed, attempts: rec?.attempts, wrongCount: rec?.wrongCount }))
  check('简答题：详情页明说这条结论「来自你的自评，不计入正确率」',
    /自评/.test(String(await text('[data-role="progress-panel"]'))))

  await gotoProblem(SA_NOREF_ID)
  const saHasRef = !(SA_GAP !== null && SA_GAP.id === SA_NOREF_ID)
  if (!saHasRef) {
    check('简答题（无参考答案）：如实说明数据缺口，不显示一个空框假装"参考答案是空白"',
      (await countSel('[data-role="defect"]')) === 1 && /参考答案/.test(String(await text('[data-role="defect"]'))))
  } else {
    check(`简答题（${SA_NOREF_ID}，库内已带参考答案）：不出缺口面板`,
      (await countSel('[data-role="defect"]')) === 0, `defect=${await countSel('[data-role="defect"]')}`)
  }
  await page.locator('[data-role="sa-reveal"]').click()
  await page.waitForSelector('[data-role="sa-reference"]', { timeout: 10000 })
  const saRefFlag = await attr('[data-role="sa-reference"]', 'hasReference') ?? await attr('[data-role="sa-reference"]', 'has-reference')
  check(`简答题：展开后 data-has-reference 与数据一致（${saHasRef ? 'true' : 'false'}），且始终有自评按钮`,
    saRefFlag === String(saHasRef) && (await countSel('[data-role="sa-self-fail"]')) === 1,
    `has-reference=${saRefFlag} 参考答案字数=${String(await text('[data-role="sa-reference"]')).length}`)
  await page.locator('[data-role="sa-self-fail"]').click()
  await page.waitForSelector('[data-role="verdict"]', { timeout: 10000 })
  rec = (await lsRecords())[SA_NOREF_ID]
  check('简答题：自评「还没答对」→ result=attempted、everPassed=false、wrongCount 仍是 0',
    rec?.selfAssessed === true && rec?.result === 'attempted' && rec?.everPassed === false && rec?.wrongCount === 0 && rec?.attempts === 0,
    JSON.stringify(rec))

  await gotoProgress()
  check('进度页：自评未通过的简答题**在错题本里**，且如实标为「自评未通过」而不是谎报「错 1 次」',
    (await countSel(`[data-role="wrongbook-row"][data-id="${SA_NOREF_ID}"]`)) === 1
    && (await attr(`[data-role="wrongbook-row"][data-id="${SA_NOREF_ID}"] [data-role="wrong-count"]`, 'count')) === '0'
    && (await text(`[data-role="wrongbook-row"][data-id="${SA_NOREF_ID}"] [data-role="wrong-count"]`)) === '自评未通过',
    String(await text(`[data-role="wrongbook-row"][data-id="${SA_NOREF_ID}"] [data-role="wrong-count"]`)))
  check('进度页：自评 2 条被单列（data-self-assessed=2），机器判分正确率仍是 (5-3)/5=40%',
    (await attr('[data-role="overview"]', 'selfAssessed') ?? await attr('[data-role="overview"]', 'self-assessed')) === '2'
    && (await attr('[data-role="overview"]', 'attempts')) === '5'
    && (await attr('[data-role="overview"]', 'wrong')) === '3'
    && (await text('[data-role="overview"] [data-role="accuracy"]')) === '40%',
    `attempts=${await attr('[data-role="overview"]', 'attempts')} wrong=${await attr('[data-role="overview"]', 'wrong')} accuracy=${await text('[data-role="overview"] [data-role="accuracy"]')}`)
  await reconcile('阶段 5 结束')
  await page.screenshot({ path: join(TMP, 'acc-progress-overview.png'), fullPage: true })

  // ════ 阶段 6：导出 → 清空 localStorage → 导入 → 完全一致 ═══════════════
  const snap = async () => ({
    overview: await overview(),
    wrongbook: await page.evaluate(() => [...document.querySelectorAll('[data-role="wrongbook-row"]')].map((r) => r.dataset.id)),
    starred: await page.evaluate(() => [...document.querySelectorAll('[data-role="starred-row"]')].map((r) => r.dataset.id)),
    records: await lsRecords(),
  })
  const before = await snap()
  const dlPromise = page.waitForEvent('download', { timeout: 20000 })
  await page.locator('[data-role="export-button"]').click()
  const dl = await dlPromise
  const exportPath = join(TMP, 'acc-progress-export.json')
  await dl.saveAs(exportPath)
  const exported = JSON.parse(readFileSync(exportPath, 'utf8'))
  check('导出：真的落了文件，文件名形如 c-practice-progress-YYYYMMDD-HHMM.json',
    /^c-practice-progress-\d{8}-\d{4}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename())
  check('导出：自带 app/kind/schemaVersion，records 与 localStorage 逐字段相同',
    exported.app === 'c-practice' && exported.kind === 'c-practice-progress' && exported.schemaVersion === 1
    && JSON.stringify(exported.records) === JSON.stringify(before.records)
    && exported.recordCount === Object.keys(before.records).length,
    `schemaVersion=${exported.schemaVersion} recordCount=${exported.recordCount}`)
  check('导出：页面给出成功回执（导出多少条 / 哪个版本）',
    (await attr('[data-role="transfer-report"]', 'tone')) === 'good'
    && /已导出/.test(String(await text('[data-role="transfer-report"]'))),
    String(await text('[data-role="transfer-report"]')).slice(0, 110))

  await clearLs()
  await gotoProgress()
  const wiped = await overview()
  check('清空 localStorage 后重载：进度归零（4 条记录全没了），错题本与收藏都空',
    wiped.records === 0 && wiped.passed === 0 && wiped.attempted === 0 && wiped.todo === INDEX.count
    && (await attr('[data-role="wrongbook"]', 'count')) === '0' && (await attr('[data-role="starred"]', 'count')) === '0')

  await page.evaluate(() => { const el = document.querySelector('input[data-role="import-input"]'); if (el !== null) el.classList.remove('hidden') })
  await page.locator('input[data-role="import-input"]').setInputFiles(exportPath)
  await page.waitForSelector('[data-role="transfer-report"][data-tone="good"]', { timeout: 20000 })
  const after = await snap()
  check('导入：进度与错题本与清空前**完全一致**（总览九项 + 错题本 id 序列 + 收藏 id 序列 + 记录逐字节）',
    JSON.stringify(after) === JSON.stringify(before),
    JSON.stringify(after) === JSON.stringify(before) ? `恢复了 ${Object.keys(after.records).length} 条记录`
      : `差异：before=${JSON.stringify(before.overview)} after=${JSON.stringify(after.overview)} wrong ${before.wrongbook} vs ${after.wrongbook}`)
  check('导入：回执说明是「新增 4 条」，并如实报告 schemaVersion',
    /导入完成/.test(String(await text('[data-role="transfer-report"]'))) && /新增 4/.test(String(await text('[data-role="transfer-report"]'))),
    String(await text('[data-role="transfer-report"]')).replace(/\s+/g, ' ').slice(0, 130))

  await page.locator('input[data-role="import-input"]').setInputFiles(exportPath)
  await page.waitForFunction(() => /无变化/.test(document.querySelector('[data-role="transfer-report"]')?.textContent ?? ''), null, { timeout: 20000 })
  const twice = await snap()
  check('导入幂等：同一个文件导第二次 → 全部「无变化」，次数不翻倍、结论不变',
    JSON.stringify(twice) === JSON.stringify(before) && /无变化 4/.test(String(await text('[data-role="transfer-report"]'))),
    String(await text('[data-role="transfer-report"]')).replace(/\s+/g, ' ').slice(0, 130))

  const badFile = join(TMP, 'acc-progress-import-bad.json')
  writeFileSync(badFile, JSON.stringify({ app: 'c-practice', kind: 'c-practice-progress', exportedAt: 'x', records: {} }), 'utf8')
  await page.locator('input[data-role="import-input"]').setInputFiles(badFile)
  await page.waitForSelector('[data-role="transfer-report"][data-tone="bad"]', { timeout: 20000 })
  check('导入防线：缺 schemaVersion 的文件一律拒收并说清原因（不猜含义、不动本地进度）',
    /schemaVersion/.test(String(await text('[data-role="transfer-report"]')))
    && JSON.stringify(await lsRecords()) === JSON.stringify(before.records),
    String(await text('[data-role="transfer-report"]')).replace(/\s+/g, ' ').slice(0, 120))
  writeFileSync(badFile, JSON.stringify({ app: 'c-practice', kind: 'c-practice-progress', schemaVersion: 99, records: {} }), 'utf8')
  await page.locator('input[data-role="import-input"]').setInputFiles(badFile)
  await page.waitForFunction(() => /更新版本的数据结构/.test(document.querySelector('[data-role="transfer-report"]')?.textContent ?? ''), null, { timeout: 20000 })
  check('导入防线：比本站更新的文件（schemaVersion=99）拒收，不降级解释', true)
  // ════ 阶段 7：schemaVersion 迁移链 ════════════════════════════════════
  const writeLs = (value) => page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v) }, [PROGRESS_KEY, value])
  const backupEntries = () => page.evaluate((prefix) => Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix))
    .map((k) => ({ key: k, raw: String(localStorage.getItem(k)) })), `${PROGRESS_KEY}:backup:`)

  // ── 7a：v0（阶段 4 的最小写侧）→ v1，走迁移链，不丢数据 ──
  const T0 = Date.now() - 60_000
  const v0Raw = JSON.stringify({ state: { records: { [SC_ID]: { result: 'passed', attempts: 4, everPassed: true, firstPassedAt: T0 - 10_000, lastAt: T0 } } }, version: 0 })
  await writeLs(v0Raw)
  await gotoProgress()
  check('迁移 v0→v1：数据急救区如实报告迁移发生过（不是悄悄改字段）',
    (await attr('[data-role="issues"]', 'count')) === '1'
    && /schemaVersion=0/.test(String(await text('[data-role="issues"]')))
    && /迁移/.test(String(await text('[data-role="issues"]'))),
    String(await text('[data-role="issues"]')).replace(/\s+/g, ' ').slice(0, 130))
  const ov7 = await overview()
  check('迁移 v0→v1：老记录一条都没丢，总览按 v1 口径算出 attempts=4 wrong=3 accuracy=25%',
    ov7.records === 1 && ov7.passed === 1 && ov7.attempts === 4 && ov7.wrong === 3 && ov7.todo === INDEX.count - 1,
    JSON.stringify(ov7))
  check('迁移 v0→v1：正常迁移不产生备份（备份只在"版本不认识/JSON 损坏"时才产生）',
    (await attr('[data-role="backups"]', 'count')) === '0')
  await gotoProblem(SC_ID)
  check('迁移 v0→v1：详情页读到的提交次数/错误次数是迁移后的值（v0 没有 wrongCount，按 everPassed 推 attempts-1）',
    /提交次数\s*4/.test(String(await text('[data-role="record-summary"]')).replace(/\s+/g, ' '))
    && /错误次数\s*3/.test(String(await text('[data-role="record-summary"]')).replace(/\s+/g, ' ')),
    String(await text('[data-role="record-summary"]')).replace(/\s+/g, ' '))
  await page.locator('[data-role="star-toggle"]').click()
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k) ?? '{}').version === 1, PROGRESS_KEY, { timeout: 10000 })
  const env7 = await lsEnvelope()
  const rec7 = env7?.state?.records?.[SC_ID]
  check('迁移 v0→v1：下一次写盘的信封 version 已是 1，且 v1 新字段全部补齐（firstAttemptAt 取 lastAt、lastWrongAt=null、note=""、selfAssessed=false）',
    env7?.version === 1 && rec7?.firstAttemptAt === T0 && rec7?.lastAt === T0 && rec7?.lastWrongAt === null
    && rec7?.wrongDismissedAt === null && rec7?.lastAnswer === null && rec7?.lastAnswerKind === null
    && rec7?.lastAnswerTruncated === false && rec7?.note === '' && rec7?.selfAssessed === false
    && rec7?.starred === true && rec7?.wrongCount === 3 && rec7?.attempts === 4,
    JSON.stringify(rec7))

  // ── 7b：版本比本站新（99）→ 备份原文后重置，绝不直接清空 ──
  const v99Raw = JSON.stringify({ state: { records: { [SC_ID]: { result: 'passed', attempts: 7, everPassed: true, lastAt: T0 } } }, version: 99 })
  await writeLs(v99Raw)
  await gotoProgress()
  const ov79 = await overview()
  check('版本不认识（99 > 当前 1）：从空进度开始，但如实报告"版本不认识"',
    ov79.records === 0 && ov79.passed === 0 && ov79.todo === INDEX.count
    && /版本不认识/.test(String(await text('[data-role="issues"]')))
    && /schemaVersion=99/.test(String(await text('[data-role="issues"]'))),
    String(await text('[data-role="issues"]')).replace(/\s+/g, ' ').slice(0, 140))
  const bk79 = await backupEntries()
  check('版本不认识：原文**先备份再重置**（备份内容与写进去的逐字节相同），"数据急救"区能看到这份备份',
    bk79.length === 1 && bk79[0].raw === v99Raw && (await attr('[data-role="backups"]', 'count')) === '1'
    && String(await text('[data-role="backups"]')).includes(bk79[0].key),
    bk79.length === 1 ? `备份键 ${bk79[0].key} · ${bk79[0].raw.length} 字符 · 内容一致=${bk79[0].raw === v99Raw}` : `备份数=${bk79.length}`)

  // ── 7c：localStorage 被写坏（非法 JSON）→ 同样备份后重置 ──
  const brokenRaw = '{"state":{"records":{ 这一段被别的扩展截断了'
  await writeLs(brokenRaw)
  await gotoProgress()
  const bkBr = await backupEntries()
  check('JSON 损坏：不是合法 JSON 也从空进度开始，原文照样备份下来（parse-error 记进台账）',
    (await overview()).records === 0 && bkBr.length === 1 && bkBr[0].raw === brokenRaw
    && /不是合法 JSON/.test(String(await text('[data-role="issues"]'))),
    String(await text('[data-role="issues"]')).replace(/\s+/g, ' ').slice(0, 120))

  // ════ 阶段 8：库内 0 道的四个题型 —— 渲染器必须能跑（fixture 只活在 route 响应里）════
  await clearLs()
  const fixIndex = JSON.parse(JSON.stringify(INDEX))
  const ch01Fx = JSON.parse(JSON.stringify(readShard('c-ch01')))
  for (const f of FIXTURES) {
    ch01Fx.problems.push({ category: 'C语言', chapter: '第1章 概述', section: '验收 fixture', source: 'acceptance-fixture', difficulty: 1, bloom: 'remember', ai_generated: false, generated_at: '2026-09-09', verified: false, tags: ['fixture'], ...f })
    fixIndex.problems.push({ id: f.id, type: f.type, category: 'C语言', chapter: '第1章 概述', section: '验收 fixture', difficulty: 1, bloom: 'remember', verified: false, tags: ['fixture'], title: '', file: 'c-ch01.json' })
    fixIndex.count += 1
  }
  const fulfillJson = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) })
  await page.route('**/data/problems/index.json', fulfillJson(fixIndex))
  await page.route('**/data/problems/c-ch01.json', fulfillJson(ch01Fx))

  await gotoProblem('x-fix-tf')
  await page.locator('[data-role="tf-option"][data-value="false"] input').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  const tfBad = (await lsRecords())['x-fix-tf']
  await page.locator('[data-role="tf-option"][data-value="true"] input').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  const tfGood = (await lsRecords())['x-fix-tf']
  check('判断题（0 道，fixture 验渲染器）：点错即时判错、点对即时判对，两次都落盘',
    tfBad?.wrongCount === 1 && tfBad?.everPassed === false && tfGood?.everPassed === true && tfGood?.attempts === 2,
    JSON.stringify({ bad: tfBad?.attempts, good: tfGood?.attempts }))

  await gotoProblem('x-fix-order')
  check('代码排序（0 道，fixture）：渲染 3 行可拖动列表 + 实时拼接预览',
    Number(await attr('[data-role="ordering-lines"]', 'count')) === 3 && (await countSel('[data-role="code-block"]')) >= 1)
  await page.locator('[data-role="ordering-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  const orderLines = async () => page.evaluate(() => [...document.querySelectorAll('[data-role="ordering-row"]')].map((r) => Number(r.dataset.line)))
  check('代码排序：初始顺序不是正确顺序 → 判错', (await orderLines()).join(',') === '0,1,2')
  await page.locator('[data-role="ordering-row"][data-pos="0"] button[aria-label="下移"]').click()
  await page.locator('[data-role="ordering-row"][data-pos="1"] button[aria-label="下移"]').click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-role="ordering-row"]')].map((r) => r.dataset.line).join(',') === '1,2,0', null, { timeout: 10000 })
  await page.locator('[data-role="ordering-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  check('代码排序：↑↓ 按钮把顺序调成 1,2,0 → 判对（键盘/触屏兜底与拖拽操作同一个数组）',
    (await lsRecords())['x-fix-order']?.everPassed === true)

  await gotoProblem('x-fix-cx')
  check('复杂度（0 道，fixture）：识别为时间复杂度题且可判分',
    (await attr('[data-role="complexity-input"]', 'ask')) === 'time' && (await attr('[data-role="complexity-input"]', 'answerable')) === 'true')
  await page.locator('[data-role="complexity-field"]').fill('O(n^2)')
  await page.locator('[data-role="complexity-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  await page.locator('[data-role="complexity-field"]').fill('o (n)')
  await page.locator('[data-role="complexity-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  check('复杂度：O(n^2) 判错、"o (n)" 判对（记号归一化：去空白/去^/小写，且 O(n) 与 O(n^2) 不同形）',
    (await lsRecords())['x-fix-cx']?.everPassed === true && (await lsRecords())['x-fix-cx']?.wrongCount === 1)

  await gotoProblem('x-fix-match')
  check('匹配题（0 道，fixture）：渲染 2 组配对，右列是确定性打乱的下拉选项',
    Number(await attr('[data-role="matching-pairs"]', 'count')) === 2 && (await countSel('[data-role="matching-select"]')) === 2)
  await page.locator('[data-role="matching-select"][data-index="0"]').selectOption('整型')
  await page.locator('[data-role="matching-select"][data-index="1"]').selectOption('整型')
  await page.locator('[data-role="matching-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="bad"]', { timeout: 10000 })
  await page.locator('[data-role="matching-select"][data-index="1"]').selectOption('字符型')
  await page.locator('[data-role="matching-submit"]').click()
  await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
  check('匹配题：配错一项 → 整题判错；全对 → 判对',
    (await lsRecords())['x-fix-match']?.everPassed === true && (await lsRecords())['x-fix-match']?.wrongCount === 1)

  await page.unroute('**/data/problems/index.json')
  await page.unroute('**/data/problems/c-ch01.json')
  await gotoProgress()
  check('诚实性：撤掉 fixture 后这 4 条记录成为 orphan，页面如实列出而不塞进统计分母',
    (await attr('[data-role="orphan"]', 'count')) === '4'
    && (await overview()).total === INDEX.count && (await overview()).records === 4
    && /x-fix-tf/.test(String(await text('[data-role="orphan"]'))),
    String(await text('[data-role="orphan"]')).replace(/\s+/g, ' ').slice(0, 120))

  // ════ 阶段 9：R3 文案不再硬编码「19 道」════
  await gotoProblem(CR_DEFECT_ID)
  const defectText = String(await text('[data-role="defect"]'))
  if (CR_IS_DESC) {
    check(`阅读题无 answer（${CR_DEFECT_ID}）：如实说明「问的是结论/理由而非 stdout，故不做自动判分」，不假装能判`,
      /文字描述/.test(defectText) && /不提供自动判分/.test(defectText) && !defectText.includes('19 道'),
      defectText.replace(/\s+/g, ' ').slice(0, 120))
  } else {
    check(`R3：阅读题缺 answer 的文案动态读 index.json（实测 ${String(DEFECT_CR)} 道），不再写死「19 道」`,
      DEFECT_CR !== null && defectText.includes(`全站阅读题里有 ${DEFECT_CR} 道属此类`) && !defectText.includes('19 道'),
      defectText.replace(/\s+/g, ' ').slice(0, 140))
  }
  check(`索引 defects.codeReadingNoAnswer 与分片现算逐条吻合（${String(DEFECT_CR)} = 文字描述 ${CR_DESC_COUNT} + 纯缺口 ${CR_GAP_COUNT}）`,
    Number(DEFECT_CR) === CR_DESC_COUNT + CR_GAP_COUNT, `index=${String(DEFECT_CR)} 现算=${CR_DESC_COUNT + CR_GAP_COUNT}`)

  // ════ 阶段 10：硬约束 —— 概念题一个网络判分请求都不发 + 控制台干净 ════
  const judgeRequests = allRequests.filter((u) => /godbolt\.org|\/api\/compiler\//i.test(u))
  check('硬约束：全程 0 个 Godbolt / 编译后端请求（概念题一律前端即时判定，不耗判题额度）',
    judgeRequests.length === 0, judgeRequests.length === 0 ? `共 ${allRequests.length} 个请求，无一发往编译后端` : judgeRequests.slice(0, 5).join(' | '))
  const dataReqs = [...new Set(allRequests.filter((u) => u.includes('/data/problems/')).map((u) => u.replace(/^.*\/data\/problems\//, '')))]
  check('硬约束：数据请求只有 index.json 与被打开过的分片（懒加载没有被概念题破坏）',
    dataReqs.includes('index.json') && dataReqs.every((f) => f.endsWith('.json')) && !dataReqs.some((f) => f.startsWith('_')),
    `去重后 ${dataReqs.length} 个：${dataReqs.join(',')}`.slice(0, 300))

  const distDir = join(ROOT, 'dist', 'assets')
  const distJs = readdirSync(distDir).filter((f) => f.endsWith('.js'))
  const distHit = distJs.filter((f) => readFileSync(join(distDir, f), 'utf8').includes('19 道'))
  check('R3：dist 产物里搜不到硬编码的「19 道」', distHit.length === 0, distHit.length === 0 ? `${distJs.length} 个 js chunk 全部干净` : distHit.join(','))

  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('全程控制台 error/warn 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? `共 ${consoleMsgs.length} 条其它消息，0 error 0 warn 0 pageerror`
      : JSON.stringify({ bad: bad.slice(0, 6), pageErrors: pageErrors.slice(0, 3) }).slice(0, 900))

  await page.screenshot({ path: join(TMP, 'acc-progress-final.png'), fullPage: true })
}

try {
  await main()
} catch (e) {
  check('UI 验收流程未抛异常', false, (e instanceof Error ? e.stack : String(e)).split('\n').slice(0, 5).join(' | '))
} finally {
  // 抛异常的路径也必须关浏览器：playwright 的 chrome 子进程句柄挂着 → node 事件循环排不空 →
  // 脚本「检查全跑完了却永远不退出」（上一轮就是这么假死的，还占着 4176 端口）。
  try { if (browser !== null) await browser.close() } catch { /* 已经在关了 */ }
  preview.kill()
}

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 阶段 5（进度体系 + 辅助题型）UI 验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exitCode = failed.length > 0 ? 1 : 0
// 兜底看门狗：unref 后不拦正常退出，但若还有句柄赖着不走，3 秒后强制收工。
setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 3000).unref()