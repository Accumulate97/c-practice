/**
 * 阶段 7-9 可视化板块 UI 验收：真实浏览器里跑 dist 产物，验 Viz 内核 + 五类渲染器（R1 柱状图 / R2 节点链 / R3 树 / R4 图 / R5 内存格）+ 全部演示语料 + 多算法对比 + 题目→演示双向跳转。
 *
 * 与其它 acceptance-*-ui.mjs 同一口径（build → vite preview → playwright-core → 控制台必须干净），差异只在：
 *   ① 期望值一律从 public/data/viz/*.json 现读，脚本里不抄步骤数、不抄计数器数值
 *      （唯一硬编码的期望是「冒泡 n=8 比较次数 = 28 = n(n-1)/2」，那是验收标准点名要的理论值）
 *   ② HashRouter → URL 用 #/viz/...；hash-only 跳转是同文档导航，所以每次都用标题文本等到位
 *   ③ 收尾再验「一条命令重生成全部语料且字节级可复现」：gen:viz 前后对全部 viz JSON 取 sha256
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4177
const BASE = `http://127.0.0.1:${PORT}/`
const VIZ_DIR = join(ROOT, 'public', 'data', 'viz')

const SORTS = [
  'sort-bubble', 'sort-selection', 'sort-insertion', 'sort-shell',
  'sort-merge', 'sort-quick', 'sort-heapsort', 'sort-radix',
]
const DEFAULT_IDS = ['sort-bubble', 'sort-selection', 'sort-insertion', 'sort-quick']

const index = JSON.parse(readFileSync(join(VIZ_DIR, 'index.json'), 'utf8'))
/** id -> 语料本体（按需现读，供 UI 数值对账） */
const corpus = (id) => JSON.parse(readFileSync(join(VIZ_DIR, `${id}.json`), 'utf8'))
const entry = (id) => index.demos.find((d) => d.id === id)

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)
function vizHashes() {
  const out = {}
  for (const f of readdirSync(VIZ_DIR).filter((f) => f.endsWith('.json')).sort()) out[f] = sha(join(VIZ_DIR, f))
  return out
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }
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

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)

  // ── ⓪ 索引与语料静态对账（不进浏览器也该成立）──
  const ids = index.demos.map((d) => d.id)
  const demoFiles = readdirSync(VIZ_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')
  check(`索引收录 ${index.demos.length} 个演示（≥30），8 种排序全在，索引与语料文件一一对应`,
    index.demos.length >= 30 && SORTS.every((s) => ids.includes(s)) && demoFiles.length === index.demos.length && demoFiles.every((f) => ids.includes(f.replace(/\.json$/, ''))),
    `${index.demos.length} 个：${ids.join(',')}`)
  const badMeta = SORTS.filter((s) => entry(s).renderer !== 'bar' || entry(s).category !== 'sort' || entry(s).steps !== corpus(s).steps.length)
  check('8 种排序的 renderer/category/steps 与语料本体一致', badMeta.length === 0, badMeta.length ? '不一致：' + badMeta.join(',') :
    SORTS.map((s) => `${s.replace('sort-', '')}=${entry(s).steps}步`).join(' '))

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))

  const stepNum = () => page.evaluate(() => {
    const t = document.querySelector('[data-role="viz-step"]')?.textContent ?? ''
    const m = t.match(/步骤\s*(\d+)\s*\/\s*(\d+)/)
    return m ? { cur: Number(m[1]), total: Number(m[2]) } : { cur: -1, total: -1 }
  })
  const counters = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-role="viz-canvas"] [data-counter]')].map((e) => [e.dataset.counter, Number(e.dataset.value)])))
  const blur = () => page.evaluate(() => { document.activeElement?.blur() })

  async function openDemo(id) {
    await page.goto(`${BASE}#/viz/${id}`, { waitUntil: 'networkidle' })
    await page.waitForFunction((t) => document.querySelector('[data-role="viz-title"]')?.textContent.trim() === t, entry(id).title, { timeout: 20000 })
    await page.waitForSelector('[data-role="viz-canvas"] > *', { timeout: 20000 })
  }
  /** 拖进度条到第 v 步（0 基）。React 受控 range 必须走原生 setter，直接赋 value 会被 value tracker 吞掉 */
  async function seekTo(v) {
    await page.evaluate((val) => {
      const el = document.querySelector('input[aria-label="进度"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, v)
  }

  // ── ① 8 种排序逐一：播放 / 暂停 / 单步 / 后退 / 进度条 / 重置 / 键盘 ──
  const rows = []
  for (const id of SORTS) {
    const c = corpus(id)
    await openDemo(id)
    await page.waitForSelector('[data-role="viz-bar"]', { timeout: 20000 })
    const t0 = await stepNum()
    const bars = await page.locator('[data-role="viz-bar"]').count()
    check(`${id}：打开即第 1 步，柱子数 = 输入规模`, t0.cur === 1 && t0.total === c.steps.length && bars === c.meta.input.length,
      `步骤 ${t0.cur}/${t0.total}，柱子 ${bars} 根，输入 [${c.meta.input.join(',')}]`)

    // 播放 → 自动前进；再点 → 停住
    await page.locator('[data-role="viz-play"]').click()
    await page.waitForFunction((n) => {
      const m = (document.querySelector('[data-role="viz-step"]')?.textContent ?? '').match(/步骤\s*(\d+)/)
      return !!m && Number(m[1]) > n
    }, t0.cur, { timeout: 8000 })
    const playing = await stepNum()
    const label = await page.locator('[data-role="viz-play"]').getAttribute('aria-label')
    await page.locator('[data-role="viz-play"]').click()
    const paused = await stepNum()
    await page.waitForTimeout(900)
    const still = await stepNum()
    const label2 = await page.locator('[data-role="viz-play"]').getAttribute('aria-label')
    check(`${id}：播放自动前进、再点暂停后不再前进`,
      playing.cur > t0.cur && label === '暂停' && still.cur === paused.cur && label2 === '播放',
      `1 → ${playing.cur}（按钮变「暂停」）→ 点一下停在 ${paused.cur}，900ms 后仍 ${still.cur}（按钮回「播放」）`)

    // 键盘：→ 单步、← 后退、空格 播放/暂停（先 blur，避免空格顺带触发按钮 click）
    await blur()
    await page.keyboard.press('ArrowRight')
    const fwd = await stepNum()
    await page.keyboard.press('ArrowLeft')
    const back = await stepNum()
    await blur()
    await page.keyboard.press('Space')
    await page.waitForFunction((n) => {
      const m = (document.querySelector('[data-role="viz-step"]')?.textContent ?? '').match(/步骤\s*(\d+)/)
      return !!m && Number(m[1]) > n
    }, back.cur, { timeout: 8000 })
    await blur()
    await page.keyboard.press('Space')
    const afterSpace = await stepNum()
    await page.waitForTimeout(800)
    const spaceHeld = await stepNum()
    check(`${id}：键盘 →/← 单步前进后退、空格播放暂停`,
      fwd.cur === back.cur + 1 && fwd.cur === paused.cur + 1 && spaceHeld.cur === afterSpace.cur,
      `→ ${fwd.cur}，← ${back.cur}，空格播放到 ${afterSpace.cur} 后再按空格停在 ${spaceHeld.cur}`)

    // 进度条拖到末步 → 计数器等于语料末步快照；重置回第 1 步
    const n = c.steps.length
    await seekTo(n - 1)
    const atEnd = await stepNum()
    const uiCounters = await counters()
    const want = c.steps[n - 1].snapshot.counters ?? {}
    const same = Object.keys(want).every((k) => uiCounters[k] === want[k]) && Object.keys(want).length > 0
    await page.locator('button[aria-label="⏮ 重置"]').click()
    const afterReset = await stepNum()
    check(`${id}：进度条跳到末步（计数器与语料一致）、重置回第 1 步`,
      atEnd.cur === n && same && afterReset.cur === 1,
      `末步 ${atEnd.cur}/${atEnd.total}，${Object.entries(uiCounters).map(([k, v]) => `${k}=${v}`).join(' ')}；重置后 ${afterReset.cur}`)
    rows.push(`${id.replace('sort-', '')}: ${n}步 ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join('/')}`)
  }
  console.log('     8 种排序末步计数：' + rows.join(' ｜ '))

  // ── ② 验收标准点名的理论值：冒泡 n=8 → 比较 28 次 ──
  const N = corpus('sort-bubble').meta.input.length
  await openDemo('sort-bubble')
  await page.locator('button[aria-label="末步 ⏭"]').click()
  const bubbleEnd = await counters()
  check(`冒泡排序 n=${N} 比较次数 = ${N * (N - 1) / 2}（n(n-1)/2，与理论复杂度吻合）`,
    bubbleEnd.comparisons === N * (N - 1) / 2, `comparisons=${bubbleEnd.comparisons} swaps=${bubbleEnd.swaps}`)
  await page.screenshot({ path: join(ROOT, 'tmp', 'viz-bubble-end.png'), fullPage: false })
  await page.locator('button[aria-label="⏮ 重置"]').click()
  await page.locator('[data-role="viz-play"]').click()
  await page.waitForTimeout(1600)
  await page.screenshot({ path: join(ROOT, 'tmp', 'viz-bubble-mid.png'), fullPage: false })

  // ── ③ 深色主题下渲染器不出错 ──
  await page.locator('button[title="深色"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 })
  await page.waitForTimeout(300)
  const darkBars = await page.locator('[data-role="viz-bar"]').count()
  await page.screenshot({ path: join(ROOT, 'tmp', 'viz-bubble-dark.png'), fullPage: false })
  const darkOthers = []
  for (const id of ['linear-singly-insert', 'tree-inorder', 'graph-dijkstra', 'memory-malloc-free']) {
    await page.goto(`${BASE}#/viz/${id}`, { waitUntil: 'networkidle' })
    await page.waitForFunction((t) => document.querySelector('[data-role="viz-title"]')?.textContent.trim() === t, entry(id).title, { timeout: 20000 })
    darkOthers.push(await page.locator('[data-role="viz-canvas"] > *').count())
  }
  await page.screenshot({ path: join(ROOT, 'tmp', 'viz-memory-dark.png'), fullPage: false })
  await page.locator('button[title="浅色"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 })
  const lightOthers = await page.locator('[data-role="viz-canvas"] > *').count()
  check('五类渲染器深 / 浅色主题下均正常渲染（CSS 变量适配）',
    darkBars === N && darkOthers.every((n2) => n2 > 0) && lightOthers > 0,
    `深色：柱状 ${darkBars} 根，R2/R3/R4/R5 画布子节点 ${darkOthers.join('/')}；切回浅色后 ${lightOthers} 个`)

  // ── ④ 抽 5 个演示（覆盖 R2 节点链 / R3 树 / R4 图 / R5 内存格）：播放 / 暂停 / 单步 / 后退 / 末步 / 重置 ──
  const SAMPLES = ['linear-singly-insert', 'linear-queue-enqueue-dequeue', 'tree-inorder', 'graph-dijkstra', 'memory-malloc-free']
  for (const id of SAMPLES) {
    await openDemo(id)
    const c = corpus(id)
    const t = await stepNum()
    await page.locator('[data-role="viz-play"]').click()
    await page.waitForFunction((n) => {
      const m = (document.querySelector('[data-role="viz-step"]')?.textContent ?? '').match(/步骤\s*(\d+)/)
      return !!m && Number(m[1]) > n
    }, t.cur, { timeout: 8000 })
    await page.locator('[data-role="viz-play"]').click()
    const paused = await stepNum()
    await blur()
    await page.keyboard.press('ArrowRight')
    const fwd = await stepNum()
    await page.keyboard.press('ArrowLeft')
    const back = await stepNum()
    await page.locator('button[aria-label="末步 ⏭"]').click()
    const e = await stepNum()
    await page.locator('button[aria-label="⏮ 重置"]').click()
    const r = await stepNum()
    check(`${id}（${entry(id).renderer}）：播放 / 暂停 / 单步 / 后退 / 末步 / 重置全可用，总步数与语料一致`,
      t.cur === 1 && t.total === c.steps.length && paused.cur > t.cur && fwd.cur === paused.cur + 1 && back.cur === paused.cur && e.cur === c.steps.length && r.cur === 1,
      `${t.cur}/${t.total} → 播放到 ${paused.cur} → 单步 ${fwd.cur} → 后退 ${back.cur} → 末步 ${e.cur} → 重置 ${r.cur}`)
    await page.screenshot({ path: join(ROOT, 'tmp', `viz-sample-${id}.png`), fullPage: false })
  }

  // ── ⑤ 列表页：12 张卡片 + 对比入口 ──
  await page.goto(`${BASE}#/viz`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-role="viz-card"]', { timeout: 20000 })
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-role="viz-card"]')].map((e) => e.dataset.demo))
  check(`列表页 ${index.demos.length} 张演示卡片按渲染器分类陈列，id 与索引一致`,
    cards.length === index.demos.length && JSON.stringify(cards.slice().sort()) === JSON.stringify(ids.slice().sort()), `${cards.length} 张`)
  await page.screenshot({ path: join(ROOT, 'tmp', 'viz-list.png'), fullPage: true })

  // ── ⑤b 双向关联回填：题目详情页展示关联演示并可跳转 ──
  const shard = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'problems', 'c-ch09.json'), 'utf8'))
  const linked = shard.problems.find((pp) => Array.isArray(pp.vizIds) && pp.vizIds.length > 0)
  const firstViz = ids.find((i) => linked.vizIds.includes(i))
  await page.goto(`${BASE}#/problems/p/${linked.id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-role="related-viz"]', { timeout: 20000 })
  const rvHrefs = await page.evaluate(() => [...document.querySelectorAll('[data-role="related-viz-link"]')].map((el) => el.getAttribute('href')))
  await page.locator('[data-role="related-viz-link"]').first().click()
  await page.waitForFunction((t) => document.querySelector('[data-role="viz-title"]')?.textContent.trim() === t, entry(firstViz).title, { timeout: 20000 })
  check(`题目详情页 → 关联演示跳转（${linked.id} 关联 ${linked.vizIds.join(',')}）`,
    rvHrefs.length === linked.vizIds.length && rvHrefs.every((h) => h.includes('/viz/')) && page.url().includes(`/viz/${firstViz}`),
    `链接 ${rvHrefs.join(' ')}，点击后落在 #${page.url().split('#')[1] ?? ''}`)

  // ── ⑥ 多算法对比：并排同步步进 ──
  await page.goto(`${BASE}#/viz`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-role="viz-compare-entry"]', { timeout: 20000 })
  await page.locator('[data-role="viz-compare-entry"]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-role="cmp-panel"]').length === 4, null, { timeout: 30000 })
  const cmpStep = () => page.evaluate(() => Number((document.querySelector('[data-role="cmp-step"]')?.textContent ?? '').match(/步骤\s*(\d+)/)?.[1] ?? -1))
  const panelState = () => page.evaluate(() => [...document.querySelectorAll('[data-role="cmp-panel"]')].map((p) => ({
    id: p.dataset.demo,
    head: p.querySelector('header span')?.textContent.trim() ?? '',
    counters: Object.fromEntries([...p.querySelectorAll('[data-counter]')].map((e) => [e.dataset.counter, Number(e.dataset.value)])),
    ended: !!p.querySelector('[data-role="cmp-ended"]'),
    bars: p.querySelectorAll('[data-role="viz-bar"]').length,
  })))
  const picks = await page.evaluate(() => [...document.querySelectorAll('[data-role="cmp-pick"]')].map((e) => ({ id: e.dataset.demo, on: e.dataset.on, dis: e.disabled })))
  check('对比页默认并排 4 个算法，选择器 8 个（满 4 个时其余置灰）',
    picks.length === 8 && picks.filter((p) => p.on === '1').map((p) => p.id).sort().join() === DEFAULT_IDS.slice().sort().join() && picks.every((p) => p.on === '1' || p.dis),
    `选中 ${picks.filter((p) => p.on === '1').map((p) => p.id).join(',')}；置灰 ${picks.filter((p) => p.dis).length} 个`)

  const st0 = await panelState()
  check('对比页初始：4 个面板都停在各自第 1 步，共享时间轴 步骤 1',
    (await cmpStep()) === 1 && st0.every((p) => p.head.startsWith('1 /')), st0.map((p) => `${p.id}:${p.head}`).join(' '))

  await page.locator('[data-role="cmp-next"]').click()
  await page.locator('[data-role="cmp-next"]').click()
  const st2 = await panelState()
  const want2 = Object.fromEntries(DEFAULT_IDS.map((id) => [id, corpus(id).steps[2].snapshot.counters ?? {}]))
  const synced = (await cmpStep()) === 3 && st2.every((p) => p.head.startsWith('3 /'))
  const countersMatch = st2.every((p) => Object.entries(want2[p.id] ?? {}).every(([k, v]) => p.counters[k] === v))
  check('点「下一步」两次：4 个面板同步走到第 3 步，各自计数与语料第 3 步快照逐位相符',
    synced && countersMatch,
    st2.map((p) => `${p.id.replace('sort-', '')} ${p.head} DOM{${Object.entries(p.counters).map(([k, v]) => `${k}=${v}`).join(' ')}} 语料{${Object.entries(want2[p.id] ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}}`).join(' ｜ '))

  await page.locator('[data-role="cmp-play"]').click()
  await page.waitForFunction(() => {
    const m = (document.querySelector('[data-role="cmp-step"]')?.textContent ?? '').match(/步骤\s*(\d+)/)
    return !!m && Number(m[1]) > 3
  }, null, { timeout: 8000 })
  await page.locator('[data-role="cmp-play"]').click()
  const cmpPlayed = await cmpStep()
  await page.locator('[data-role="cmp-last"]').click()
  const stEnd = await panelState()
  const maxSteps = Math.max(...DEFAULT_IDS.map((id) => corpus(id).steps.length))
  check('对比页播放同步步进、末步时短算法停在末步并标「已结束」',
    cmpPlayed > 3 && (await cmpStep()) === maxSteps && stEnd.every((p) => p.head === `${Math.min(maxSteps, corpus(p.id).steps.length)} / ${corpus(p.id).steps.length} 步`) && stEnd.filter((p) => p.ended).length >= 3,
    `播放到 ${cmpPlayed}，末步 步骤 ${maxSteps}；${stEnd.map((p) => `${p.id.replace('sort-', '')} ${p.head}${p.ended ? '(已结束)' : ''}`).join(' ')}`)
  await page.screenshot({ path: join(ROOT, 'tmp', 'viz-compare-end.png'), fullPage: true })

  // 换算法：关掉快排、换成归并 → 面板随之替换，时间轴保留
  await page.locator('[data-role="cmp-pick"][data-demo="sort-quick"]').click()
  const three = await panelState()
  await page.locator('[data-role="cmp-pick"][data-demo="sort-merge"]').click()
  const swapped = await panelState()
  check('并排算法可换：去掉快排剩 3 个、换上归并回到 4 个，进度不丢',
    three.length === 3 && !three.some((p) => p.id === 'sort-quick') && swapped.length === 4 && swapped.some((p) => p.id === 'sort-merge') && (await cmpStep()) === maxSteps,
    `${three.map((p) => p.id.replace('sort-', '')).join(',')} → ${swapped.map((p) => p.id.replace('sort-', '')).join(',')}`)

  await page.locator('[data-role="cmp-reset"]').click()
  check('对比页重置：回到 步骤 1，4 个面板同步归零',
    (await cmpStep()) === 1 && (await panelState()).every((p) => p.head.startsWith('1 /')), '')

  // ── ⑦ 一条命令重生成全部语料，且字节级可复现 ──
  const before = vizHashes()
  const gen = spawnSync('npm run gen:viz', { cwd: ROOT, encoding: 'utf8', shell: true })
  const after = vizHashes()
  const changed = Object.keys(before).filter((f) => before[f] !== after[f])
  check('npm run gen:viz 一条命令重生成全部语料，退出码 0 且字节级可复现（无手写 JSON）',
    gen.status === 0 && changed.length === 0 && Object.keys(after).length === demoFiles.length + 1,
    `exit=${gen.status}，${Object.keys(after).length} 个 JSON，重跑后差异 ${changed.length} 个`)
  const genTail = (gen.stdout ?? '').trim().split('\n').slice(-4).join(' ⏎ ')
  console.log('     gen:viz 输出尾部：' + genTail)

  // ── ⑧ 控制台 ──
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('全流程控制台 error/warn/pageerror 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? `共 ${consoleMsgs.length} 条其它消息，0 error 0 warn 0 pageerror`
      : JSON.stringify({ bad: bad.slice(0, 6), pageErrors: pageErrors.slice(0, 3) }).slice(0, 800))

  await browser.close()
}

try { await main() } catch (e) { check('可视化 UI 验收流程未抛异常', false, (e instanceof Error ? e.stack : String(e)).split('\n').slice(0, 4).join(' | ')) } finally { preview.kill(); try { await browser?.close() } catch { /* 已关闭 */ } }

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 阶段 7-9 可视化 UI 验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exit(failed.length > 0 ? 1 : 0)