/**
 * 3D 可视化馆 UI 验收（任务 2）：npm run acceptance:viz3d
 *
 * 与其它 acceptance-*-ui.mjs 同一口径（dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净），
 * 本套件额外守住 3D 特有的四条红线：
 *   ① 路由级 lazy 是真的：首页与 3D 列表页的网络请求里**一个 three chunk 都不许出现**
 *      （three/fiber/drei 被 manualChunks 切成独立 three-*.js，只有打开演示页才下载）
 *   ② 性能预算：window.__VIZ3D_STATS__（Stage3D 里的 StatsProbe 上报）mesh 数 ≤ 200
 *   ③ WebGL 真出画面：canvas 有非零尺寸、没有掉进 viz3d-fallback 降级横幅
 *   ④ 窄屏降级：375px 视口必须自动落到 2D 平面视图（viz3d-flat），不许白屏
 * 期望值一律从 public/data/{viz,viz3d}/*.json 现读，脚本里不抄步骤数。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4188
const BASE = `http://127.0.0.1:${PORT}/`
const VIZ_DIR = join(ROOT, 'public', 'data', 'viz')
const VIZ3D_DIR = join(ROOT, 'public', 'data', 'viz3d')
/** 七类 3D 场景，必须与 src/modules/viz3d/types.ts 的 Scene3DKind 联合类型逐字一致 */
const KINDS = ['bars3d', 'chain3d', 'graph3d', 'tree3d', 'memory3d', 'callstack3d', 'matrixcube3d']
/** 任务 2 新增的 4 份 3D 专属语料，必须全部实机走一遍 */
const NEW3D = ['mem3d-wild-pointer', 'mem3d-leak', 'mem3d-recursion', 'mem3d-matrix-cube']
const MESH_BUDGET = 200

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)
function dirHashes(dir) {
  const out = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) out[f] = sha(join(dir, f))
  return out
}
/** 语料可能在 3D 专属目录，也可能与 2D 馆共用；两边都找 */
function findCorpus(id) {
  for (const dir of [VIZ3D_DIR, VIZ_DIR]) {
    const f = join(dir, `${id}.json`)
    if (existsSync(f)) return { shared: dir === VIZ_DIR, json: JSON.parse(readFileSync(f, 'utf8')) }
  }
  return null
}
const cmd = (line) => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { cwd: ROOT, encoding: 'utf8', windowsHide: true })

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
  const distAt = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs
  const src = walkNewest(join(ROOT, 'src'))
  if (src.mtimeMs > distAt) {
    console.error(`dist 比源码旧：${src.path} 在上次 build 之后被改过 → 先 npm run build 再验收`)
    process.exit(1)
  }
}
mkdirSync(join(ROOT, 'tmp'), { recursive: true })

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

let browser
const consoleMsgs = []
const pageErrors = []

/** 驱动条：定位步骤计数 / 播放 / 单步 / 重置 / 进度条 */
const SEL = {
  step: '[data-role="viz-step"]',
  play: '[data-role="viz-play"]',
  next: 'button[aria-label="下一步 ▶"]',
  reset: 'button[aria-label="⏮ 重置"]',
  seek: 'input[aria-label="进度"]',
}
const stepNums = async (page) => {
  const t = (await page.locator(SEL.step).first().innerText()).trim()
  const m = /步骤\s*(\d+)\s*\/\s*(\d+)/.exec(t)
  return m ? { cur: Number(m[1]), total: Number(m[2]), raw: t } : { cur: -1, total: -1, raw: t }
}
/** 拖进度条到第 i 步（i 从 0 计）。必须走原生 setter，否则 React 收不到 onChange */
async function seek(page, i) {
  await page.evaluate((v) => {
    const el = document.querySelector('input[aria-label="进度"]')
    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, i)
  await page.waitForTimeout(200)
}

async function openDemo(page, id, { narrow = false } = {}) {
  await page.goto(`${BASE}#/viz3d/${id}`, { waitUntil: 'load' })
  await page.waitForFunction(
    (want) => {
      const t = document.querySelector('[data-role="viz3d-title"]')
      if (!t || t.getAttribute('data-demo-id') !== want) return false
      if (document.querySelector('[data-role="viz3d-busy"]')) return false
      if (document.querySelector('[data-role="viz3d-loading"]')) return false
      return !!document.querySelector('[data-role="viz3d-canvas"], [data-role="viz3d-flat"]')
    },
    id, { timeout: 30000 },
  )
  await page.waitForTimeout(narrow ? 300 : 700)
}

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)

  // ── ⓪ 静态闸门（不进浏览器也该成立）──
  const typesSrc = readFileSync(join(ROOT, 'src', 'modules', 'viz3d', 'types.ts'), 'utf8')
  const tl = typesSrc.split('\n')
  const t0 = tl.findIndex((l) => l.includes('export type Scene3DKind'))
  let kindStmt = ''
  for (let i = t0; i >= 0 && i < tl.length && i < t0 + 20; i += 1) {
    const line = (tl[i] ?? '').trim()
    // 联合类型是跨行书写的：首行以 = 结尾，其后每行都以 | 开头，遇到第一个不以 | 开头的行才算结束。
    // （旧解析器在第一行成员处就 break，导致「7 类场景」永远判 FAIL —— 是脚本 bug，不是类型 bug。）
    if (i > t0 && !line.startsWith('|')) break
    kindStmt += ' ' + line
  }
  // 直接抽引号里的字面量做集合比对：不数 | 的个数（前置竖线写法 n 个成员就有 n 个 |，
  // 旧口径按 n-1 数必然误判）。多一类少一类都算 FAIL。
  const kindsInSrc = [...kindStmt.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1])
  check('Scene3DKind 联合类型恰好是 7 类场景（与验收脚本口径一致）',
    t0 >= 0 && kindsInSrc.length === KINDS.length && KINDS.every((k) => kindsInSrc.includes(k)),
    kindsInSrc.join(',') + ' ｜ 期望 ' + KINDS.join(','))

  const catalogSrc = readFileSync(join(ROOT, 'src', 'modules', 'viz3d', 'catalog.ts'), 'utf8')
  check('catalog.ts 不 import three/@react-three（列表页因此能保持零 3D 体积）',
    !/from\s+['"](three|@react-three)/.test(catalogSrc))
  const listPageSrc = readFileSync(join(ROOT, 'src', 'pages', 'Viz3DListPage.tsx'), 'utf8')
  check('Viz3DListPage.tsx 不 import three/@react-three',
    !/from\s+['"](three|@react-three)/.test(listPageSrc))

  const threeChunks = readdirSync(join(ROOT, 'dist', 'assets')).filter((f) => /^three-.*\.js$/.test(f))
  check('构建产物里 three 运行时被切成独立 chunk（manualChunks 生效）', threeChunks.length === 1, threeChunks.join(','))

  // ── ⓪b 语料可复现：gen:viz3d 前后 sha256 逐字节一致 ──
  const before = dirHashes(VIZ3D_DIR)
  const g = cmd('npm run gen:viz3d')
  const after = dirHashes(VIZ3D_DIR)
  check('npm run gen:viz3d 退出码 0', g.status === 0, `exit=${g.status}`)
  check('3D 专属语料一条命令可重生成且字节级可复现',
    Object.keys(before).length >= NEW3D.length + 1 && JSON.stringify(before) === JSON.stringify(after),
    `${Object.keys(after).length} 个文件：${Object.keys(after).join(',')}`)

  const idx3d = JSON.parse(readFileSync(join(VIZ3D_DIR, 'index.json'), 'utf8'))
  check('viz3d/index.json 收录全部 4 份新语料',
    NEW3D.every((id) => idx3d.demos.some((d) => d.id === id)),
    idx3d.demos.map((d) => d.id).join(','))
  for (const id of NEW3D) {
    const c = findCorpus(id)
    const steps = c?.json?.steps ?? []
    check(`语料 ${id} 结构合法（≥5 步、每步有 description + codeLine + snapshot.regions、kind=memory）`,
      !!c && steps.length >= 5 && steps.every((s) => typeof s.description === 'string' && s.description.length > 10
        && Number.isFinite(s.codeLine)
        && s.snapshot?.kind === 'memory' && Array.isArray(s.snapshot.regions) && s.snapshot.regions.length > 0
        && s.snapshot.regions.every((r) => r.key && r.title && Array.isArray(r.cells))),
      `${steps.length} 步`)
  }

  // ── ① 浏览器：首页与列表页的 3D 体积红线 ──
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await ctx.newPage()
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const reqs = []
  page.on('request', (r) => reqs.push(r.url()))
  const threeReqs = () => reqs.filter((u) => /three-[^/]*\.js/.test(u))

  reqs.length = 0
  await page.goto(`${BASE}#/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-role="skip-link"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  check('首页加载不下载任何 three chunk（路由级 lazy 生效，首页零 3D 体积负担）', threeReqs().length === 0, threeReqs().join(','))
  const navHref = await page.locator('a[href="#/viz3d"], a[href*="/viz3d"]').first().getAttribute('href').catch(() => null)
  check('全局导航里有「3D 馆」入口', !!navHref, String(navHref))

  reqs.length = 0
  await page.goto(`${BASE}#/viz3d`, { waitUntil: 'load' })
  await page.waitForSelector('[data-role="viz3d-list"]', { timeout: 20000 })
  await page.waitForTimeout(800)
  check('3D 列表页同样不下载 three chunk', threeReqs().length === 0, threeReqs().join(','))

  const cards = page.locator('[data-role="viz3d-card"]')
  const cardCount = await cards.count()
  const groups = await page.locator('[data-role="viz3d-group"]').count()
  const meta = []
  for (let i = 0; i < cardCount; i += 1) {
    meta.push({
      id: await cards.nth(i).getAttribute('data-id'),
      scene: await cards.nth(i).getAttribute('data-scene'),
    })
  }
  check(`列表页渲染 ${cardCount} 张卡片 / ${groups} 个分组（≥30 张、≥6 组）`, cardCount >= 30 && groups >= 6, `${cardCount} 张 / ${groups} 组`)
  check('每张卡片都带 data-id 与 data-scene', meta.every((m) => m.id && m.scene))
  const sceneSet = [...new Set(meta.map((m) => m.scene))].sort()
  check('7 类 3D 场景在列表页全部有演示可点', KINDS.every((k) => sceneSet.includes(k)), sceneSet.join(','))
  check('列表页每张卡片背后都有真实语料文件（viz3d 专属或与 2D 馆共用）',
    meta.every((m) => !!findCorpus(m.id)),
    meta.filter((m) => !findCorpus(m.id)).map((m) => m.id).join(',') || '全部命中')
  const shared = meta.filter((m) => findCorpus(m.id)?.shared).length
  check('与 2D 馆共用语料的演示占多数（不重复造语料）', shared >= cardCount * 0.6, `${shared}/${cardCount} 共用`)
  check('4 份 3D 专属语料都出现在列表页', NEW3D.every((id) => meta.some((m) => m.id === id)))

  // ── ② 每类场景 + 4 份新语料：真机跑一遍 WebGL ──
  const visit = [...NEW3D]
  for (const k of KINDS) {
    const hit = meta.find((m) => m.scene === k && !visit.includes(m.id))
    if (hit) visit.push(hit.id)
  }
  const stats = []
  for (const id of visit) {
    const corpus = findCorpus(id)
    const total = corpus?.json?.steps?.length ?? -1
    await openDemo(page, id)
    const title = (await page.locator('[data-role="viz3d-title"]').first().innerText()).trim()
    const canvasSel = '[data-role="viz3d-canvas"] canvas'
    const hasCanvas = await page.locator(canvasSel).count()
    const box = hasCanvas ? await page.locator(canvasSel).first().boundingBox() : null
    const fallback = await page.locator('[data-role="viz3d-fallback"]').count()
    const init = await stepNums(page)
    const curStep = corpus?.json?.steps?.[init.cur - 1]
    const cc = curStep?.snapshot?.counters ?? {}
    const ccKeys = Object.keys(cc)
    const countersEl = await page.locator('[data-role="viz3d-counters"]').count()
    const countersTxt = countersEl ? (await page.locator('[data-role="viz3d-counters"]').first().innerText()).trim() : ''

    // 单步：先拖到第 1 步，再点「下一步」，计数必须 +1
    await seek(page, 0)
    const at0 = await stepNums(page)
    await page.locator(SEL.next).first().click()
    await page.waitForTimeout(350)
    const at1 = await stepNums(page)

    // 播放：1.6 秒后必须自己往前走，然后暂停
    await page.locator(SEL.play).first().click()
    await page.waitForTimeout(1600)
    const playing = await stepNums(page)
    await page.locator(SEL.play).first().click()
    await page.waitForTimeout(200)
    const paused = await stepNums(page)
    await page.waitForTimeout(700)
    const stillPaused = await stepNums(page)

    // 重置视角（remount Canvas）+ 重置步骤
    await page.locator('[data-role="viz3d-reset-view"]').first().click()
    await page.waitForTimeout(900)
    const remounted = await page.locator(canvasSel).count()
    await page.locator(SEL.reset).first().click()
    await page.waitForTimeout(400)
    const back = await stepNums(page)

    await seek(page, total - 1)
    await page.waitForTimeout(800)
    const st = await page.evaluate(() => (window).__VIZ3D_STATS__ ?? null)
    stats.push({ id, ...(st ?? { meshes: -1 }) })
    check(`[${id}] 3D 舞台真出画面（canvas 非零尺寸、未掉降级横幅、标题非空）`,
      hasCanvas === 1 && !!box && box.width > 100 && box.height > 100 && fallback === 0 && title.length > 0,
      `${title.slice(0, 24)} ｜ ${box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'no-canvas'}`)
    check(`[${id}] 步骤总数与语料一致（${total} 步），计数器初值落在有效区间`,
      init.total === total && init.cur >= 1 && init.cur <= total, `${init.raw} ｜ 语料 ${total} 步`)
    check(`[${id}] 单步可用：拖到 1/${total} 后点「下一步」→ 2/${total}`,
      at0.cur === 1 && at1.cur === 2 && at1.total === total, `${at0.raw} → ${at1.raw}`)
    check(`[${id}] 播放/暂停可用：播放后自动前进，暂停后停住`,
      playing.cur > at1.cur && stillPaused.cur === paused.cur, `${at1.raw} →播 ${playing.raw} →停 ${stillPaused.raw}`)
    check(`[${id}] 重置视角后 Canvas 重新挂载、重置步骤回到初值 ${init.cur}`,
      remounted === 1 && back.cur === init.cur, back.raw)
    check(`[${id}] 计数器面板与语料 snapshot.counters 严格对账`,
      ccKeys.length === 0
        ? countersEl === 0
        : countersEl === 1 && ccKeys.every((k) => countersTxt.includes(String(cc[k]))),
      ccKeys.length
        ? `${ccKeys.join(',')} → ${countersTxt.replace(/\s+/g, ' ').slice(0, 70)}`
        : '本步语料无 counters，面板正确地不渲染')
    check(`[${id}] 末步 mesh 数 ${st?.meshes ?? '?'} 落在 [3, ${MESH_BUDGET}]（场景真的画出来了，且未超性能预算）`,
      !!st && st.meshes >= 3 && st.meshes <= MESH_BUDGET,
      st ? `meshes=${st.meshes} calls=${st.calls} tris=${st.triangles}` : 'StatsProbe 未上报')
  }
  const peak = stats.reduce((m, s) => Math.max(m, s.meshes ?? 0), 0)
  const floor = stats.reduce((m, s) => Math.min(m, s.meshes ?? 1e9), 1e9)
  check(`${visit.length} 个演示末步 mesh 数全部落在 [3, ${MESH_BUDGET}]（实测峰值 ${peak}）`,
    stats.length === visit.length && floor >= 3 && peak <= MESH_BUDGET,
    stats.map((s) => `${s.id}=${s.meshes}`).join(' '))

  // ── ③ 2D / 3D 视图切换 ──
  const demoForToggle = visit[0] ?? NEW3D[0]
  await openDemo(page, demoForToggle)
  await page.locator('[data-role="viz3d-view-toggle"]').first().click()
  await page.waitForTimeout(700)
  const flatOn = await page.locator('[data-role="viz3d-flat"]').count()
  const canvasOff = await page.locator('[data-role="viz3d-canvas"]').count()
  await page.locator('[data-role="viz3d-view-toggle"]').first().click()
  await page.waitForTimeout(900)
  const canvasBack = await page.locator('[data-role="viz3d-canvas"] canvas').count()
  check(`[${demoForToggle}] 视图开关：切到 2D 出平面渲染器、切回 3D 重新出 canvas`,
    flatOn === 1 && canvasOff === 0 && canvasBack === 1, `flat=${flatOn} canvas=${canvasOff}→${canvasBack}`)

  // ── ④ 窄屏降级（375px）──
  const narrowCtx = await browser.newContext({ viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true })
  const np = await narrowCtx.newPage()
  np.on('console', (m) => consoleMsgs.push({ type: m.type(), text: `[narrow] ${m.text()}` }))
  np.on('pageerror', (e) => pageErrors.push(`[narrow] ${e.message}`))
  const narrowReqs = []
  np.on('request', (r) => narrowReqs.push(r.url()))
  await np.goto(`${BASE}#/viz3d`, { waitUntil: 'load' })
  await np.waitForSelector('[data-role="viz3d-list"]', { timeout: 20000 })
  const narrowList = await np.locator('[data-role="viz3d-card"]').count()
  await openDemo(np, demoForToggle, { narrow: true })
  const narrowFlat = await np.locator('[data-role="viz3d-flat"]').count()
  const narrowCanvas = await np.locator('[data-role="viz3d-canvas"]').count()
  const narrowStep = await stepNums(np)
  check('375px 窄屏：列表页卡片数与桌面一致（不裁内容）', narrowList === cardCount, `${narrowList}/${cardCount}`)
  check(`375px 窄屏：演示页自动降级到 2D 平面视图且步骤计数正常（${narrowStep.raw}）`,
    narrowFlat === 1 && narrowCanvas === 0 && narrowStep.total > 0)
  check('375px 窄屏：降级路径不下载 three chunk（省流量）',
    narrowReqs.filter((u) => /three-[^/]*\.js/.test(u)).length === 0)
  await narrowCtx.close()

  // ── ⑤ 控制台必须干净 ──
  const NOISE = /SwiftShader|ANGLE|GPU stall|Automatic fallback to software WebGL|webgl fallback|GroupMarkerNotSet/i
  const errs = consoleMsgs.filter((m) => m.type === 'error' && !NOISE.test(m.text))
  const warns = consoleMsgs.filter((m) => m.type === 'warning' && !NOISE.test(m.text))
  check('控制台无 error（GPU/驱动类噪声已排除）', errs.length === 0 && pageErrors.length === 0,
    [...errs.map((e) => e.text), ...pageErrors].slice(0, 3).join(' ⏐ ').slice(0, 300) || 'clean')
  check('控制台无 warning', warns.length === 0, warns.slice(0, 3).map((w) => w.text).join(' ⏐ ').slice(0, 300) || 'clean')
}

let exitCode = 0
try {
  await main()
} catch (e) {
  console.error('验收脚本异常：', e?.stack ?? e)
  exitCode = 1
} finally {
  try { await browser?.close() } catch { /* 已关 */ }
  spawnSync('taskkill', ['/IM', 'chrome.exe', '/F'], { stdio: 'ignore', windowsHide: true })
  preview.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 400))
}

const fail = checks.filter((c) => !c.ok)
console.log(`\n=== acceptance:viz3d 汇总：${checks.length - fail.length}/${checks.length} PASS ===`)
for (const f of fail) console.log(`  FAIL ${f.name}${f.detail ? ' ｜ ' + f.detail : ''}`)
if (fail.length || exitCode) process.exit(1)
