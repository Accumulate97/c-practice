/**
 * 首访引导 + 移动端适配 + 路由加载条验收（任务 4）：npm run acceptance:onboard
 *
 * 与其它 acceptance-*-ui.mjs 同一口径：dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净。
 * 纯前端交互，不打 Godbolt、不联网，全链路可离线复现。守住十四个点：
 *   ① 全新访客进首页会浮出引导，且是**可访问的** dialog（title/desc 齐全、一句话讲清「学→懂→练」）
 *   ② 三个入口的 href 分别落到 学习路径 / 每日一题 / 题库
 *   ③ 点入口 → 跳走 + 关掉 + 写入「已看过」；再回首页不弹（不能每次都拦人）
 *   ④ Escape 也能关（键盘用户的关闭路径必须存在）
 *   ⑤ 已经有做题记录的老用户不弹（引导只给首访）
 *   ⑥ ?noboot=1 静默：给验收脚本与深链留的确定性开关必须真的生效
 *   ⑦ 页脚「重看新手引导」能把有进度的老用户也再弹一次（关掉的东西必须能找回来）
 *   ⑧ 触屏设备编辑器字号抬到 16px（iOS 聚焦 <16px 会强制整页放大），桌面保持 13px
 *   ⑨ 触屏表单控件同样 16px；375px 下引导展开态无横向溢出
 *   ⑩ 路由切换（懒 chunk 被人为拖慢）时 nav-progress 进 busy，且带 role=status 文案
 *   ⑪ 3D 列表页零 three 体积；指针 hover / 键盘 focus 卡片才意图预取（不是空闲全量预取）
 *   ⑫ 窄屏与低配判定命中时**不做**意图预取；低配进 3D 演示页自动降级 2D、如实说明理由并留出口
 *   ⑬ 全流程控制台 0 error 0 warning
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4199
const BASE = `http://127.0.0.1:${PORT}/`
const ONBOARDED_KEY = 'cpractice:onboarded:v1'
const PROGRESS_KEY = 'cpractice:progress:v1'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}
async function safe(name, fn) {
  try { const d = await fn(); check(name, true, d ?? '') } catch (e) { check(name, false, String(e?.message ?? e).slice(0, 300)) }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg) }

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

const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT })
let perr = ''
preview.stderr.on('data', (d) => { perr += d })
for (let i = 0; i < 150; i++) { try { const r = await fetch(BASE); if (r.ok) break } catch { /* 未起 */ } await new Promise((r) => setTimeout(r, 200)) }

const logs = []
const errs = []
const browser = await chromium.launch({ channel: 'chrome', headless: true })

/** 每个用例一个全新上下文：引导的触发条件依赖「干净的 localStorage」，共享上下文会互相污染 */
async function newPage(opts = {}) {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
  page.on('pageerror', (e) => errs.push(e.message))
  return { ctx, page }
}
/** 播种一条「已经做过题」的进度（形状与 zustand persist 信封一致，见 acceptance-search.mjs 同款） */
async function seedProgress(page, ids = ['A']) {
  await page.evaluate(([k, list]) => {
    const now = Date.now()
    const rec = {
      result: 'attempted', attempts: 1, everPassed: false, firstPassedAt: null, firstAttemptAt: now,
      lastAt: now, wrongCount: 1, lastWrongAt: now, wrongDismissedAt: null, lastAnswer: null,
      lastAnswerKind: null, lastAnswerTruncated: false, starred: false, note: '', selfAssessed: false,
    }
    const records = {}
    for (const id of list) records[id] = rec
    localStorage.setItem(k, JSON.stringify({ version: 1, state: { records } }))
  }, [PROGRESS_KEY, ids])
}
const shown = (page) => page.locator('[data-role="onboarding"]').count()
const hashOf = (page) => page.evaluate(() => window.location.hash)

try {
  /* ── ① 首访浮出 + 可访问性 ── */
  await safe('全新访客进首页会浮出引导，是 dialog 且讲清「学→懂→练」', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="onboarding"]', { timeout: 8000 })
    const ob = page.locator('[data-role="onboarding"]')
    assert(await ob.getAttribute('role') === 'dialog', 'role 不是 dialog')
    assert(await ob.getAttribute('aria-labelledby') === 'onboarding-title', 'aria-labelledby 不对')
    assert(await ob.getAttribute('aria-describedby') === 'onboarding-desc', 'aria-describedby 不对')
    assert(await page.locator('#onboarding-title').count() === 1, '缺标题元素')
    assert(await page.locator('#onboarding-desc').count() === 1, '缺描述元素')
    const txt = (await ob.innerText()).replace(/\s+/g, ' ')
    for (const w of ['学', '懂', '练', '不上传']) assert(txt.includes(w), '一句话说明缺「' + w + '」')
    assert(await page.locator('[data-role="onboarding-close"]').count() === 1, '缺关闭按钮')
    await ctx.close()
    return 'dialog + 三步走 + 隐私说明'
  })

  /* ── ② 三个入口 ── */
  await safe('三个入口齐全：学习路径 / 每日一题 / 随便逛逛，href 正确', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="onboarding"]', { timeout: 8000 })
    const want = [
      ['onboarding-entry:/path', '/path'],
      ['onboarding-entry:/problems?pick=daily', '/problems?pick=daily'],
      ['onboarding-entry:/problems', '/problems'],
    ]
    for (const [role, path] of want) {
      const loc = page.locator(`[data-role="${role}"]`)
      assert(await loc.count() === 1, role + ' 数量 ' + await loc.count())
      const href = await loc.getAttribute('href')
      assert(typeof href === 'string' && href.replace(/^#/, '').startsWith(path), role + ' href=' + href)
      assert(await loc.evaluate((n) => n.tagName === 'A'), role + ' 不是链接（键盘到不了）')
    }
    assert(await page.locator('[data-role^="onboarding-entry:"]').count() === 3, '入口不是恰好 3 个')
    /* 点第一个真的能跳，且跳完引导自动关掉 */
    await page.locator('[data-role="onboarding-entry:/path"]').click()
    await page.waitForTimeout(600)
    assert((await hashOf(page)).startsWith('#/path'), '点了没跳到 ' + await hashOf(page))
    assert(await shown(page) === 0, '跳走后引导还挂着')
    await ctx.close()
    return '3 入口 + 点击跳转并自动关闭'
  })

  /* ── ③ 关掉之后不再弹 ── */
  await safe('点 ✕ 关闭 → 写入「已看过」，再回首页不弹', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="onboarding"]', { timeout: 8000 })
    await page.locator('[data-role="onboarding-close"]').click()
    await page.waitForTimeout(200)
    assert(await shown(page) === 0, '点了 ✕ 还在')
    const stored = await page.evaluate((k) => localStorage.getItem(k), ONBOARDED_KEY)
    assert(stored !== null && stored.length > 0, '没写入 ' + ONBOARDED_KEY)
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    assert(await shown(page) === 0, '第二次进首页又弹了（会烦死人）')
    await ctx.close()
    return ONBOARDED_KEY + '=' + stored
  })

  /* ── ④ Escape 关闭 ── */
  await safe('Escape 能关闭引导（键盘用户也有关闭路径）', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="onboarding"]', { timeout: 8000 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    assert(await shown(page) === 0, 'Escape 没关掉')
    await ctx.close()
    return 'Escape 生效'
  })

  /* ── ⑤ 老用户不弹 ── */
  await safe('已有做题记录的访客不弹（引导只给首访）', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/?noboot=1', { waitUntil: 'load' })
    await seedProgress(page, ['A', 'B'])
    // 播种只写了 localStorage，必须**整页重载**让 zustand persist 重新水合：
    // 只改 hash 不会重跑 store 初始化，records 仍是空的，这条用例的前提就不成立。
    await page.reload({ waitUntil: 'load' })
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="home-progress-tiles"]', { timeout: 20000 })
    const done = await page.locator('[data-role="home-stat-value"]').first().innerText()
    assert(done === '2', '进度没水合（首页「做过的题」=' + done + '），前提不成立')
    await page.waitForTimeout(1600)
    assert(await shown(page) === 0, '有进度还弹')
    await ctx.close()
    return '2 条记录已水合 → 静默'
  })

  /* ── ⑥ noboot 静默 ── */
  await safe('?noboot=1 对全新访客也静默（验收与深链的确定性开关）', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/?noboot=1', { waitUntil: 'load' })
    await page.waitForTimeout(1600)
    assert(await shown(page) === 0, 'noboot 被无视了')
    await ctx.close()
    return '静默'
  })

  /* ── ⑦ 重看引导 ── */
  await safe('页脚「重看新手引导」能把老用户也再弹一次', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await page.goto(BASE + '#/?noboot=1', { waitUntil: 'load' })
    await seedProgress(page, ['A'])
    await page.goto(BASE + '#/?noboot=1', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="onboarding-replay"]', { timeout: 8000 })
    await page.locator('[data-role="onboarding-replay"]').click()
    await page.waitForSelector('[data-role="onboarding"]', { timeout: 8000 })
    assert((await hashOf(page)).includes('boot=1'), 'URL 没带 boot=1：' + await hashOf(page))
    assert(await shown(page) === 1, '重看没弹')
    await ctx.close()
    return '?boot=1 强制弹出'
  })

  /* ── ⑧ 触屏编辑器字号 ── */
  const editorFs = async (opts, label) => {
    const { ctx, page } = await newPage(opts)
    await page.goto(BASE + '#/playground', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="playground-editor"] .cm-content', { timeout: 25000 })
    const v = await page.evaluate(() => {
      const host = document.querySelector('[data-role="playground-editor"]')
      const cs = getComputedStyle(document.querySelector('[data-role="playground-editor"] .cm-editor'))
      return { inline: host.style.getPropertyValue('--cp-code-fs').trim(), pad: host.style.getPropertyValue('--cp-code-pad-b').trim(), real: cs.fontSize }
    })
    await ctx.close()
    assert(v.inline !== '', label + '：宿主上没有 --cp-code-fs')
    return v
  }
  await safe('触屏设备编辑器 16px + 底部 6rem 留白；桌面保持 13px', async () => {
    const touch = await editorFs({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }, '触屏')
    assert(touch.inline === '16px', '触屏字号 ' + touch.inline)
    assert(touch.real === '16px', '实际渲染字号 ' + touch.real)
    assert(touch.pad === '6rem', '触屏底部留白 ' + touch.pad)
    const desk = await editorFs({ viewport: { width: 1440, height: 1000 } }, '桌面')
    assert(desk.inline === '13px', '桌面字号 ' + desk.inline)
    assert(desk.pad === '0px', '桌面底部留白 ' + desk.pad)
    return `触屏 ${touch.inline}/${touch.pad} ｜ 桌面 ${desk.inline}/${desk.pad}`
  })

  /* ── ⑨ 触屏表单字号 + 375px 溢出 ── */
  await safe('触屏表单控件 16px（iOS 聚焦缩放）', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(BASE + '#/problems', { waitUntil: 'load' })
    await page.waitForSelector('input,select', { timeout: 20000 })
    const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('input:not([type="checkbox"]),select,textarea')).slice(0, 8).map((n) => getComputedStyle(n).fontSize))
    assert(sizes.length > 0, '页面上没有表单控件可量')
    const bad = sizes.filter((s) => s !== '16px')
    assert(bad.length === 0, '非 16px 的控件：' + JSON.stringify(bad))
    await ctx.close()
    return sizes.length + ' 个控件全 16px'
  })
  await safe('375px 窄屏无横向溢出（引导展开态 / 题库 / 3D 馆 / 游乐场）', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 375, height: 780 } })
    const bad = []
    for (const h of ['#/', '#/problems', '#/viz3d', '#/path']) {
      await page.goto(BASE + h, { waitUntil: 'load' })
      await page.waitForTimeout(1200)
      const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      if (r.s > r.c + 1) bad.push(`${h} ${r.s}>${r.c}`)
    }
    /* 引导在首页展开时也不能把页面撑宽 */
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="onboarding"]', { timeout: 8000 })
    const r2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
    if (r2.s > r2.c + 1) bad.push(`引导展开 ${r2.s}>${r2.c}`)
    const box = await page.locator('[data-role="onboarding"]').boundingBox()
    if (!box || box.x < -0.5 || box.x + box.width > 375.5) bad.push('浮层越界 ' + JSON.stringify(box))
    await ctx.close()
    assert(bad.length === 0, bad.join(' | '))
    return '4 页 + 浮层均无溢出'
  })

  /* ── ⑩ 路由切换进度条 ── */
  await safe('懒 chunk 被拖慢时 nav-progress 进 busy，且有 role=status 文案', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    await ctx.route('**/assets/CheatsheetPage-*.js', async (route) => {
      await new Promise((r) => setTimeout(r, 1800))
      await route.continue()
    })
    await page.goto(BASE + '#/?noboot=1', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="nav-progress"]', { timeout: 8000 })
    assert(await page.locator('[data-role="nav-progress"]').getAttribute('data-busy') === '0', '空闲时不该 busy')
    await page.locator('nav[aria-label="工具与复习"] a', { hasText: '速查手册' }).click()
    await page.waitForTimeout(500)
    const busy = await page.locator('[data-role="nav-progress"]').getAttribute('data-busy')
    assert(busy === '1', '切换中 data-busy=' + busy)
    const sr = await page.locator('p[role="status"]:not([data-role])').allInnerTexts()
    assert(sr.some((t) => t.includes('正在载入')), '缺屏幕阅读器可感知的加载文案：' + JSON.stringify(sr))
    await page.waitForTimeout(2600)
    assert(await page.locator('[data-role="nav-progress"]').getAttribute('data-busy') === '0', '加载完没回到 idle')
    assert((await hashOf(page)).startsWith('#/cheatsheet'), '没跳到手册页')
    await ctx.close()
    return 'busy→idle 各归位，sr-only 文案在'
  })

  /* ── ⑪ 3D 列表页意图预取 ── */
  await safe('3D 列表页零 three 体积；hover / focus 卡片才意图预取', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 } })
    const hits = []
    page.on('request', (r) => { if (/\/assets\/(three|Stage3DScene)-[\w-]+\.js/.test(r.url())) hits.push(r.url().split('/').pop()) })
    await page.goto(BASE + '#/viz3d', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="viz3d-card"]', { timeout: 20000 })
    await page.waitForTimeout(1500)
    assert(hits.length === 0, '只是路过列表页就下了 three：' + hits.join(','))
    await page.locator('[data-role="viz3d-card"]').first().hover()
    await page.waitForTimeout(2000)
    assert(hits.length > 0, 'hover 之后没有预取 three/Stage3DScene chunk')
    await ctx.close()
    return 'hover 前 0 请求 → hover 后 ' + hits.length + ' 个（' + hits.slice(0, 2).join(',') + '）'
  })
  /**
   * hover 首张卡片后，有没有把 three / Stage3DScene chunk 拉下来。
   * 不用「查 DOM 上有没有 onpointerenter 属性」那种写法：React 的合成事件永远挂在根节点，
   * DOM 上根本不会留内联处理器，那样断言恒真、是个假测试。这里直接数网络请求 —— 唯一的事实。
   */
  async function hoverProbe(opts) {
    const { ctx, page } = await newPage(opts)
    const hits = []
    page.on('request', (r) => { if (/\/assets\/(three|Stage3DScene)-[\w-]+\.js/.test(r.url())) hits.push(r.url().split('/').pop()) })
    await page.goto(BASE + '#/viz3d', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="viz3d-card"]', { timeout: 20000 })
    await page.locator('[data-role="viz3d-card"]').first().hover()
    await page.waitForTimeout(1800)
    const n = hits.length
    await ctx.close()
    return n
  }
  await safe('窄屏不做意图预取（手机上没有 hover，别白下 885 KB）', async () => {
    const n = await hoverProbe({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    assert(n === 0, '窄屏 hover 后仍下了 ' + n + ' 个 chunk')
    return 'hover 后 0 请求'
  })
  await safe('低配判定命中（省动效）时不预热，3D 演示页自动降级 2D 并如实说明理由', async () => {
    const n = await hoverProbe({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    assert(n === 0, '低配判定命中却仍预热，下了 ' + n + ' 个 chunk')
    const { ctx, page } = await newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    await page.goto(BASE + '#/viz3d', { waitUntil: 'load' })
    await page.waitForSelector('[data-role="viz3d-card"]', { timeout: 20000 })
    const id = await page.locator('[data-role="viz3d-card"]').first().getAttribute('data-id')
    await page.goto(BASE + '#/viz3d/' + id, { waitUntil: 'load' })
    await page.waitForSelector('[data-role="viz3d-fallback"]', { timeout: 25000 })
    const txt = (await page.locator('[data-role="viz3d-fallback"]').innerText()).replace(/\s+/g, ' ')
    assert(txt.includes('减少动态效果'), '降级理由没讲清判定依据：' + txt.slice(0, 120))
    assert(txt.includes('2D'), '没讲清降级去向')
    /* 降级必须留出口：低配探测是启发式，不能替用户做死决定 */
    const out = await page.locator('[data-role="viz3d-fallback"] button').innerText()
    assert(out.includes('仍要看 3D'), '缺「仍要看 3D」出口')
    await ctx.close()
    return id + ' → 自动 2D（理由：减少动态效果），出口在'
  })

  /* ── ⑫ 控制台 ── */
  const bad = logs.filter((l) => l.startsWith('error') || l.startsWith('warning'))
  check('全流程控制台 0 error 0 warning 0 pageerror', bad.length === 0 && errs.length === 0,
    bad.length === 0 && errs.length === 0 ? `${logs.length} 条其它消息` : JSON.stringify({ bad: bad.slice(0, 5), errs: errs.slice(0, 3) }).slice(0, 600))
} catch (e) {
  check('引导 / 移动端验收流程未抛异常', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '))
} finally {
  await browser.close().catch(() => {})
  preview.kill()
}

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 首访引导 + 移动端 + 加载条验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
if (perr.trim()) console.log('  preview stderr: ' + perr.trim().slice(0, 300))
process.exitCode = failed.length > 0 ? 1 : 0
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref()