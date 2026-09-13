/**
 * 错误博物馆 UI 验收（任务 3-4）：npm run acceptance:bugs
 *
 * 与其它 acceptance-*-ui.mjs 同一口径：dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净。
 * 这座博物馆守住六个点：
 *   ① 语料纪律：展品代码里不得出现本站禁用项（gets / conio.h / getch / system("pause")），
 *      且 exhibits.json 的每一段代码在 observed.json 里都有 compiled=true 的真实证据
 *   ② 页面「上次实测」区块显示的 stdout 必须与 observed.json **逐字一致**（防止前端另编一套结果）
 *   ③ 「运行看后果」是真判分：点病症代码要拿到 runtime-error / exit=139，点正确写法要拿到 ok / exit=0
 *   ④ 后端不可用时如实说「未判定」，不伪造通过
 *   ⑤ 分类过滤 + 搜索 + 空态齐全；关联链接显示的是标题不是裸 id
 *   ⑥ 路由级 lazy：首页不下载 BugMuseumPage chunk；375px 窄屏无横向溢出
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4196
const BASE = `http://127.0.0.1:${PORT}/`

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}
async function safe(name, fn) {
  try { const d = await fn(); check(name, true, d ?? '') } catch (e) { check(name, false, String(e?.message ?? e).slice(0, 260)) }
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

/* ════ 语料纪律（node 侧直读，不靠浏览器） ════ */
const corpus = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'bugs', 'exhibits.json'), 'utf8'))
const observedPath = join(ROOT, 'public', 'data', 'bugs', 'observed.json')
const observed = existsSync(observedPath) ? JSON.parse(readFileSync(observedPath, 'utf8')) : null
const EX = corpus.exhibits

await safe(`语料：${EX.length} 件展品，每件都有病症 + 正确写法两段可运行代码`, () => {
  if (!(EX.length >= 10)) throw new Error('展品数=' + EX.length)
  for (const e of EX) {
    for (const v of ['buggy', 'safe']) {
      const code = e[v]?.code
      if (typeof code !== 'string' || !code.includes('int main(void)')) throw new Error(`${e.id}.${v} 代码不完整`)
      if (typeof e[v].stdin !== 'string') throw new Error(`${e.id}.${v} 缺 stdin 字段`)
    }
    for (const f of ['symptom', 'story', 'compilerSays', 'severityLabel', 'chapter']) if (!e[f]) throw new Error(`${e.id} 缺 ${f}`)
    if (!Array.isArray(e.takeaway) || e.takeaway.length < 3) throw new Error(`${e.id} takeaway=${e.takeaway?.length}`)
    if (!e.knowledgeIds?.length || !e.relatedProblems?.length) throw new Error(`${e.id} 关联为空`)
  }
  return `${EX.length} 件 · ${EX.length * 2} 段代码 · 分类 ${corpus.categories.length} 种`
})
await safe('禁用项零出现：gets / conio.h / getch / system("pause") / C++ 语法', () => {
  const banned = [/\bgets\s*\(/, /conio\.h/, /\bgetch\s*\(/, /system\s*\(\s*"pause"/, /\bcin\b/, /\bcout\b/, /\bnew\s+[A-Za-z_]/]
  for (const e of EX) for (const v of ['buggy', 'safe']) for (const re of banned) {
    if (re.test(e[v].code)) throw new Error(`${e.id}.${v} 命中 ${re}`)
  }
  return '20 段代码全部干净（讲 gets 只用文字，不用代码）'
})
await safe('实测证据齐全：20 段代码全部 compiled=true，无「未判定」', () => {
  if (!observed) throw new Error('observed.json 不存在，请先 npm run probe:bugs')
  const keys = Object.keys(observed.runs ?? {})
  if (keys.length !== EX.length * 2) throw new Error(`证据 ${keys.length} 条 ≠ ${EX.length * 2} 段`)
  for (const [k, r] of Object.entries(observed.runs)) {
    if (r.probed !== true) throw new Error(`${k} 未判定：${r.error ?? r.staleReason ?? ''}`)
    if (r.compiled !== true) throw new Error(`${k} 编译不过`)
    if (typeof r.stdout !== 'string') throw new Error(`${k} 无 stdout 字段`)
  }
  const crash = keys.filter((k) => observed.runs[k].errorClass === 'runtime-error')
  const silent = keys.filter((k) => observed.runs[k].errorClass === 'ok' && observed.runs[k].exitCode === 0)
  return `${keys.length} 段：崩溃 ${crash.length} · 正常 ${silent.length} · 实测于 ${observed.probedAt.slice(0, 10)}`
})

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
  await safe('首页不下载 BugMuseumPage chunk（路由级 lazy 生效）', () => {
    const hit = reqs.filter((u) => /BugMuseumPage-[^/]*\.js/.test(u))
    if (hit.length) throw new Error(hit.join(','))
    const data = reqs.filter((u) => /data\/bugs\//.test(u))
    if (data.length) throw new Error('首页请求了展品语料：' + data.join(','))
    return '0 请求（chunk 与语料都没下载）'
  })
  await safe('主导航有「错误博物馆」入口', async () => {
    const loc = page.locator('nav a[href="#/bugs"]')
    if (!(await loc.count())) throw new Error('找不到 /bugs 链接')
    return (await loc.first().innerText()).trim()
  })

  await page.goto(BASE + '#/bugs', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="bugs-exhibit"]', { timeout: 20000 })
  await page.waitForTimeout(700)

  await safe(`页面渲染 ${EX.length} 件展品 + 诚实声明 + 分类 chips`, async () => {
    const n = await page.locator('[data-role="bugs-exhibit"]').count()
    if (n !== EX.length) throw new Error(`页面 ${n} ≠ 语料 ${EX.length}`)
    if (!(await page.locator('[data-role="bugs-honesty"]').count())) throw new Error('缺诚实声明')
    const chips = await page.locator('[data-role="bugs-filter"]').count()
    if (chips !== corpus.categories.length + 1) throw new Error('chips=' + chips)
    const cnt = (await page.locator('[data-role="bugs-count"]').innerText()).replace(/\s+/g, ' ')
    return `${n} 件 · ${chips} chips · ${cnt}`
  })
  await safe('每件展品折叠头都有 severity 标签，且与语料一致', async () => {
    const got = await page.locator('[data-role="bugs-exhibit"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-severity')))
    const want = EX.map((e) => e.severity)
    if (got.join(',') !== want.join(',')) throw new Error(`${got.join(',')} ≠ ${want.join(',')}`)
    const kinds = [...new Set(got)]
    return `${got.length} 件，severity 覆盖 ${kinds.join('/')}`
  })

  // ── 展开一件「崩溃型」展品，核对实测证据 ──
  const crashId = 'dangling-return'
  const crashEx = EX.find((e) => e.id === crashId)
  await page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"] [data-role="bugs-toggle"]`).click()
  await page.waitForSelector(`[data-role="bugs-exhibit"][data-id="${crashId}"] [data-role="bugs-detail"]`)
  await page.waitForTimeout(400)
  await safe('展开后有病症/正确两段代码 + 两个运行按钮 + 上次实测区块', async () => {
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    const codes = await card.locator('[data-role^="bugs-code-"]').count()
    const runs = await card.locator('[data-role="bugs-run"]').count()
    const obs = await card.locator('[data-role="bugs-observed"]').count()
    if (codes !== 2) throw new Error('代码块=' + codes)
    if (runs !== 2) throw new Error('运行按钮=' + runs)
    if (obs !== 2) throw new Error('实测区块=' + obs)
    const links = await card.locator('[data-role="bugs-problem-link"]').count()
    if (links < 1) throw new Error('配套练习链接=' + links)
    return `2 段代码 · 2 个运行按钮 · 2 份实测证据 · ${links} 道配套练习`
  })
  await safe('「上次实测」显示的 stdout / 退出码与 observed.json 逐字一致（不另编结果）', async () => {
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    for (const v of ['buggy', 'safe']) {
      const want = observed.runs[`${crashId}:${v}`]
      await card.locator(`[data-role="bugs-observed"][data-variant="${v}"] summary`).click()
      await page.waitForTimeout(150)
      const cls = (await card.locator(`[data-role="bugs-observed"][data-variant="${v}"] [data-role="bugs-observed-class"]`).innerText()).replace(/\s+/g, ' ')
      if (!cls.includes(want.errorClass)) throw new Error(`${v} errorClass：页面「${cls}」不含「${want.errorClass}」`)
      if (!cls.includes(`exit=${want.exitCode}`)) throw new Error(`${v} exitCode：${cls}`)
      const wantOut = (want.stdout ?? '').trim()
      if (wantOut) {
        const got = (await card.locator(`[data-role="bugs-observed"][data-variant="${v}"] [data-role="bugs-observed-stdout"]`).innerText()).trim()
        if (got !== wantOut) throw new Error(`${v} stdout 不一致：${JSON.stringify(got.slice(0, 60))} ≠ ${JSON.stringify(wantOut.slice(0, 60))}`)
      }
    }
    const b = observed.runs[`${crashId}:buggy`]
    return `buggy=${b.errorClass}/exit=${b.exitCode}（stdout 空，如实说明缓冲未 flush）· safe=ok/exit=0`
  })
  await safe('病症代码的实测诊断里能看到 -Wreturn-local-addr（编译器真拦住了这一件）', async () => {
    const want = observed.runs[`${crashId}:buggy`].diagnostics ?? []
    if (!want.some((d) => /return-local-addr|address of local/.test(d.message))) throw new Error(JSON.stringify(want).slice(0, 200))
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    const shown = (await card.locator('[data-role="bugs-observed"][data-variant="buggy"] [data-role="bugs-observed-diags"]').innerText()).replace(/\s+/g, ' ')
    if (!/local variable/.test(shown)) throw new Error('页面未展示诊断：' + shown.slice(0, 120))
    return shown.slice(0, 90)
  })

  // ── 真机运行：这一段会打真请求（Godbolt 串行） ──
  await safe('真机运行病症代码 → runtime-error / exit=139（诚实报崩溃，不伪造通过）', async () => {
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    await card.locator('[data-role="bugs-run"][data-variant="buggy"]').click()
    await card.locator('[data-role="bugs-run-result"][data-variant="buggy"] [data-role="bugs-run-class"]').waitFor({ timeout: 40000 })
    const cls = (await card.locator('[data-role="bugs-run-result"][data-variant="buggy"] [data-role="bugs-run-class"]').innerText()).replace(/\s+/g, ' ')
    if (!/runtime-error/.test(cls)) throw new Error(cls)
    if (!/exit=139/.test(cls)) throw new Error('退出码=' + cls)
    const empty = await card.locator('[data-role="bugs-run-result"][data-variant="buggy"] [data-role="bugs-run-empty"]').count()
    if (!empty) throw new Error('stdout 为空却没如实说明')
    return cls.slice(0, 80)
  })
  await safe('真机运行正确写法 → ok / exit=0，且有真实 stdout', async () => {
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    await card.locator('[data-role="bugs-run"][data-variant="safe"]').click()
    await card.locator('[data-role="bugs-run-result"][data-variant="safe"] [data-role="bugs-run-class"]').waitFor({ timeout: 40000 })
    const cls = (await card.locator('[data-role="bugs-run-result"][data-variant="safe"] [data-role="bugs-run-class"]').innerText()).replace(/\s+/g, ' ')
    if (!/\bok\b/.test(cls) || !/exit=0/.test(cls)) throw new Error(cls)
    const out = (await card.locator('[data-role="bugs-run-result"][data-variant="safe"] [data-role="bugs-run-stdout"]').innerText()).trim()
    const want = (observed.runs[`${crashId}:safe`].stdout ?? '').trim()
    if (out !== want) throw new Error(`stdout 与实测存档不一致：${JSON.stringify(out.slice(0, 50))}`)
    return cls.slice(0, 46) + '｜' + out.split('\n')[0].slice(0, 40)
  })
  await safe('同一段代码重复运行命中缓存，不再打后端（串行闸门生效）', async () => {
    const before = reqs.filter((u) => u.includes('godbolt.org')).length
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    await card.locator('[data-role="bugs-run"][data-variant="safe"]').click()
    await page.waitForTimeout(1200)
    const after = reqs.filter((u) => u.includes('godbolt.org')).length
    if (after !== before) throw new Error(`又打了 ${after - before} 次请求`)
    const cls = (await card.locator('[data-role="bugs-run-result"][data-variant="safe"] [data-role="bugs-run-class"]').innerText()).replace(/\s+/g, ' ')
    if (!/缓存命中/.test(cls)) throw new Error('没标注缓存命中：' + cls)
    return `godbolt 请求数 ${before} → ${after}`
  })

  // ── 过滤 / 搜索 / 空态 ──
  await safe('分类过滤：点「内存」只剩内存类展品，计数同步', async () => {
    const wantN = EX.filter((e) => e.category === 'memory').length
    await page.locator('[data-role="bugs-filter"][data-cat="memory"]').click()
    await page.waitForTimeout(400)
    const n = await page.locator('[data-role="bugs-exhibit"]').count()
    if (n !== wantN) throw new Error(`页面 ${n} ≠ 语料 ${wantN}`)
    const cats = await page.locator('[data-role="bugs-exhibit"]').evaluateAll((ns) => [...new Set(ns.map((x) => x.getAttribute('data-category')))])
    if (cats.length !== 1 || cats[0] !== 'memory') throw new Error('混入其它分类：' + cats.join(','))
    const cnt = (await page.locator('[data-role="bugs-count"]').innerText()).replace(/\s+/g, ' ')
    await page.locator('[data-role="bugs-filter"][data-cat="all"]').click()
    await page.waitForTimeout(300)
    return `${wantN} 件 · ${cnt}`
  })
  await safe('搜索「溢出」过滤生效，搜索乱码显示空态', async () => {
    await page.locator('[data-role="bugs-search"]').fill('溢出')
    await page.waitForTimeout(400)
    const n = await page.locator('[data-role="bugs-exhibit"]').count()
    if (!(n > 0 && n < EX.length)) throw new Error('命中=' + n)
    await page.locator('[data-role="bugs-search"]').fill('zzzqq')
    await page.waitForTimeout(400)
    if (!(await page.locator('[data-role="bugs-empty"]').count())) throw new Error('无空态')
    if (await page.locator('[data-role="bugs-exhibit"]').count()) throw new Error('仍有展品')
    await page.locator('[data-role="bugs-search"]').fill('')
    await page.waitForTimeout(300)
    return `「溢出」命中 ${n} 件，乱码 → 空态`
  })
  await safe('关联链接显示标题而非裸 id，href 指向站内路由', async () => {
    const card = page.locator(`[data-role="bugs-exhibit"][data-id="${crashId}"]`)
    if (!(await card.locator('[data-role="bugs-detail"]').count())) {
      await card.locator('[data-role="bugs-toggle"]').click()
      await page.waitForSelector(`[data-role="bugs-exhibit"][data-id="${crashId}"] [data-role="bugs-detail"]`)
    }
    await page.waitForTimeout(300)
    const info = await card.locator('[data-role="bugs-problem-link"]').first().evaluate((a) => ({ t: a.textContent ?? '', h: a.getAttribute('href') ?? '' }))
    if (/^[a-z]+-ch\d+/.test(info.t.trim())) throw new Error('显示的是裸 id：' + info.t)
    if (!info.h.startsWith('#/problems/p/')) throw new Error('href=' + info.h)
    const k = await card.locator('[data-role="bugs-knowledge-link"]').first().evaluate((a) => ({ t: a.textContent ?? '', h: a.getAttribute('href') ?? '' }))
    if (!k.h.startsWith('#/knowledge/')) throw new Error('卡片 href=' + k.h)
    return `${info.t.trim().slice(0, 22)} → ${info.h}`
  })
  await safe('无障碍抽查：唯一 h1 + 折叠头是可及按钮 + 交互元素 ≥24px', async () => {
    const r = await page.evaluate(() => {
      const h1 = document.querySelectorAll('h1').length
      const bad = []
      const nm = (el) => {
        const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
        if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && (l.innerText || '').trim()) return l.innerText.trim() }
        const wrap = el.closest('label'); if (wrap && (wrap.innerText || '').trim()) return wrap.innerText.trim()
        const tt = el.getAttribute('title'); if (tt && tt.trim()) return tt.trim()
        return (el.textContent || '').trim()
      }
      for (const el of document.querySelectorAll('button, input, select, textarea, [role="switch"]')) {
        const name = nm(el)
        if (!name) bad.push((el.outerHTML || '').slice(0, 60))
        const b = el.getBoundingClientRect()
        if (b.width && (b.width < 24 || b.height < 24)) bad.push(`小 ${Math.round(b.width)}x${Math.round(b.height)} ${name.slice(0, 18)}`)
      }
      const toggles = document.querySelectorAll('[data-role="bugs-toggle"]')
      const noAria = [...toggles].filter((t) => t.getAttribute('aria-expanded') === null).length
      return { h1, bad: bad.slice(0, 5), toggles: toggles.length, noAria }
    })
    if (r.h1 !== 1) throw new Error('h1=' + r.h1)
    if (r.noAria) throw new Error('折叠头缺 aria-expanded=' + r.noAria)
    if (r.bad.length) throw new Error(JSON.stringify(r.bad))
    return `h1=1，${r.toggles} 个折叠头都有 aria-expanded，交互元素全部具名且 ≥24px`
  })
  await safe('375px 窄屏无横向溢出（双栏代码自动堆叠）', async () => {
    const p2 = await browser.newPage({ viewport: { width: 375, height: 780 } })
    const e2 = []
    p2.on('pageerror', (e) => e2.push(e.message))
    await p2.goto(BASE + '#/bugs', { waitUntil: 'load' })
    await p2.waitForSelector('[data-role="bugs-exhibit"]')
    await p2.waitForTimeout(400)
    await p2.locator('[data-role="bugs-toggle"]').first().click()
    await p2.waitForTimeout(500)
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
console.log(`\n错误博物馆验收：${checks.length - fail.length}/${checks.length} PASS`)
if (perr.trim()) console.log('preview stderr: ' + perr.trim().slice(0, 300))
if (fail.length) { for (const f of fail) console.log('  FAIL ' + f.name + ' ｜ ' + f.detail); process.exit(1) }
