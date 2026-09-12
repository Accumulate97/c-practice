/**
 * 阶段 D1·随机抽 20 题浏览器实测判分（5 代码题 + 5 指针题 + 10 其它，含 ds 覆盖）。
 * 用法：node tmp/spotcheck20.mjs   （前置：npm run build 已产出 dist）
 * 采样用固定种子，可复现；判分断言口径与各 acceptance 脚本一致（verdict data-tone / 判分通过 文案）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4179
const BASE = `http://127.0.0.1:${PORT}/`

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260913)
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const index = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/index.json'), 'utf8'))
const shardCache = new Map()
function loadShard(file) {
  if (!shardCache.has(file)) shardCache.set(file, JSON.parse(readFileSync(join(ROOT, 'public/data/problems', file), 'utf8')))
  return shardCache.get(file)
}
const recOf = (e) => loadShard(e.file).problems.find((p) => p.id === e.id)

const CODE_TYPES = ['programming', 'debug', 'code_reading']
function automatable(e) {
  const p = recOf(e)
  if (!p) return false
  switch (e.type) {
    case 'single_choice': return typeof p.answer === 'number' && Array.isArray(p.options) && p.answer >= 0 && p.answer < p.options.length
    case 'true_false': return typeof p.answer === 'boolean'
    case 'fill_blank': return Array.isArray(p.blanks) && p.blanks.length > 0 && p.blanks.every((b) => typeof b.answer === 'string' && b.answer.trim().length > 0)
    case 'code_reading': return typeof p.answer === 'string' && p.answer.trim().length > 0 && p.answerIsDescription !== true
    case 'programming': return typeof p.solution === 'string' && p.solution.trim().length > 0 && Array.isArray(p.testCases) && p.testCases.length > 0
    case 'debug': return typeof p.fixed_code === 'string' && p.fixed_code.trim().length > 0 && Array.isArray(p.testCases) && p.testCases.length > 0
    default: return false
  }
}

const pool = index.problems.filter(automatable)
const picked = new Map() // id -> {entry, bucket}
function take(list, n, bucket) {
  for (const e of shuffle(list)) {
    if (n <= 0) break
    if (picked.has(e.id)) continue
    picked.set(e.id, { entry: e, bucket })
    n -= 1
  }
  return n
}
let left = take(pool.filter((e) => CODE_TYPES.includes(e.type)), 5, 'code')
let leftPtr = take(pool.filter((e) => e.file === 'c-ch09.json'), 5, 'pointer')
const dsRest = pool.filter((e) => e.category === 'ds' && !picked.has(e.id))
let leftDs = take(dsRest, 4, 'other-ds')
let leftOther = take(pool.filter((e) => !picked.has(e.id)), left + leftPtr + leftDs + 6, 'other')
const chosen = [...picked.values()]
console.log(`采样 ${chosen.length} 题：code=${chosen.filter(c=>c.bucket==='code').length} pointer=${chosen.filter(c=>c.bucket==='pointer').length} ds=${chosen.filter(c=>c.bucket==='other-ds').length} other=${chosen.filter(c=>c.bucket==='other').length}`)
if (chosen.length < 20) { console.error('采样不足 20 题'); process.exit(1) }

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + String(detail).slice(0, 160) : ''}`)
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }
const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
let previewErr = ''
preview.stderr.on('data', (d) => { previewErr += d.toString() })
async function waitPreview() {
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch(BASE); if (r.ok) return } catch { /* 未起 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('vite preview 起不来：' + previewErr.slice(0, 400))
}

const consoleIssues = []

async function runOne(browser, { entry, bucket }) {
  const p = recOf(entry)
  const id = entry.id
  const page = await browser.newPage()
  page.on('console', (m) => {
    const t = m.type()
    if ((t === 'error' || t === 'warning') && !m.text().includes('favicon')) consoleIssues.push(`${id} [${t}] ${m.text().slice(0, 140)}`)
  })
  page.on('pageerror', (e) => consoleIssues.push(`${id} [pageerror] ${String(e.message).slice(0, 140)}`))
  try {
    await page.goto(`${BASE}#/problems/p/${id}`, { waitUntil: 'domcontentloaded' })
    if (entry.type === 'single_choice') {
      await page.waitForSelector('[data-role="choice-option"]', { timeout: 20000 })
      await page.locator('[data-role="choice-option"]').nth(p.answer).click()
      await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
    } else if (entry.type === 'true_false') {
      await page.waitForSelector('[data-role="tf-option"]', { timeout: 20000 })
      await page.locator('[data-role="tf-option"]').nth(p.answer ? 0 : 1).click()
      await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
    } else if (entry.type === 'fill_blank') {
      await page.waitForSelector('[data-role="blank-input"]', { timeout: 20000 })
      const inputs = page.locator('[data-role="blank-input"]')
      for (let i = 0; i < p.blanks.length; i += 1) await inputs.nth(i).fill(p.blanks[i].answer)
      await page.locator('button:has-text("提交判分")').first().click()
      await page.waitForSelector('[data-role="verdict"][data-tone="good"]', { timeout: 10000 })
    } else if (entry.type === 'code_reading') {
      await page.waitForSelector('textarea[aria-label="程序阅读题运行结果输入框"]', { timeout: 20000 })
      await page.locator('textarea[aria-label="程序阅读题运行结果输入框"]').first().fill(p.answer)
      await page.locator('button:has-text("提交判分")').first().click()
      // 修正（2026-09-13）：data-role="verdict" 只存在于 concept-shared.tsx（选择/判断/填空），
      // 程序阅读题的判分结果不走那个组件，原写法必超时——是探针脚本前提错，不是站点回归。
      // 改成与 acceptance-list-ui.mjs 同一口径：直接断言页面出现「判分通过：」文案。
      await page.waitForFunction(() => /判分通过：|未通过：/.test(document.body.innerText), null, { timeout: 30000 })
      const crTxt = await page.evaluate(() => document.body.innerText)
      if (!/判分通过：/.test(crTxt)) throw new Error('阅读题未判过：' + (crTxt.match(/未通过：[^\n]*/) ?? [''])[0])
    } else if (entry.type === 'programming') {
      await page.waitForSelector('textarea[aria-label="编程题代码编辑器"]', { timeout: 20000 })
      await page.locator('textarea[aria-label="编程题代码编辑器"]').first().fill(p.solution)
      await page.locator('button:has-text("提交判分")').first().click()
      await page.waitForFunction(() => /判分通过|未通过：|本次未判定/.test(document.body.innerText), null, { timeout: 240000 })
      const txt = await page.evaluate(() => document.body.innerText)
      if (!/判分通过/.test(txt)) throw new Error('编程题未判过：' + (txt.match(/未通过：[^\n]*|本次未判定[^\n]*/) ?? [''])[0])
    } else if (entry.type === 'debug') {
      await page.waitForSelector('textarea[aria-label*="程序改错"]', { timeout: 20000 })
      await page.locator('textarea[aria-label*="程序改错"]').first().fill(p.fixed_code)
      await page.locator('button:has-text("提交判分")').first().click()
      await page.waitForFunction(() => /判分通过|未通过：|本次未判定/.test(document.body.innerText), null, { timeout: 240000 })
      const txt = await page.evaluate(() => document.body.innerText)
      if (!/判分通过/.test(txt)) throw new Error('改错题未判过：' + (txt.match(/未通过：[^\n]*|本次未判定[^\n]*/) ?? [''])[0])
    } else {
      throw new Error('未覆盖的题型 ' + entry.type)
    }
    check(`[${bucket}] ${id} (${entry.type}) 提交→判分通过`, true)
  } catch (e) {
    check(`[${bucket}] ${id} (${entry.type}) 提交→判分通过`, false, e instanceof Error ? e.message : String(e))
  } finally {
    await page.close()
  }
}

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  // 串行跑，避免并发打 Godbolt（硬约束）
  for (const item of chosen) await runOne(browser, item)
  await browser.close()
  check('控制台 error/warn 为空', consoleIssues.length === 0, consoleIssues.join(' ; '))
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n合计 ${checks.length} 项 · 失败 ${failed.length} 项`)
  process.exit(failed.length === 0 ? 0 : 1)
}

try { await main() } catch (e) { console.error('SPOTCHECK CRASH:', e); process.exit(1) } finally { preview.kill() }

// 兜底看门狗：若某题判分卡住导致事件循环不退出，30 分钟后强制收工（退出码沿用已记录值）
setTimeout(() => process.exit(process.exitCode ?? 1), 30 * 60 * 1000).unref()
