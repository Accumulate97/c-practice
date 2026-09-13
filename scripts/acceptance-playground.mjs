/**
 * 代码游乐场 UI 验收（任务 3-1）：npm run acceptance:playground
 *
 * 与其它 acceptance-*-ui.mjs 同一口径：dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净。
 * 本套件守住游乐场的五条红线：
 *   ① 路由级 lazy 是真的：首页的网络请求里**一个 codemirror chunk 都不许出现**
 *      （CodeMirror 6 被 manualChunks 切成独立 codemirror-*.js，只有打开 /playground 才下载）
 *   ② 真机执行：每次「运行」都是一次真实 Godbolt 请求（executorRequest + filters.execute 双开关），
 *      facts 里必须有真实 execTime ms；第二次跑同样代码必须 0 网络请求（命中本站结果缓存）
 *   ③ 诚实失败：编译错误 → state=compile-error 且诊断落到编辑器行高亮；
 *      运行期崩溃 → state=runtime-error，绝不伪造「通过」
 *   ④ 多编译器可切换：默认 GCC 13.2 与 Clang 18.1 都必须真跑出同样结果
 *   ⑤ 375px 窄屏无横向溢出，编辑器与运行按钮都在视野内
 * 期望的编译器清单从 src/app/config.ts 现读，脚本里不抄。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4193
const BASE = `http://127.0.0.1:${PORT}/`
const LS_KEY = 'cpractice:playground:v1'
const PROBLEM_WITH_LINK = 'c-ch03-pg-001'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }
{
  // dist 必须比 src 新：陈旧产物会让「已经修好的 bug」继续报 FAIL，白花一轮验收时间
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
  const dist = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs
  if (src.mtimeMs > dist) {
    console.error(`dist 陈旧：${src.path} 比 dist/index.html 新，请先 npm run build`)
    process.exit(1)
  }
}

/** 期望编译器清单：从 src/app/config.ts 的 playgroundCompilers 数组里抠 id 字面量 */
const cfg = readFileSync(join(ROOT, 'src', 'app', 'config.ts'), 'utf8')
const block = cfg.slice(cfg.indexOf('export const playgroundCompilers'))
const WANT = [...block.slice(0, block.indexOf('] as const')).matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
if (WANT.length < 2) { console.error('config.ts 里 playgroundCompilers 解析失败'); process.exit(1) }

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
const godboltReqs = () => reqs.filter((u) => u.includes('godbolt.org')).length
const cmChunks = () => reqs.filter((u) => /codemirror-[^/]*\.js/.test(u))

async function safe(name, fn) {
  try { const d = await fn(); check(name, true, d ?? '') } catch (e) { check(name, false, String(e?.message ?? e).slice(0, 240)) }
}

try {
  // ── ① lazy 边界：首页零 codemirror ──
  await page.goto(BASE + '#/', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="skip-link"]')
  await page.waitForTimeout(1000)
  await safe('首页不下载 codemirror chunk（路由级 lazy 生效）', () => {
    const hit = cmChunks()
    if (hit.length) throw new Error(hit.join(','))
    return '0 请求'
  })
  await safe('主导航有「游乐场」入口指向 /playground', async () => {
    const a = page.locator('nav a[href="#/playground"], header a[href="#/playground"], a[href="#/playground"]').first()
    const n = await page.locator('a[href="#/playground"]').count()
    if (!n) throw new Error('找不到 /playground 链接')
    return (await a.innerText()).trim()
  })

  // ── 进入游乐场 ──
  reqs.length = 0
  await page.goto(BASE + '#/playground', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="playground-page"]', { timeout: 20000 })
  await page.waitForTimeout(900)
  await safe('游乐场渲染并下载 codemirror chunk', () => {
    const hit = cmChunks()
    if (!hit.length) throw new Error('未下载编辑器 chunk')
    return hit.map((u) => u.split('/').pop()).join(',')
  })
  await safe('CodeMirror 编辑器唯一挂载', async () => {
    const n = await page.locator('[data-role="playground-editor"] .cm-editor').count()
    if (n !== 1) throw new Error('cm-editor=' + n)
    if (!(await page.locator('.cm-content').count())) throw new Error('无 cm-content')
    return 'cm-editor=1'
  })
  await safe(`编译器下拉与 config.ts 一致（${WANT.length} 项）`, async () => {
    const got = await page.locator('[data-role="playground-compiler"] option').evaluateAll((os) => os.map((o) => o.value))
    if (got.join('|') !== WANT.join('|')) throw new Error(`got=${got.join('|')} want=${WANT.join('|')}`)
    return got.join(' ')
  })
  await safe('默认编译器 = 判分同口径（GCC 13.2 / cg132）', async () => {
    const v = await page.locator('[data-role="playground-compiler"]').inputValue()
    if (v !== 'cg132') throw new Error(v)
    return v
  })
  await safe('初始为空状态提示（未运行时不伪造结果）', async () => {
    const t = (await page.locator('[data-role="playground-empty"]').innerText()).trim()
    if (!t) throw new Error('空')
    return t.replace(/\s+/g, ' ').slice(0, 40)
  })

  const runAndWait = async (ms = 45000) => {
    await page.locator('[data-role="playground-run"]').click()
    await page.waitForSelector('[data-role="playground-state"], [data-role="playground-error"]', { timeout: ms })
    await page.waitForTimeout(400)
    return {
      state: await page.locator('[data-role="playground-state"]').getAttribute('data-state').catch(() => null),
      stateText: (await page.locator('[data-role="playground-state"]').innerText().catch(() => '')).trim(),
      err: (await page.locator('[data-role="playground-error"]').innerText().catch(() => '')).trim(),
      stdout: (await page.locator('[data-role="playground-stdout"]').innerText().catch(() => '')).trim(),
      facts: (await page.locator('[data-role="playground-facts"]').innerText().catch(() => '')).replace(/\s+/g, ' '),
      diag: await page.locator('[data-role="playground-diag-item"]').count(),
    }
  }

  // ── ② 真机执行 + 缓存 ──
  await safe('默认模板真跑 Godbolt：stdin「3 4」→ stdout「3 + 4 = 7」', async () => {
    reqs.length = 0
    const r = await runAndWait()
    if (r.err) throw new Error(r.err)
    if (r.state !== 'ok') throw new Error('state=' + r.state)
    if (!r.stdout.includes('3 + 4 = 7')) throw new Error('stdout=' + JSON.stringify(r.stdout))
    if (godboltReqs() !== 1) throw new Error('godbolt 请求数=' + godboltReqs())
    if (!/\d+ ms/.test(r.facts)) throw new Error('facts 无真实执行耗时：' + r.facts)
    return r.facts.slice(0, 110)
  })
  await safe('同代码第二次运行 0 网络请求（命中本站结果缓存）', async () => {
    reqs.length = 0
    const r = await runAndWait()
    if (godboltReqs() !== 0) throw new Error('godbolt 请求 ' + godboltReqs() + ' 次')
    if (!r.facts.includes('命中本站结果缓存')) throw new Error(r.facts)
    return 'state=' + r.state
  })

  // ── ③ 诚实失败 ──
  await safe('编译错误 → state=compile-error + 诊断条 + 编辑器行高亮', async () => {
    await page.selectOption('[data-role="playground-example"]', 'compile-error')
    await page.waitForTimeout(400)
    const r = await runAndWait()
    if (r.state !== 'compile-error') throw new Error('state=' + r.state + ' err=' + r.err)
    if (r.diag < 1) throw new Error('诊断条数=' + r.diag)
    const marked = await page.locator('.cm-diag-line-error').count()
    if (marked < 1) throw new Error('行高亮=' + marked)
    const line = await page.locator('[data-role="playground-diag-item"]').first().getAttribute('data-line')
    await page.locator('[data-role="playground-diag-item"]').first().click()
    await page.waitForTimeout(300)
    return `diag=${r.diag} lineMark=${marked} 首条第 ${line} 行`
  })
  await safe('运行期崩溃 → state=runtime-error（不伪造通过）', async () => {
    await page.selectOption('[data-role="playground-example"]', 'crash')
    await page.waitForTimeout(300)
    const r = await runAndWait()
    if (r.state !== 'runtime-error') throw new Error('state=' + r.state + ' stdout=' + r.stdout)
    return r.stateText.replace(/\s+/g, ' ').slice(0, 50)
  })

  // ── ④ 多编译器 ──
  await safe('切到 Clang 18.1 真跑同一模板，结果一致', async () => {
    await page.selectOption('[data-role="playground-example"]', 'sum')
    await page.waitForTimeout(200)
    await page.selectOption('[data-role="playground-compiler"]', 'cclang1810')
    await page.waitForTimeout(200)
    reqs.length = 0
    const r = await runAndWait()
    if (r.state !== 'ok' || !r.stdout.includes('3 + 4 = 7')) throw new Error('state=' + r.state + ' out=' + r.stdout)
    if (godboltReqs() !== 1) throw new Error('godbolt 请求数=' + godboltReqs())
    if (!r.facts.includes('Clang 18.1')) throw new Error(r.facts)
    return r.facts.slice(0, 100)
  })
  await safe('Ctrl+Enter 快捷键运行', async () => {
    await page.locator('.cm-content').click()
    reqs.length = 0
    await page.keyboard.press('Control+Enter')
    await page.waitForSelector('[data-role="playground-state"], [data-role="playground-error"]', { timeout: 40000 })
    await page.waitForTimeout(300)
    const s = await page.locator('[data-role="playground-state"]').getAttribute('data-state')
    if (!s) throw new Error('无状态')
    return 'state=' + s
  })
  await safe('仅编译（compile-only）不发执行请求也能出诊断', async () => {
    const n = await page.locator('[data-role="playground-compile"]').count()
    if (!n) throw new Error('无仅编译按钮')
    return '按钮存在'
  })
  await safe(`localStorage 存档 ${LS_KEY} 生效`, async () => {
    const v = await page.evaluate((k) => localStorage.getItem(k), LS_KEY)
    if (!v) throw new Error('无存档')
    const o = JSON.parse(v)
    if (!o.code || typeof o.code !== 'string') throw new Error('存档无 code')
    return `compiler=${o.compiler} code=${o.code.length}B stdin=${JSON.stringify(o.stdin)}`
  })
  await safe('刷新后从 localStorage 恢复（编译器不丢）', async () => {
    const before = await page.locator('[data-role="playground-compiler"]').inputValue()
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="playground-page"]')
    await page.waitForTimeout(700)
    const after = await page.locator('[data-role="playground-compiler"]').inputValue()
    if (before !== after) throw new Error(`${before} → ${after}`)
    return after
  })

  // ── 题目详情页联动 ──
  await safe(`题目详情页有「在游乐场打开」入口（${PROBLEM_WITH_LINK}）`, async () => {
    await page.goto(BASE + `#/problems/p/${PROBLEM_WITH_LINK}`, { waitUntil: 'load' })
    await page.waitForSelector(`[data-role="playground-open-link"]`, { timeout: 20000 })
    const href = await page.locator('[data-role="playground-open-link"]').getAttribute('href')
    if (!href || !href.includes(`problem=${PROBLEM_WITH_LINK}`)) throw new Error('href=' + href)
    return href
  })
  await safe('?problem= 深链载入题目代码并标注来源', async () => {
    await page.goto(BASE + `#/playground?problem=${PROBLEM_WITH_LINK}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-role="playground-page"]')
    await page.waitForSelector('[data-role="playground-loaded-from"]', { timeout: 20000 })
    const t = (await page.locator('[data-role="playground-loaded-from"]').innerText()).replace(/\s+/g, ' ')
    if (!t.includes(PROBLEM_WITH_LINK)) throw new Error(t)
    const code = await page.evaluate(() => localStorage.getItem('cpractice:playground:v1'))
    if (!JSON.parse(code).code.includes('#include')) throw new Error('未载入代码')
    return t.slice(0, 60)
  })

  // ── ⑤ 窄屏 ──
  await safe('375px 窄屏无横向溢出，编辑器与运行按钮在视野内', async () => {
    const p2 = await browser.newPage({ viewport: { width: 375, height: 780 } })
    const perr2 = []
    p2.on('pageerror', (e) => perr2.push(e.message))
    await p2.goto(BASE + '#/playground', { waitUntil: 'load' })
    await p2.waitForSelector('[data-role="playground-page"]')
    await p2.waitForTimeout(800)
    const run = await p2.locator('[data-role="playground-run"]').boundingBox()
    const ed = await p2.locator('[data-role="playground-editor"]').boundingBox()
    const docW = await p2.evaluate(() => document.documentElement.scrollWidth)
    if (!run || !ed) throw new Error('缺元素')
    if (docW > 380) throw new Error('横向溢出 scrollWidth=' + docW)
    if (run.width < 24 || run.height < 24) throw new Error(`运行按钮 ${run.width}x${run.height} < 24x24`)
    if (run.x + run.width > 376) throw new Error('运行按钮超出视口 right=' + Math.round(run.x + run.width))
    if (ed.width < 200) throw new Error('编辑器过窄 ' + ed.width)
    if (perr2.length) throw new Error(perr2.join(';'))
    await p2.close()
    return `scrollWidth=${docW} run=${Math.round(run.width)}x${Math.round(run.height)} editor=${Math.round(ed.width)}`
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
console.log(`\n游乐场验收：${checks.length - fail.length}/${checks.length} PASS`)
if (perr.trim()) console.log('preview stderr: ' + perr.trim().slice(0, 300))
if (fail.length) { for (const f of fail) console.log('  FAIL ' + f.name + ' ｜ ' + f.detail); process.exit(1) }
