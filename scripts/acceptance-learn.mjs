/**
 * 学习板块 UI 验收（任务 3-2 起）：npm run acceptance:learn
 *
 * 与其它 acceptance-*-ui.mjs 同一口径：dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净。
 * 学习路径这条守住五个点：
 *   ① 关卡是「现算」的：页面关卡数必须等于 problems/index.json 里的章节数（不是写死的 20）
 *   ② 顺序解锁真生效：零进度时每条轨道只有第 1 关是「进行中」，其余全 locked；
 *      播种「第 1 关通关」的进度后，第 1 关变 cleared、第 2 关变 current
 *   ③ locked 关卡不放行：展开只有解锁提示，一个卡片 / 题目链接都不给
 *   ④ 自由模式开关写 localStorage 且刷新后保持（如实标注，不做隐性放行）
 *   ⑤ 路由级 lazy：首页不下载 PathPage chunk；375px 窄屏无横向溢出
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4194
const BASE = `http://127.0.0.1:${PORT}/`
const PROGRESS_KEY = 'cpractice:progress:v1'
const PATH_KEY = 'cpractice:path:v1'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}
async function safe(name, fn) {
  try { const d = await fn(); check(name, true, d ?? '') } catch (e) { check(name, false, String(e?.message ?? e).slice(0, 240)) }
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }
{
  const walkNewest = (dir) => {
    let best = { mtimeMs: 0, path: '' }
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(ts|tsx|css)$/.test(e.name)) continue
      const p = join(e.parentPath ?? e.path ?? dir, e.name)
      const m = statSync(p).mtimeMs
      if (m > best.mtimeMs) best = { mtimeMs: m, path: p }
    }
    return best
  }
  const src = walkNewest(join(ROOT, 'src'))
  if (src.mtimeMs > statSync(join(ROOT, 'dist', 'index.html')).mtimeMs) {
    console.error(`dist 陈旧：${src.path} 比 dist/index.html 新，请先 npm run build`)
    process.exit(1)
  }
}

const pidx = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'problems', 'index.json'), 'utf8'))
const targetFor = (n) => Math.min(12, Math.max(3, Math.ceil(n * 0.15)))
const chapters = []
for (const p of pidx.problems) {
  const track = p.category === 'ds' ? 'ds' : 'c'
  const key = `${track}|${p.chapter}`
  let b = chapters.find((x) => x.key === key)
  if (!b) { b = { key, track, chapter: p.chapter, problems: [] }; chapters.push(b) }
  b.problems.push(p.id)
}
const cLevels = chapters.filter((x) => x.track === 'c')
const dsLevels = chapters.filter((x) => x.track === 'ds')
const firstC = cLevels[0]
const firstCtarget = targetFor(firstC.problems.length)

const rec = (passed) => {
  const t = Date.now()
  return {
    result: passed ? 'passed' : 'attempted', attempts: 1, everPassed: passed,
    firstPassedAt: passed ? t : null, firstAttemptAt: t, lastAt: t, wrongCount: passed ? 0 : 1,
    lastWrongAt: passed ? null : t, wrongDismissedAt: null, lastAnswer: null, lastAnswerKind: null,
    lastAnswerTruncated: false, starred: false, note: '', selfAssessed: false,
  }
}
const seed = (ids) => JSON.stringify({ state: { records: Object.fromEntries(ids.map((id) => [id, rec(true)])) }, version: 1 })

const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT })
let perr = ''
preview.stderr.on('data', (d) => { perr += d })
for (let i = 0; i < 150; i++) { try { const r = await fetch(BASE); if (r.ok) break } catch { /* 未起 */ } await new Promise((r) => setTimeout(r, 200)) }

const logs = []
const errs = []
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => errs.push(e.message))
const reqs = []
page.on('request', (r) => reqs.push(r.url()))

try {
  await page.goto(BASE + '#/', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="skip-link"]')
  await page.waitForTimeout(900)
  await safe('首页不下载 PathPage chunk（路由级 lazy 生效）', () => {
    const hit = reqs.filter((u) => /PathPage-[^/]*\.js/.test(u))
    if (hit.length) throw new Error(hit.join(','))
    return '0 请求'
  })
  await safe('主导航有「学习路径」入口', async () => {
    const n = await page.locator('nav a[href="#/path"]').count()
    if (!n) throw new Error('找不到 /path 链接')
    return (await page.locator('nav a[href="#/path"]').first().innerText()).trim()
  })

  // ── 零进度基线 ──
  await page.evaluate((k) => localStorage.removeItem(k), PROGRESS_KEY)
  await page.evaluate((k) => localStorage.removeItem(k), PATH_KEY)
  await page.goto(BASE + '#/path', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="path-page"]', { timeout: 20000 })
  await page.waitForSelector('[data-role="path-level"]', { timeout: 20000 })
  await page.waitForTimeout(600)

  await safe(`关卡数 = 索引章节数（${chapters.length} 关：C ${cLevels.length} / 数据结构 ${dsLevels.length}）`, async () => {
    const total = await page.locator('[data-role="path-level"]').count()
    if (total !== chapters.length) throw new Error(`页面 ${total} 关 ≠ 索引 ${chapters.length} 章`)
    const c = await page.locator('[data-role="path-track"][data-track="c"] [data-role="path-level"]').count()
    const ds = await page.locator('[data-role="path-track"][data-track="ds"] [data-role="path-level"]').count()
    if (c !== cLevels.length || ds !== dsLevels.length) throw new Error(`C=${c}/${cLevels.length} DS=${ds}/${dsLevels.length}`)
    return `C ${c} · DS ${ds}`
  })
  await safe('零进度：每条轨道只有第 1 关进行中，其余全 locked', async () => {
    const got = await page.locator('[data-role="path-level"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-state')))
    const cur = got.filter((s) => s === 'current').length
    const cleared = got.filter((s) => s === 'cleared').length
    const locked = got.filter((s) => s === 'locked').length
    if (cur !== 2) throw new Error('current=' + cur)
    if (cleared !== 0) throw new Error('cleared=' + cleared)
    if (locked !== chapters.length - 2) throw new Error('locked=' + locked)
    return `current=${cur} locked=${locked}`
  })
  await safe('第 1 关默认展开，含卡片 / 推荐题 / 全部题目链接', async () => {
    const lv = page.locator('[data-role="path-level"]').first()
    const detail = lv.locator('[data-role="path-detail"]')
    if (!(await detail.count())) throw new Error('未自动展开')
    const cards = await detail.locator('[data-role="path-card-link"]').count()
    const probs = await detail.locator('[data-role="path-problem-link"]').count()
    const all = await detail.locator('[data-role="path-all-problems"]').getAttribute('href')
    if (cards < 1) throw new Error('卡片链接=' + cards)
    if (probs < 1) throw new Error('题目链接=' + probs)
    if (!all || !all.includes('chapter=')) throw new Error('全部题目 href=' + all)
    return `卡片 ${cards} · 推荐 ${probs} · ${decodeURIComponent(all).slice(0, 46)}`
  })
  await safe('locked 关卡展开后只有解锁提示，不放行任何链接', async () => {
    const locked = page.locator('[data-role="path-level"][data-state="locked"]').first()
    await locked.locator('[data-role="path-toggle"]').click()
    await page.waitForTimeout(300)
    const d = locked.locator('[data-role="path-detail"]')
    if (!(await d.locator('[data-role="path-locked-hint"]').count())) throw new Error('无解锁提示')
    const links = await d.locator('a').count()
    if (links !== 0) throw new Error('locked 关卡给了 ' + links + ' 个链接')
    await locked.locator('[data-role="path-toggle"]').click()
    return '提示已显示，链接 0'
  })
  await safe('进度条带完整 aria（role=progressbar + valuemin/now/max）', async () => {
    const pb = page.locator('[data-role="path-level"] [role="progressbar"]').first()
    if (!(await pb.count())) throw new Error('无 progressbar')
    const now = await pb.getAttribute('aria-valuenow')
    const max = await pb.getAttribute('aria-valuemax')
    const label = await pb.getAttribute('aria-label')
    if (now !== '0' || max !== String(firstCtarget) || !label) throw new Error(`now=${now} max=${max} label=${label}`)
    return `0/${max}，有 aria-label`
  })
  await safe('无障碍抽查：唯一 h1 + 所有按钮有可及名称 + 尺寸 ≥24px', async () => {
    const r = await page.evaluate(() => {
      const h1 = document.querySelectorAll('h1').length
      const bad = []
      for (const el of document.querySelectorAll('button, input, select, textarea, [role="switch"]')) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim()
        if (!name) bad.push(el.outerHTML.slice(0, 60))
        const b = el.getBoundingClientRect()
        if (b.width && (b.width < 24 || b.height < 24)) bad.push(`小 ${Math.round(b.width)}x${Math.round(b.height)} ${name.slice(0, 20)}`)
      }
      return { h1, bad: bad.slice(0, 5) }
    })
    if (r.h1 !== 1) throw new Error('h1=' + r.h1)
    if (r.bad.length) throw new Error(JSON.stringify(r.bad))
    return 'h1=1，交互元素全部具名且 ≥24px'
  })

  // ── 播种「C 第 1 关通关」→ 验证顺序解锁 ──
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [PROGRESS_KEY, seed(firstC.problems.slice(0, firstCtarget))])
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('[data-role="path-level"]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await safe(`播种 ${firstCtarget} 题通过 → 第 1 关 cleared、第 2 关 current`, async () => {
    const got = await page.locator('[data-role="path-track"][data-track="c"] [data-role="path-level"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-state')))
    if (got[0] !== 'cleared') throw new Error('第1关=' + got[0])
    if (got[1] !== 'current') throw new Error('第2关=' + got[1])
    if (got.slice(2).some((s) => s !== 'locked')) throw new Error('第3关起应全 locked：' + got.slice(2).join(','))
    const txt = (await page.locator('[data-role="path-level"]').first().locator('[data-role="path-progress"]').innerText()).replace(/\s+/g, ' ')
    return `${got[0]}→${got[1]}｜${txt}`
  })
  await safe('通关后摘要「已通关 1 / N」同步', async () => {
    const t = (await page.locator('[data-role="path-stat"]').first().innerText()).replace(/\s+/g, ' ')
    if (!t.includes(`1 / ${chapters.length}`)) throw new Error(t)
    return t
  })

  // ── 自由模式 ──
  await safe('自由模式开关：全部关卡解锁 + 写 localStorage + 刷新后保持', async () => {
    await page.locator('[data-role="path-free-mode"]').click()
    await page.waitForTimeout(400)
    const got = await page.locator('[data-role="path-level"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-state')))
    if (got.some((s) => s === 'locked')) throw new Error('仍有 locked：' + got.filter((s) => s === 'locked').length)
    const raw = await page.evaluate((k) => localStorage.getItem(k), PATH_KEY)
    if (!raw || JSON.parse(raw).freeMode !== true) throw new Error('localStorage=' + raw)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="path-level"]')
    await page.waitForTimeout(400)
    const again = await page.locator('[data-role="path-level"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-state')))
    if (again.some((s) => s === 'locked')) throw new Error('刷新后又 locked')
    const checked = await page.locator('[data-role="path-free-mode"]').getAttribute('aria-checked')
    if (checked !== 'true') throw new Error('aria-checked=' + checked)
    return `${chapters.length} 关全解锁，刷新后 aria-checked=true`
  })
  await safe('关掉自由模式恢复顺序解锁', async () => {
    await page.locator('[data-role="path-free-mode"]').click()
    await page.waitForTimeout(400)
    const got = await page.locator('[data-role="path-level"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-state')))
    if (got.filter((s) => s === 'locked').length !== chapters.length - 3) throw new Error('locked=' + got.filter((s) => s === 'locked').length)
    return 'locked 恢复'
  })

  // ── 窄屏 ──
  await safe('375px 窄屏无横向溢出，展开详情也不溢出', async () => {
    const p2 = await browser.newPage({ viewport: { width: 375, height: 780 } })
    const e2 = []
    p2.on('pageerror', (e) => e2.push(e.message))
    await p2.goto(BASE + '#/path', { waitUntil: 'load' })
    await p2.waitForSelector('[data-role="path-level"]')
    await p2.waitForTimeout(500)
    await p2.locator('[data-role="path-level"] [data-role="path-toggle"]').first().click()
    await p2.waitForTimeout(400)
    const w = await p2.evaluate(() => document.documentElement.scrollWidth)
    if (w > 380) throw new Error('scrollWidth=' + w)
    if (e2.length) throw new Error(e2.join(';'))
    await p2.close()
    return 'scrollWidth=' + w
  })

  await safe('控制台无 error/warning', () => {
    const bad = logs.filter((l) => l.startsWith('error') || l.startsWith('warning'))
    if (bad.length || errs.length) throw new Error(JSON.stringify([...errs, ...bad]).slice(0, 400))
    return 'clean'
  })
} finally {
  await browser.close()
  preview.kill()
}

const fail = checks.filter((c) => !c.ok)
console.log(`\n学习板块验收：${checks.length - fail.length}/${checks.length} PASS`)
if (perr.trim()) console.log('preview stderr: ' + perr.trim().slice(0, 300))
if (fail.length) { for (const f of fail) console.log('  FAIL ' + f.name + ' ｜ ' + f.detail); process.exit(1) }
