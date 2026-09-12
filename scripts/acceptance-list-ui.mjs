/**
 * 模块 5（题目列表页）UI 验收：真实浏览器里跑 dist 产物。
 *
 * Node 侧能算的（各维筛选命中数、排序序列）一律拿 index.json 现算当基准，脚本里不抄死数字；
 * 浏览器侧只验「UI 真的按这套规则渲染了」+ 四件静态数据算不出来的事：
 *   ① 全库题目不一次性渲染（首屏 50 行；翻完所有页取到的 id 集合 == 索引全集）
 *   ② 硬约束：列表页只 fetch index.json，**一个分片都不碰**；点进详情页才出现分片请求
 *   ③ 状态三色：答错→尝试过未通过、答对→已通过、F5 刷新后仍在（localStorage）
 *   ④ 筛选条件写在 URL 里，深链直达可复现；点 chip 是客户端筛选，不整页重载
 * 用 playwright-core + 本机已装的 Chrome（与模块 3 / 4 UI 验收同一套，仓库不下载浏览器）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4175
const BASE = `http://127.0.0.1:${PORT}/`

const INDEX = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/index.json'), 'utf8'))
const SHARD_ORDER = INDEX.shards.map((s) => s.file.replace(/\.json$/i, ''))
const shardKey = (file) => file.replace(/\.json$/i, '')
const countWhere = (fn) => INDEX.problems.filter(fn).length
const byId = (id) => INDEX.problems.find((p) => p.id === id)
/** 默认排序基准：章节按 shards 顺序，章内按 id 升序 */
const DEFAULT_ORDER = [...INDEX.problems].sort((a, b) => {
  const d = SHARD_ORDER.indexOf(shardKey(a.file)) - SHARD_ORDER.indexOf(shardKey(b.file))
  return d !== 0 ? d : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
})

const CR_ID = 'c-ch09-cr-043'
const CR_SHARD = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/c-ch09.json'), 'utf8'))
const CR = CR_SHARD.problems.find((p) => p.id === CR_ID)
const CR_ANSWER = (CR.answer ?? '').trim()
const CH09 = countWhere((p) => shardKey(p.file) === 'c-ch09')
const CH09_DEBUG = INDEX.problems.filter((p) => shardKey(p.file) === 'c-ch09' && p.type === 'debug').map((p) => p.id)
const DEBUG_TOTAL = countWhere((p) => p.type === 'debug')
// 阶段D 修正（2026-09-13）：原写死 { chapter: 'c-ch12', type: 'debug' }，但阶段B 新增 c-ch12-dbg-001..003 后
// 该组合已不再为空，导致空状态断言失败 + 「清空全部筛选」点击超时（2 个 FAIL 同源）。
// 现改为从 index.json 现算一个命中数为 0 的章节×题型组合，不再随题库增长而失效。
// 同时把原本写死的总题数 518 / 最高难度 4 / 最低难度 2 全部改为从索引现算。
const ALL_TYPES = [...new Set(INDEX.problems.map((p) => p.type))]
const EMPTY_COMBO = (() => {
  for (const shard of INDEX.shards) {
    const key = shardKey(shard.file)
    for (const type of ALL_TYPES) {
      if (countWhere((p) => shardKey(p.file) === key && p.type === type) === 0) return { chapter: key, type }
    }
  }
  throw new Error('找不到命中数为 0 的章节×题型组合')
})()
const TOTAL = INDEX.count
const MAX_DIFF = Math.max(...INDEX.problems.map((p) => p.difficulty))
const MIN_DIFF = Math.min(...INDEX.problems.map((p) => p.difficulty))

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }

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

const consoleMsgs = []
const pageErrors = []
let dataRequests = []

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)
  console.log(`基准（Node 侧从 index.json 现算）：总题数 ${INDEX.count} · ch09 ${CH09} · debug ${DEBUG_TOTAL} · ch09+debug ${CH09_DEBUG.length}`)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('request', (r) => { const u = r.url(); if (u.includes('/data/problems/')) dataRequests.push(u.replace(/^.*\/data\/problems\//, '')) })

  /** 整页加载（文档 URL 带 nonce 强制真刷新，保证每次都是干净的初始状态） */
  let nonce = 0
  async function load(hash) {
    nonce += 1
    dataRequests = []
    await page.goto(`${BASE}index.html?nav=${nonce}#${hash}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 30000 })
  }
  const sum = () => page.evaluate(() => {
    const el = document.querySelector('[data-role="summary"]')
    return el ? { total: Number(el.dataset.total), filtered: Number(el.dataset.filtered), rows: Number(el.dataset.rows), page: Number(el.dataset.page), pageCount: Number(el.dataset.pageCount) } : null
  })
  const rowIds = () => page.evaluate(() => [...document.querySelectorAll('[data-role="row"]')].map((r) => r.dataset.id))
  const rowAttr = (id, attr) => page.evaluate(([id, attr]) => document.querySelector(`[data-role="row"][data-id="${id}"]`)?.dataset[attr] ?? null, [id, attr])
  async function waitFiltered(n) {
    await page.waitForFunction((n) => Number(document.querySelector('[data-role="summary"]')?.dataset.filtered) === n, n, { timeout: 15000 })
  }

  // ── ① 首屏：518 题、只加载索引、不一次性渲染 ──
  await load('/problems')
  let s = await sum()
  check(`列表读到的总数 = index.json 的 count（${TOTAL} 道）`, s.total === INDEX.count && INDEX.count === TOTAL, `data-total=${s.total}，index.count=${INDEX.count}`)
  check(`首屏只渲染一页（默认 50 行），不是全库 ${TOTAL} 行`, s.rows === 50 && s.pageCount === Math.ceil(TOTAL / 50), `rows=${s.rows} pageCount=${s.pageCount}`)
  check('列表页只请求了 index.json，未请求任何分片', dataRequests.filter((f) => f !== 'index.json').length === 0, '请求：' + (dataRequests.join(', ') || '（无）'))
  const firstIds = await rowIds()
  check('默认顺序 = 章节 + 题号（与 Node 侧基准逐项相同）', JSON.stringify(firstIds) === JSON.stringify(DEFAULT_ORDER.slice(0, 50).map((p) => p.id)), `首行 ${firstIds[0]} 末行 ${firstIds[49]}`)

  // ── ② 翻完所有页，id 集合 == 索引全集 ──
  await load('/problems?size=100')
  const all = []
  for (let p = 1; p <= Math.ceil(TOTAL / 100); p += 1) {
    await page.evaluate((p) => { location.hash = `/problems?size=100&page=${p}` }, p)
    await page.waitForFunction((p) => Number(document.querySelector('[data-role="summary"]')?.dataset.page) === p, p, { timeout: 15000 })
    all.push(...(await rowIds()))
  }
  check(`翻页取到的 id 集合 == 索引 ${TOTAL} 条（无重复无遗漏）`,
    all.length === TOTAL && new Set(all).size === TOTAL && new Set(all).size === new Set(INDEX.problems.map((p) => p.id)).size,
    `取到 ${all.length} 条，去重 ${new Set(all).size} 条`)

  // ── ③ 章节筛选：13 章逐章核对（含用户点名的 ch09 指针） ──
  const chapterRows = []
  for (const shard of INDEX.shards) {
    const key = shardKey(shard.file)
    await load(`/problems?chapter=${key}`)
    s = await sum()
    const expect = countWhere((p) => shardKey(p.file) === key)
    chapterRows.push({ key, name: shard.chapter, ui: s.filtered, json: expect, ok: s.filtered === expect && s.filtered === shard.count })
  }
  check(`${INDEX.shards.length} 个章节筛选命中数全部与 index.json 一致`, chapterRows.every((c) => c.ok),
    chapterRows.map((c) => `${c.key}=${c.ui}${c.ok ? '' : '≠' + c.json}`).join(' '))
  const ch09 = chapterRows.find((c) => c.key === 'c-ch09')
  check('章节筛选：ch09 指针 = ' + CH09 + ' 题', ch09.ui === CH09, `UI ${ch09.ui} / index ${CH09}（任务书写的 73 = 77 − 4 道简答题）`)

  // ── ④ 题型筛选：7 种逐个核对 ──
  const typeRows = []
  for (const t of ['code_completion', 'debug', 'code_reading', 'programming', 'single_choice', 'fill_blank', 'short_answer']) {
    await load(`/problems?type=${t}`)
    s = await sum()
    const expect = countWhere((p) => p.type === t)
    typeRows.push({ t, ui: s.filtered, json: expect, ok: s.filtered === expect })
  }
  check('7 种题型筛选命中数全部与 index.json 一致', typeRows.every((r) => r.ok), typeRows.map((r) => `${r.t}=${r.ui}`).join(' '))
  check('题型筛选：debug = ' + DEBUG_TOTAL + ' 题', typeRows.find((r) => r.t === 'debug').ui === DEBUG_TOTAL, `UI ${typeRows.find((r) => r.t === 'debug').ui} / index ${DEBUG_TOTAL}`)

  // ── ⑤ 难度筛选 ──
  const diffRows = []
  for (const d of [1, 2, 3, 4, 5]) {
    await load(`/problems?difficulty=${d}`)
    s = await sum()
    const expect = countWhere((p) => p.difficulty === d)
    diffRows.push({ d, ui: s.filtered, json: expect, ok: s.filtered === expect })
  }
  check('难度 1–5 筛选命中数与 index.json 一致（1 / 5 档库内为 0）', diffRows.every((r) => r.ok), diffRows.map((r) => `难度${r.d}=${r.ui}`).join(' '))

  // ── ⑥ 组合筛选：ch09 + debug ──
  await load(`/problems?chapter=c-ch09&type=debug`)
  s = await sum()
  const comboIds = await rowIds()
  check(`组合筛选 ch09 + debug = ${CH09_DEBUG.length} 题`, s.filtered === CH09_DEBUG.length && JSON.stringify(comboIds) === JSON.stringify([...CH09_DEBUG].sort()),
    `UI [${comboIds}] / index [${CH09_DEBUG}]`)
  check('组合筛选下章节列与题型列都对', (await page.evaluate(() => [...document.querySelectorAll('[data-role="row"]')].map((r) => `${r.dataset.chapter}|${r.dataset.type}`))).every((v) => v === 'c-ch09|debug'))

  // ── ⑦ 三维组合 + 排序 ──
  await load('/problems?chapter=c-ch09&type=code_reading&difficulty=3')
  const expect3 = countWhere((p) => shardKey(p.file) === 'c-ch09' && p.type === 'code_reading' && p.difficulty === 3)
  s = await sum()
  check('三维组合（ch09 + 阅读 + 难度3）命中数一致', s.filtered === expect3, `UI ${s.filtered} / index ${expect3}`)

  await load('/problems?sort=diff-desc&size=100')
  const diffs = await page.evaluate(() => [...document.querySelectorAll('[data-role="row"]')].map((r) => Number(r.dataset.difficulty)))
  check(`按难度降序：整页难度单调不增且首行为最高难度 ${MAX_DIFF}`, diffs.every((d, i) => i === 0 || diffs[i - 1] >= d) && diffs[0] === MAX_DIFF, `前 8 行难度 ${diffs.slice(0, 8).join(',')}`)
  await load('/problems?sort=diff-asc&size=100')
  const diffsAsc = await page.evaluate(() => [...document.querySelectorAll('[data-role="row"]')].map((r) => Number(r.dataset.difficulty)))
  check(`按难度升序：整页难度单调不减且首行为最低难度 ${MIN_DIFF}`, diffsAsc.every((d, i) => i === 0 || diffsAsc[i - 1] <= d) && diffsAsc[0] === MIN_DIFF, `前 8 行难度 ${diffsAsc.slice(0, 8).join(',')}`)
  await load('/problems?sort=index&size=20')
  check('题库原序排序 = index.json 原序', JSON.stringify(await rowIds()) === JSON.stringify(INDEX.problems.slice(0, 20).map((p) => p.id)))

  // ── ⑧ 分页 ──
  await load('/problems?size=20&page=2')
  s = await sum()
  const p2 = await rowIds()
  check('第 2 页（每页 20）内容 = 基准序列第 21–40 条', s.page === 2 && s.rows === 20 && JSON.stringify(p2) === JSON.stringify(DEFAULT_ORDER.slice(20, 40).map((p) => p.id)), `首行 ${p2[0]}`)
  await load('/problems?size=20&page=1')
  const p1 = await rowIds()
  check('相邻两页 id 不重叠', p1.filter((id) => p2.includes(id)).length === 0)
  await load('/problems?size=20&page=999')
  s = await sum()
  check('越界页码被夹到最后一页，不白屏', s.page === s.pageCount && s.rows > 0, `page=${s.page}/${s.pageCount}`)

  // ── ⑨ 点击 chip 是客户端筛选（不整页重载），且写进 URL ──
  await load('/problems')
  dataRequests = []
  // 整页重载会清掉 window 上的记号；Playwright 的 framenavigated 对同文档 hash 跳转也会触发，
  // 用它判「有没有重载」是错的（首轮验收就误报了一次），改挂在 window 上验。
  await page.evaluate(() => { window.__m5Alive = 'spa' })
  await page.locator('button[data-type="debug"]').first().click()
  await waitFiltered(DEBUG_TOTAL)
  await page.locator('select[aria-label="章节"]').selectOption('c-ch09')
  await waitFiltered(CH09_DEBUG.length)
  const hash = await page.evaluate(() => location.hash)
  check('点 chip / 选章节即时筛选，并把条件写进地址栏', hash.includes('type=debug') && hash.includes('chapter=c-ch09'), hash)
  check('客户端筛选期间文档没有重载（window 记号还在，索引未重新 fetch）',
    (await page.evaluate(() => window.__m5Alive)) === 'spa' && dataRequests.length === 0,
    'window.__m5Alive=' + (await page.evaluate(() => window.__m5Alive)))
  check('客户端筛选期间仍然一个分片都没请求', dataRequests.filter((f) => f !== 'index.json').length === 0, dataRequests.join(', ') || '（无新请求）')
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-list-filtered.png'), fullPage: true })

  // ── ⑩ 空状态 ──
  await load(`/problems?chapter=${EMPTY_COMBO.chapter}&type=${EMPTY_COMBO.type}`)
  const emptyTxt = await page.locator('[data-role="empty"]').innerText().catch(() => '')
  s = await sum()
  check(`空状态：${EMPTY_COMBO.chapter} + ${EMPTY_COMBO.type} 显示「无匹配题目」而非空白`,
    s.filtered === 0 && emptyTxt.includes('无匹配题目') && (await page.locator('[data-role="row"]').count()) === 0, emptyTxt.split('\n')[0])
  await page.locator('[data-role="empty"] button:has-text("清空全部筛选")').click()
  await waitFiltered(TOTAL)
  check(`空状态里的「清空全部筛选」一键回到 ${TOTAL} 题`, (await sum()).filtered === TOTAL)
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-list-empty.png'), fullPage: true })

  // ── ⑪ 状态三色：答错 → 答对 → 刷新保留 ──
  await page.evaluate(() => localStorage.removeItem('cpractice:progress:v1'))
  await load(`/problems?chapter=c-ch09&size=100`)
  check('初始状态：未做', (await rowAttr(CR_ID, 'status')) === 'todo', `行 ${CR_ID} data-status=${await rowAttr(CR_ID, 'status')}`)

  dataRequests = []
  await page.locator(`[data-role="row"][data-id="${CR_ID}"] a`).first().click()
  await page.waitForSelector('textarea[aria-label="程序阅读题运行结果输入框"]', { timeout: 30000 })
  check('点题目 → 跳详情页并正常加载（URL 与题干都到位）',
    page.url().includes(`#/problems/p/${CR_ID}`) && (await page.locator('h1').first().innerText()).includes('第9章'),
    await page.locator('h1').first().innerText())
  check('进详情页才 fetch 分片（懒加载生效）', dataRequests.some((f) => f === 'c-ch09.json'), dataRequests.join(', ') || '（无）')

  await page.locator('textarea[aria-label="程序阅读题运行结果输入框"]').fill('0 0 0')
  await page.locator('button:has-text("提交判分")').first().click()
  await page.waitForFunction(() => /未通过：/.test(document.body.innerText), null, { timeout: 20000 })
  await page.evaluate(() => history.back())
  await page.waitForSelector(`[data-role="row"][data-id="${CR_ID}"]`, { timeout: 20000 })
  check('答错后返回列表 → 状态「尝试过未通过」（黄）', (await rowAttr(CR_ID, 'status')) === 'attempted', `data-status=${await rowAttr(CR_ID, 'status')}`)
  check('返回时筛选条件仍在（history.back 回到 ch09 + 每页 100）', page.url().includes('chapter=c-ch09') && (await sum()).filtered === CH09, page.url().split('#')[1])

  await page.locator(`[data-role="row"][data-id="${CR_ID}"] a`).first().click()
  await page.waitForSelector('textarea[aria-label="程序阅读题运行结果输入框"]', { timeout: 30000 })
  await page.locator('textarea[aria-label="程序阅读题运行结果输入框"]').fill(CR_ANSWER)
  await page.locator('button:has-text("提交判分")').first().click()
  await page.waitForFunction(() => /判分通过：/.test(document.body.innerText), null, { timeout: 20000 })
  check(`答对（填入实机取证答案「${CR_ANSWER}」）→ 详情页判分通过`, true)

  await page.locator('nav a:has-text("在线刷题")').first().click()
  await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 20000 })
  await page.locator('select[aria-label="章节"]').selectOption('c-ch09')
  await waitFiltered(CH09)
  await page.locator('select[aria-label="每页条数"]').selectOption('100')
  await waitFiltered(CH09)
  check('做对一道题后返回列表 → 状态变「已通过」（绿）', (await rowAttr(CR_ID, 'status')) === 'passed', `data-status=${await rowAttr(CR_ID, 'status')}`)

  const rawLs = await page.evaluate(() => localStorage.getItem('cpractice:progress:v1'))
  const ls = rawLs ? JSON.parse(rawLs) : null
  const rec = ls?.state?.records?.[CR_ID]
  check('localStorage cpractice:progress:v1 落了盘且字段齐', !!rec && rec.everPassed === true && rec.attempts === 2 && rec.result === 'passed',
    rec ? JSON.stringify(rec) : '键不存在：' + String(rawLs).slice(0, 120))

  await load('/problems?status=passed')
  check('状态筛选「只看已通过」= 1 题且正是刚做对的那道', (await sum()).filtered === 1 && (await rowIds())[0] === CR_ID)
  await load('/problems?status=attempted')
  check('状态筛选「只看尝试过未通过」= 0 题（everPassed 不回退）', (await sum()).filtered === 0)
  await load('/problems?status=todo')
  check(`状态筛选「只看未做」= ${TOTAL - 1} 题（全库减去流程里刚做对的那 1 道）`, (await sum()).filtered === TOTAL - 1, `UI ${(await sum()).filtered}`)

  await load(`/problems?chapter=c-ch09&size=100`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 30000 })
  check('F5 刷新后状态仍是「已通过」（localStorage 持久化）', (await rowAttr(CR_ID, 'status')) === 'passed', `data-status=${await rowAttr(CR_ID, 'status')}`)
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-list-status.png'), fullPage: true })

  // ── ⑫ 深浅色主题切换下列表页不破（ThemeToggle 的三个按钮只有 title，没有 aria-label） ──
  const rowsBefore = await page.locator('[data-role="row"]').count()
  await page.locator('button[title="深色"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 })
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-list-dark.png'), fullPage: true })
  await page.locator('button[title="浅色"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 })
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-list-light.png'), fullPage: true })
  check('深浅色切换：html[data-theme] 与 body 底色都真的变了，且行数不变',
    darkBg !== lightBg && (await page.locator('[data-role="row"]').count()) === rowsBefore,
    `dark=${darkBg} light=${lightBg} rows=${rowsBefore}`)
  const themePersist = await page.evaluate(() => JSON.parse(localStorage.getItem('cpractice:settings:v1') || '{}')?.state?.mode)
  check('主题选择写进 cpractice:settings:v1', themePersist === 'light', 'mode=' + themePersist)

  // ── ⑬ 控制台 ──
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('全程控制台 error/warn 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? `共 ${consoleMsgs.length} 条其它消息，0 error 0 warn 0 pageerror`
      : JSON.stringify({ bad: bad.slice(0, 6), pageErrors: pageErrors.slice(0, 3) }).slice(0, 800))

  await browser.close()
}

try { await main() } catch (e) { check('UI 验收流程未抛异常', false, (e instanceof Error ? e.stack : String(e)).split('\n').slice(0, 4).join(' | ')) } finally { preview.kill() }

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 模块 5 UI 验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exitCode = failed.length > 0 ? 1 : 0

// 兜底看门狗（阶段D 补，2026-09-13）：main() 中途抛异常时 browser.close() 被跳过，
// 残留 chrome 子进程会一直占着 stdio 句柄，node 事件循环永不退出 —— 曾把整批验收卡死 15 分钟。
// unref 后不影响正常退出；若 3 秒后仍有句柄赖着不走，按已记录的退出码强制收工。
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref()