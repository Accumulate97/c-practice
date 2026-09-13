/**
 * 线上验收：直接打 GitHub Pages 真实地址，验两件本地测不了的事——
 *   ① CDN + HTTPS + 子路径下资源真的全 200（base './' + HashRouter 在线上活）
 *   ② Godbolt CORS 在非 localhost origin 下正常（此前所有验收都跑在 127.0.0.1，
 *      跨域策略只有在真实域名下才见真章）
 *
 * 与 acceptance-subpath.mjs 的分工：那个起本地静态服务器验「路径形态」；
 * 这个不起任何服务，直接打线上。判分断言口径与 spotcheck-20.mjs 完全一致。
 *
 * 用法：node scripts/acceptance-online.mjs [base] [抽检代码题数]
 *   base 默认 https://accumulate97.github.io/c-practice/
 * 代码题严格串行（AGENTS.md 二·5：禁止并发打 Godbolt）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const BASE = (process.argv[2] ?? 'https://accumulate97.github.io/c-practice/').replace(/\/+$/, '') + '/'
const SAMPLE_N = Number(process.argv[3] ?? 3)

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + String(detail).slice(0, 200) : ''}`)
}

const localIndex = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/index.json'), 'utf8'))
const shardCache = new Map()
function loadShard(file) {
  if (!shardCache.has(file)) {
    shardCache.set(file, JSON.parse(readFileSync(join(ROOT, 'public/data/problems', file), 'utf8')))
  }
  return shardCache.get(file)
}
const recOf = (e) => loadShard(e.file).problems.find((p) => p.id === e.id)

/* ============ A. HTTP 探针：首页 + 数据分片 + 真实 asset 全 200 ============ */
async function probe(rel, label) {
  const url = BASE + rel
  try {
    const r = await fetch(url)
    const ok = r.ok
    check(`HTTP ${label ?? rel}`, ok, `status=${r.status} ${url}`)
    return ok ? await r.text() : null
  } catch (e) {
    check(`HTTP ${label ?? rel}`, false, e.message)
    return null
  }
}

const html = await probe('', '首页 /')
for (const rel of ['data/problems/index.json', 'data/knowledge/index.json', 'data/viz/index.json', 'data/search/problems.json', 'favicon.svg']) {
  await probe(rel)
}

// index.html 里引用的每个 asset 都必须能拉到 —— 子目录部署最常见的死法就是这里 404
if (html) {
  const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1].slice(2))
  check('首页 asset 引用数 > 0', refs.length > 0, refs.join(', '))
  for (const ref of refs) await probe(ref, `asset ${ref}`)
  check('首页无绝对路径引用（子目录部署硬闸门）', !/(?:src|href)="\/[^/"]/.test(html))
}

/* ============ B. 线上索引与仓库一致（题量 / verified 数） ============ */
let onlineIndex = null
try {
  onlineIndex = JSON.parse(await (await fetch(BASE + 'data/problems/index.json')).text())
} catch (e) {
  check('线上 problems/index.json 可解析', false, e.message)
}
if (onlineIndex) {
  check('线上题量 === 仓库题量', onlineIndex.problems.length === localIndex.problems.length,
    `线上=${onlineIndex.problems.length} 仓库=${localIndex.problems.length}`)
}
let verifiedCount = 0
for (const e of localIndex.problems) if (recOf(e)?.verified === true) verifiedCount += 1
check('仓库 verified 数 === 2068', verifiedCount === 2068, `verified=${verifiedCount}`)

/* ============ C. 浏览器：三大板块 + 线上真实判分 ============ */
const consoleIssues = []

// c-ch03-pg-001 是 programming 且无 solution 字段（题面自含），答案按题面推导并本地实机核对：
//   cl=2πr cs=πr² cvz=cs·h，三组用例（1.5/3、0/5、100/0.5）输出与 expected 逐字符相同
const PG001_ANSWER = [
  '#include <stdio.h>',
  '',
  'int main(void) {',
  '    const double PI = 3.14159265358979;',
  '    double r, h;',
  '    if (scanf("%lf%lf", &r, &h) != 2) return 1;',
  '    double cl = 2.0 * PI * r;',
  '    double cs = PI * r * r;',
  '    double cvz = cs * h;',
  '    printf("cl=%.2f\\ncs=%.2f\\ncvz=%.2f\\n", cl, cs, cvz);',
  '    return 0;',
  '}',
].join('\n')

async function judgeProgramming(page, id, code) {
  await page.goto(`${BASE}#/problems/p/${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea[aria-label="编程题代码编辑器"]', { timeout: 30000 })
  await page.locator('textarea[aria-label="编程题代码编辑器"]').first().fill(code)
  await page.locator('button:has-text("提交判分")').first().click()
  await page.waitForFunction(() => /判分通过|未通过：|本次未判定|后端不可用/.test(document.body.innerText), null, { timeout: 240000 })
  const txt = await page.evaluate(() => document.body.innerText)
  if (!/判分通过/.test(txt)) {
    throw new Error('未判过：' + (txt.match(/未通过：[^\n]*|本次未判定[^\n]*|后端不可用[^\n]*/) ?? [''])[0])
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  page.on('console', (m) => {
    const t = m.type()
    if ((t === 'error' || t === 'warning') && !m.text().includes('favicon')) {
      consoleIssues.push(`[${t}] ${m.text().slice(0, 160)}`)
    }
  })
  page.on('pageerror', (e) => consoleIssues.push(`[pageerror] ${String(e.message).slice(0, 160)}`))

  // 首页：三大板块入口齐全
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 30000 })
  const navTxt = await page.locator('nav[aria-label="主导航"]').innerText()
  for (const kw of ['知识点', '可视化', '刷题']) {
    check(`首页导航含「${kw}」`, navTxt.includes(kw), navTxt.replace(/\n/g, ' / '))
  }

  // 题目列表：线上真的能列出全量题
  await page.goto(`${BASE}#/problems`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-role="problem-table"], [data-role="row"]', { timeout: 30000 })
  const listTxt = await page.evaluate(() => document.body.innerText)
  check('题目列表显示总题量 2074', listTxt.includes('2074'), (listTxt.match(/\d{3,5}\s*道/) ?? [''])[0])

  // 知识卡片列表 + 演示列表 + 进度页
  await page.goto(`${BASE}#/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-role="knowledge-list"] [data-role="card-title"], [data-role="knowledge-list"]', { timeout: 30000 })
  check('知识卡片列表可访问', (await page.locator('[data-role="knowledge-list"]').count()) > 0)

  await page.goto(`${BASE}#/viz`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-role="viz-card"]', { timeout: 30000 })
  const vizN = await page.locator('[data-role="viz-card"]').count()
  check('演示列表可访问（卡片数 > 20）', vizN > 20, `viz-card=${vizN}`)

  await page.goto(`${BASE}#/progress`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-role="overview"], [data-role="summary"]', { timeout: 30000 })
  check('进度页可访问', true)

  // 【最关键】线上判分：非 localhost origin 下 Godbolt CORS 是否放行
  try {
    await judgeProgramming(page, 'c-ch03-pg-001', PG001_ANSWER)
    check('线上判分 c-ch03-pg-001 → 判分通过（Godbolt CORS OK）', true)
  } catch (e) {
    check('线上判分 c-ch03-pg-001 → 判分通过（Godbolt CORS OK）', false, e.message)
  }

  // 随机抽检 N 道可自动判分的代码题（串行）
  const pool = localIndex.problems.filter((e) => {
    const p = recOf(e)
    if (!p || p.verified !== true) return false
    if (e.type === 'programming') return typeof p.solution === 'string' && p.solution.trim() && p.testCases?.length > 0
    if (e.type === 'debug') return typeof p.fixed_code === 'string' && p.fixed_code.trim() && p.testCases?.length > 0
    return false
  })
  let seed = 20260913
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const picked = []
  const bag = [...pool]
  while (picked.length < SAMPLE_N && bag.length) picked.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0])
  for (const e of picked) {
    const p = recOf(e)
    const code = e.type === 'programming' ? p.solution : p.fixed_code
    const aria = e.type === 'programming' ? 'textarea[aria-label="编程题代码编辑器"]' : 'textarea[aria-label*="程序改错"]'
    try {
      await page.goto(`${BASE}#/problems/p/${e.id}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector(aria, { timeout: 30000 })
      await page.locator(aria).first().fill(code)
      await page.locator('button:has-text("提交判分")').first().click()
      await page.waitForFunction(() => /判分通过|未通过：|本次未判定|后端不可用/.test(document.body.innerText), null, { timeout: 240000 })
      const txt = await page.evaluate(() => document.body.innerText)
      if (!/判分通过/.test(txt)) throw new Error((txt.match(/未通过：[^\n]*|本次未判定[^\n]*|后端不可用[^\n]*/) ?? [''])[0])
      check(`线上抽检 ${e.id} (${e.type}) → 判分通过`, true)
    } catch (err) {
      check(`线上抽检 ${e.id} (${e.type}) → 判分通过`, false, err.message)
    }
  }

  check('线上控制台 error/warn 为空', consoleIssues.length === 0, consoleIssues.slice(0, 6).join(' ; '))
  await browser.close()
}

await main()
const failed = checks.filter((c) => !c.ok)
console.log(`\n线上地址 ${BASE}\n合计 ${checks.length} 项 · 失败 ${failed.length} 项`)
process.exit(failed.length === 0 ? 0 : 1)
