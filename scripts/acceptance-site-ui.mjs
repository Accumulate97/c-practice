/**
 * 阶段 4 整站回归 → 阶段 10 收口后作为「全站最终验收」主脚本（四道主力题打真 Godbolt）：真实浏览器里跑 dist 产物。
 *
 * 与模块级验收的分工：模块 1–5 各自的脚本验「自己那一段」，本脚本验「串起来还成立」：
 *   ① 四种主力题型端到端各走一遍（编程 / 阅读 / 填空 / 改错），其中编程、填空、改错打真 Godbolt
 *   ② 首页三个板块入口可点，且三板块列表页总数与各自 index.json 现算一致（阶段 10 之后已无占位页）
 *   ③ 深浅色主题切换
 *   ④ 四道题做完后回列表页 → 四条「已通过」；F5 刷新后仍在（localStorage）
 *   ⑤ 全程控制台 error / warning / pageerror 为空
 * 数据一律从分片现读（fixed_code / answer），脚本里不抄代码、不抄答案。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4176
const BASE = `http://127.0.0.1:${PORT}/`

const PG = 'c-ch03-pg-001'
const CR = 'c-ch09-cr-043'
const CC = 'c-ch04-cc-001'
const DBG = 'c-ch04-dbg-001'

const ch03 = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/c-ch03.json'), 'utf8'))
const ch04 = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/c-ch04.json'), 'utf8'))
const ch09 = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/c-ch09.json'), 'utf8'))
const CR_ANSWER = (ch09.problems.find((p) => p.id === CR).answer ?? '').trim()
const DBG_FIXED = ch04.problems.find((p) => p.id === DBG).fixed_code
const CC_BLANKS = ch04.problems.find((p) => p.id === CC).blanks
const CC_ANSWERS = Object.fromEntries(CC_BLANKS.map((b) => [b.index, b.answer]))
const PG_CASES = ch03.problems.find((p) => p.id === PG).testCases.length

/** 圆周长 / 圆面积 / 圆柱体积：与 c-ch03-pg-001 三组期望输出逐位对齐（π 取足位数，不用 3.14） */
const PG_SOLUTION = [
  '#include <stdio.h>',
  '',
  'int main(void) {',
  '    double r = 0;',
  '    double h = 0;',
  '    const double pi = 3.14159265358979;',
  '    if (scanf("%lf %lf", &r, &h) != 2) return 1;',
  '    printf("cl=%.2f\\n", 2 * pi * r);',
  '    printf("cs=%.2f\\n", pi * r * r);',
  '    printf("cvz=%.2f\\n", pi * r * r * h);',
  '    return 0;',
  '}',
  '',
].join('\n')

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
let godboltRequests = 0

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)
  console.log(`  四道题：${PG}（${PG_CASES} 组） ${CR} ${CC}（${CC_BLANKS.length} 空） ${DBG}`)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('request', (r) => { if (r.url().startsWith('https://godbolt.org/')) godboltRequests += 1 })

  const bodyText = () => page.evaluate(() => document.body.innerText)
  const verdictLine = () => page.evaluate(() => (document.body.innerText.match(/(判分通过：[^\n]*|未通过：[^\n]*|本次未判定[^\n]*)/) ?? ['(未找到结论文案)'])[0])
  async function open(id) {
    await page.goto(`${BASE}#/problems/p/${id}`, { waitUntil: 'networkidle' })
  }
  async function submitAndWait(re, timeout = 150000) {
    await page.locator('button:has-text("提交判分")').first().click()
    await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), re, { timeout })
    return verdictLine()
  }

  // ── ① 首页三个板块入口 → 三板块列表页真的能用（阶段 10 之后不再是「本板块将在…」占位） ──
  //    期望值一律从 index.json 现算：后续加 _staging 真题 / 数据结构 / 变式题，这段不用改一行
  const kIdx = JSON.parse(readFileSync(join(ROOT, 'public/data/knowledge/index.json'), 'utf8'))
  const pIdx = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/index.json'), 'utf8'))
  const vIdx = JSON.parse(readFileSync(join(ROOT, 'public/data/viz/index.json'), 'utf8'))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const cards = await page.locator('a[href*="#/knowledge"], a[href*="#/viz"], a[href*="#/problems"]').count()
  check('首页三个板块入口卡片都在', cards >= 3, `匹配到 ${cards} 个入口链接`)

  await page.locator('a:has-text("知识点汇总")').first().click()
  await page.waitForSelector('[data-role="knowledge-list"] [data-role="row"]', { timeout: 30000 })
  const kTotal = await page.getAttribute('[data-role="summary"]', 'data-total')
  check(`知识板块入口可点 → 列表页总数与索引一致（${kIdx.count} 张卡片）`,
    Number(kTotal) === kIdx.count, `data-total=${kTotal} 索引 count=${kIdx.count}`)

  await page.locator('a:has-text("可视化演示")').first().click()
  await page.waitForSelector('[data-role="viz-card"]', { timeout: 30000 })
  const vCards = await page.locator('[data-role="viz-card"]').count()
  check(`可视化板块入口可点 → 演示卡片数与索引一致（${vIdx.demos.length} 套）`,
    vCards === vIdx.demos.length, `页面 ${vCards} 张 / 索引 ${vIdx.demos.length} 套`)

  await page.locator('a:has-text("在线刷题")').first().click()
  await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 30000 })
  const pTotal = await page.getAttribute('[data-role="summary"]', 'data-total')
  check(`刷题板块入口可点 → 列表页总数与索引一致（${pIdx.count} 题）`,
    Number(pTotal) === pIdx.count, `data-total=${pTotal} 索引 count=${pIdx.count}`)

  // ── ② programming：c-ch03-pg-001 答对 3/3 ──
  await open(PG)
  await page.waitForSelector('textarea[aria-label="编程题代码编辑器"]', { timeout: 30000 })
  await page.locator('textarea[aria-label="编程题代码编辑器"]').fill(PG_SOLUTION)
  let line = await submitAndWait('判分通过：3\\/3|未通过：|本次未判定')
  check(`programming ${PG} 答对 3/3`, line.startsWith('判分通过：3/3'), line)
  await page.screenshot({ path: join(ROOT, 'tmp', 'site-pg.png'), fullPage: false })

  // ── ③ code_reading：c-ch09-cr-043 答对（本地判分，不打网络） ──
  await open(CR)
  await page.waitForSelector('textarea[aria-label="程序阅读题运行结果输入框"]', { timeout: 30000 })
  await page.locator('textarea[aria-label="程序阅读题运行结果输入框"]').fill(CR_ANSWER)
  line = await submitAndWait('判分通过：|未通过：')
  check(`code_reading ${CR} 答对`, line.startsWith('判分通过：'), line)

  // ── ④ code_completion：c-ch04-cc-001 答对 + Tab 跳空位 ──
  await open(CC)
  await page.waitForSelector('.cm-blank-badge', { timeout: 30000 })
  const activeBadge = () => page.evaluate(() => document.querySelector('.cm-blank-badge-active')?.textContent ?? '-')
  await page.locator('button:has-text("空位 1")').first().click()
  const seq = [await activeBadge()]
  for (let i = 0; i < CC_BLANKS.length; i += 1) { await page.keyboard.press('Tab'); seq.push(await activeBadge()) }
  check(`Tab 在 ${CC_BLANKS.length} 个空位间循环跳转`, seq.join('>') === '1>2>3>1', seq.join('>'))
  await page.locator('button:has-text("空位 1")').first().click()
  for (let i = 1; i <= CC_BLANKS.length; i += 1) {
    await page.keyboard.type(CC_ANSWERS[i])
    if (i < CC_BLANKS.length) await page.keyboard.press('Tab')
  }
  line = await submitAndWait('判分通过：3\\/3|未通过：|本次未判定')
  check(`code_completion ${CC} 填对 → 判分通过 3/3`, line.startsWith('判分通过：3/3'), line)
  await page.screenshot({ path: join(ROOT, 'tmp', 'site-cc.png'), fullPage: false })

  // ──  debug：c-ch04-dbg-001 不改 → 0/3，改对 → 3/3 ──
  await open(DBG)
  await page.waitForSelector('textarea[aria-label*="程序改错"]', { timeout: 30000 })
  line = await submitAndWait('未通过：|判分通过：|本次未判定')
  check(`debug ${DBG} 不改代码直接提交 → 0/3`, line.startsWith('未通过：0/3'), line)
  await page.locator('textarea[aria-label*="程序改错"]').fill(DBG_FIXED)
  line = await submitAndWait('判分通过：3\\/3|未通过：|本次未判定')
  check(`debug ${DBG} 改对 → 判分通过 3/3`, line.startsWith('判分通过：3/3'), line)
  await page.screenshot({ path: join(ROOT, 'tmp', 'site-dbg.png'), fullPage: false })

  check('四道题一共打了 12 次真 Godbolt 请求（3+3+3+3，串行）', godboltRequests === 12, `godbolt.org 请求 ${godboltRequests} 次`)

  // ──  回列表页：四条已通过；刷新后仍在 ──
  await page.goto(`${BASE}#/problems?status=passed`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 30000 })
  const passedIds = await page.evaluate(() => [...document.querySelectorAll('[data-role="row"]')].map((r) => r.dataset.id).sort())
  check('列表页「只看已通过」恰好是刚做完的四道',
    JSON.stringify(passedIds) === JSON.stringify([PG, CR, CC, DBG].sort()), passedIds.join(','))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 30000 })
  const afterReload = await page.evaluate(() => [...document.querySelectorAll('[data-role="row"]')].map((r) => r.dataset.id).sort())
  check('F5 刷新后四条「已通过」仍在（localStorage 持久化）', JSON.stringify(afterReload) === JSON.stringify(passedIds), afterReload.join(','))
  const ls = JSON.parse(await page.evaluate(() => localStorage.getItem('cpractice:progress:v1') ?? 'null'))
  check('localStorage 里四条记录 everPassed 均为 true',
    !!ls && [PG, CR, CC, DBG].every((id) => ls.state?.records?.[id]?.everPassed === true),
    Object.keys(ls?.state?.records ?? {}).length + ' 条记录')
  await page.screenshot({ path: join(ROOT, 'tmp', 'site-list-passed.png'), fullPage: true })

  // ── ⑦ 主题切换 ──
  await page.locator('button[title="深色"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 })
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.screenshot({ path: join(ROOT, 'tmp', 'site-dark.png'), fullPage: false })
  await page.locator('button[title="浅色"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 })
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('深浅色主题切换正常（body 底色真的变了）', darkBg !== lightBg, `dark=${darkBg} light=${lightBg}`)

  // ── ⑧ 控制台 ──
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('全流程控制台 error/warn 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? `共 ${consoleMsgs.length} 条其它消息，0 error 0 warn 0 pageerror`
      : JSON.stringify({ bad: bad.slice(0, 6), pageErrors: pageErrors.slice(0, 3) }).slice(0, 800))
  if (consoleMsgs.length) {
    const kinds = {}
    for (const m of consoleMsgs) kinds[m.type] = (kinds[m.type] ?? 0) + 1
    console.log('     控制台消息类型分布：' + JSON.stringify(kinds))
  }

  await browser.close()
}

try { await main() } catch (e) { check('整站回归流程未抛异常', false, (e instanceof Error ? e.stack : String(e)).split('\n').slice(0, 4).join(' | ')) } finally { preview.kill() }

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 全站最终验收（整站回归）汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exitCode = failed.length > 0 ? 1 : 0
