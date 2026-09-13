/**
 * 全站搜索 + 首页改版验收（任务 4）：npm run acceptance:search
 *
 * 与其它 acceptance-*-ui.mjs 同一口径：dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净。
 * 不打 Godbolt：搜索是纯前端本地打分，语料是构建期生成的 JSON，全链路可离线复现。守住十个点：
 *   ① 语料对账：unified.json 的题目数 == problems/index.json 的 count（不能少也不能多）
 *   ② 路由级 lazy：首页既不下载 SearchPage chunk，也不下载 727 KB 语料，只拉 <1 KB 的 totals.json
 *   ③ 首页规模数字来自 totals.json（不是硬编码）；进度概览在无记录时给引导而不是空白
 *   ④ 头部搜索框：具名、Ctrl+K 与单键「/」都能聚焦、回车跳 /search?q=
 *   ⑤ 搜索五态：空态给热词、无结果给建议、有结果如实报命中数与截断
 *   ⑥ 多类命中 + 类别 chip 过滤真的生效（点 chip 后只剩该类）
 *   ⑦ AND 语义：加一个词，命中数严格变小
 *   ⑧ 结果深链可点：手册行落到 /cheatsheet?q= 且过滤框已填好；展品深链 ?ex= 自动展开
 *   ⑨ URL 可分享：带 q 刷新后结果还在
 *   ⑩ 375px 无横向溢出；h1 唯一；控制台 0 error 0 warn
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4198
const BASE = `http://127.0.0.1:${PORT}/`

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

const P_IDX = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'problems', 'index.json'), 'utf8'))
const UNIFIED = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'search', 'unified.json'), 'utf8'))
const TOTALS = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'search', 'totals.json'), 'utf8'))
const BUGS = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'bugs', 'exhibits.json'), 'utf8'))
const BUG_ID = BUGS.exhibits[0].id
const FIRST_PID = P_IDX.problems[0].id
const REF_DOC = UNIFIED.docs.find((d) => d.k === 'ref')

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

const goto = async (h) => { await page.goto(BASE + h, { waitUntil: 'load' }); await page.waitForTimeout(350) }
/** 命中数：从 data-role="search-count" 的文案里抠数字 */
const matched = async () => Number((await page.locator('[data-role="search-count"]').innerText()).match(/命中\s*(\d+)/)?.[1] ?? -1)
const resultKinds = () => page.locator('[data-role="search-result"]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-kind')))
/** chip 文案 "✍️ 题目 (123)" → { kind: 计数 } */
const chipCounts = () => page.locator('[data-role="search-kind"]').evaluateAll((ns) => ns.map((n) => ({
  kind: n.getAttribute('data-kind'),
  n: Number((n.textContent || '').match(/\((\d+)\)/)?.[1] ?? 0),
  dis: n.disabled === true,
})))
const search = async (q) => {
  const input = page.locator('[data-role="search-input"]')
  await input.fill(q)
  await page.waitForTimeout(300)
}

try {
  /* ── ① 语料对账（构建期就该一致，这里守住「语料没漏生成」）── */
  await safe('搜索语料题目数与题库索引一致', () => {
    const n = UNIFIED.docs.filter((d) => d.k === 'problem').length
    assert(n === P_IDX.count, `语料 ${n} vs 索引 ${P_IDX.count}`)
    assert(UNIFIED.docs.length === TOTALS.all, `docs ${UNIFIED.docs.length} vs totals.all ${TOTALS.all}`)
    const kinds = [...new Set(UNIFIED.docs.map((d) => d.k))].sort().join(',')
    assert(kinds === 'bug,knowledge,page,problem,ref,viz,viz3d', '类别不齐：' + kinds)
    assert(UNIFIED.docs.every((d) => d.t && d.id && d.k), '有语料缺 id/title/kind')
    return `${UNIFIED.docs.length} 条（${kinds}）`
  })
  check('手册行带深链查询词 q，站内页带路由 u',
    UNIFIED.docs.filter((d) => d.k === 'ref').every((d) => typeof d.q === 'string' && d.q.length > 0)
    && UNIFIED.docs.filter((d) => d.k === 'page').every((d) => typeof d.u === 'string' && d.u.startsWith('/')),
    `ref=${REF_DOC?.q ?? '(无)'} page=${UNIFIED.docs.find((d) => d.k === 'page')?.u ?? '(无)'}`)

  /* ── ② ③ 首页：lazy + 规模数字 + 进度空态 ── */
  await goto('#/')
  await page.waitForSelector('[data-role="home-hero"]', { timeout: 20000 })
  await page.waitForSelector('[data-role="home-scale"]', { timeout: 20000 })
  await safe('首页路由级 lazy：不下载 SearchPage chunk、不下载 727 KB 语料，只拉 totals.json', () => {
    const chunk = reqs.filter((u) => /SearchPage-[^/]*\.js/.test(u))
    const corpus = reqs.filter((u) => u.includes('search/unified.json'))
    const totals = reqs.filter((u) => u.includes('search/totals.json'))
    assert(chunk.length === 0, 'SearchPage chunk 被首页拉了：' + chunk.join(','))
    assert(corpus.length === 0, 'unified.json 被首页拉了')
    assert(totals.length === 1, 'totals.json 请求数 ' + totals.length)
    return '0 chunk / 0 语料 / 1 计数'
  })
  await safe('首页规模数字来自 totals.json（题目数逐位相同，不是硬编码）', async () => {
    const txt = await page.locator('[data-role="home-scale"]').innerText()
    assert(txt.includes(String(TOTALS.problem)), '规模行里没有 ' + TOTALS.problem + '：' + txt.replace(/\n/g, ' '))
    assert(txt.includes(String(TOTALS.knowledge)), '规模行里没有卡片数 ' + TOTALS.knowledge)
    assert(txt.includes(String(TOTALS.viz3d)), '规模行里没有 3D 数 ' + TOTALS.viz3d)
    return txt.replace(/\s+/g, ' ').slice(0, 90)
  })
  await safe('首页无做题记录时给引导（空态而不是空白）', async () => {
    await page.evaluate(() => localStorage.removeItem('cpractice:progress:v1'))
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="home-progress-empty"]', { timeout: 20000 })
    const t = await page.locator('[data-role="home-progress-empty"]').innerText()
    assert(t.length > 20, '空态文案太短：' + t)
    return '空态 ' + t.length + ' 字'
  })
  await safe('首页有记录时显示进度瓦片（播种 2 条：1 通过 1 未通过）', async () => {
    await page.evaluate(() => {
      const now = Date.now()
      const rec = (o) => Object.assign({
        result: 'attempted', attempts: 1, everPassed: false, firstPassedAt: null, firstAttemptAt: now,
        lastAt: now, wrongCount: 1, lastWrongAt: now, wrongDismissedAt: null, lastAnswer: null,
        lastAnswerKind: null, lastAnswerTruncated: false, starred: false, note: '', selfAssessed: false,
      }, o)
      localStorage.setItem('cpractice:progress:v1', JSON.stringify({
        version: 1,
        state: { records: { A: rec({ result: 'passed', everPassed: true, wrongCount: 0, lastWrongAt: null }), B: rec({}) } },
      }))
    })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="home-progress-tiles"]', { timeout: 20000 })
    const vals = await page.locator('[data-role="home-stat-value"]').evaluateAll((ns) => ns.map((n) => n.textContent))
    assert(vals[0] === '2', '做过的题应为 2，实际 ' + vals[0])
    assert(vals[1] === '1', '已通过应为 1，实际 ' + vals[1])
    assert(vals[3] === '1', '在册错题应为 1，实际 ' + vals[3])
    return vals.join(' / ')
  })
  await safe('首页 h1 唯一，三大板块卡与工具入口都在', async () => {
    assert(await page.locator('h1').count() === 1, 'h1 数量 ' + await page.locator('h1').count())
    assert(await page.locator('[data-role="home-sections"] a').count() === 3, '板块卡不是 3 张')
    assert(await page.locator('[data-role="home-tool"]').count() >= 6, '工具入口少于 6 个')
    assert(await page.locator('[data-role="home-path-go"]').count() === 1, '学习路径入口缺失')
    assert(await page.locator('[data-role="home-pick-daily"], [data-role="home-pick-random"]').count() === 2, '每日一题/随机练习把手丢了')
    return '3 板块 / ≥6 工具 / 路径 + 每日一题在'
  })

  /* ── ④ 头部搜索框与快捷键 ── */
  await safe('头部搜索框具名且有 label（屏幕阅读器读得出）', async () => {
    const n = await page.locator('label[for="global-search"]').count()
    assert(n === 1, 'label[for=global-search] 数量 ' + n)
    const box = await page.locator('#global-search').boundingBox()
    assert(box && box.height >= 24 && box.width >= 24, '搜索框太小 ' + JSON.stringify(box))
    return `label 1 个，尺寸 ${Math.round(box.width)}×${Math.round(box.height)}`
  })
  await safe('Ctrl+K 聚焦头部搜索框', async () => {
    await page.locator('body').click({ position: { x: 5, y: 400 } })
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(150)
    const id = await page.evaluate(() => document.activeElement?.id)
    assert(id === 'global-search', '焦点在 ' + id)
    return 'focus=#global-search'
  })
  await safe('单键「/」也能聚焦（不在输入控件里时）', async () => {
    await page.locator('body').click({ position: { x: 5, y: 400 } })
    await page.keyboard.press('/')
    await page.waitForTimeout(150)
    const id = await page.evaluate(() => document.activeElement?.id)
    assert(id === 'global-search', '焦点在 ' + id)
    return 'focus=#global-search'
  })
  await safe('头部搜索框回车 → 跳 /search?q=（URL 带编码后的词）', async () => {
    await page.locator('#global-search').fill('指针 野指针')
    await page.locator('#global-search').press('Enter')
    await page.waitForSelector('[data-role="search-page"]', { timeout: 20000 })
    const url = page.url()
    assert(url.includes('#/search?q='), 'URL 不对：' + url)
    assert(decodeURIComponent(url).includes('指针 野指针'), 'q 没带上：' + url)
    const v = await page.locator('[data-role="search-input"]').inputValue()
    assert(v === '指针 野指针', '搜索页输入框没同步：' + v)
    return decodeURIComponent(url.split('#')[1] ?? '')
  })

  /* ── ⑤ ⑥ ⑦ 搜索行为 ── */
  await safe('搜索页等语料下载完（727 KB，只下一次）', async () => {
    await page.waitForSelector('[data-role="search-count"]', { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('[data-role="search-loading"]'), null, { timeout: 30000 })
    const t = await page.locator('[data-role="search-count"]').innerText()
    assert(/命中 \d+ 条/.test(t), '命中数文案不对：' + t)
    return t
  })
  await safe('多类命中：一个常见词至少打中 3 种类别', async () => {
    const chips = await chipCounts()
    const hot = chips.filter((c) => c.kind !== 'all' && c.n > 0 && !c.dis).map((c) => c.kind)
    assert(hot.length >= 3, '只有 ' + hot.length + ' 类命中：' + hot.join(','))
    return hot.join(',')
  })
  await safe('chip 角标口径诚实：0 命中的类别标 0 且禁用，各类别之和 = 全部', async () => {
    const chips = await chipCounts()
    const all = chips.find((c) => c.kind === 'all')
    const per = chips.filter((c) => c.kind !== 'all')
    assert(all && per.length === 7, 'chip 数量不对：' + JSON.stringify(chips))
    assert(per.every((c) => (c.n === 0) === c.dis), 'chip 数字与禁用态不一致：' + JSON.stringify(per))
    const sum = per.reduce((a, c) => a + c.n, 0)
    assert(sum === all.n, `各类别之和 ${sum} ≠ 全部 ${all.n}（说明拿语料总数冒充了命中数）`)
    assert(per.some((c) => c.dis), '这个词居然七类全命中，测不到禁用态：' + JSON.stringify(per))
    return `${per.filter((c) => c.dis).map((c) => c.kind).join(',')} 标 0 且禁用；和 ${sum} = 全部 ${all.n}`
  })
  await safe('类别 chip 过滤真的生效（点一个有命中的类别后只剩它，计数换成过滤口径）', async () => {
    const chips = await chipCounts()
    const target = chips.find((c) => c.kind !== 'all' && !c.dis && c.n > 0)
    assert(target, '没有可点的类别 chip：' + JSON.stringify(chips))
    await page.locator(`[data-role="search-kind"][data-kind="${target.kind}"]`).click()
    await page.waitForTimeout(350)
    const kinds = [...new Set(await resultKinds())]
    assert(kinds.length > 0 && kinds.every((k) => k === target.kind), '过滤后类别：' + kinds.join(','))
    assert(page.url().includes('kind=' + target.kind), 'URL 没记过滤态：' + page.url())
    const after = await chipCounts()
    const allAfter = after.find((c) => c.kind === 'all')
    assert(allAfter.n === target.n, `过滤后「全部」角标 ${allAfter.n} ≠ 该类命中 ${target.n}`)
    assert((await matched()) === target.n, '命中数文案没换成过滤口径')
    await page.locator('[data-role="search-kind"][data-kind="all"]').click()
    await page.waitForTimeout(300)
    assert([...new Set(await resultKinds())].length >= 2, '清除过滤没还原')
    assert(!page.url().includes('kind='), 'URL 没清掉过滤态：' + page.url())
    return `${target.kind} 独占 ${target.n} 条 → 全部还原`
  })
  await safe('AND 语义：多加一个词命中数严格变小', async () => {
    await search('指针')
    const a = await matched()
    await search('指针 哈夫曼')
    const b = await matched()
    assert(a > 0 && b >= 0 && b < a, `指针=${a} 指针+哈夫曼=${b}`)
    return `${a} → ${b}`
  })
  await safe('无结果给空态与建议（不是一片空白）', async () => {
    await search('zzz查无此词qqq')
    await page.waitForSelector('[data-role="search-empty"]', { timeout: 10000 })
    const t = await page.locator('[data-role="search-empty"]').innerText()
    assert(t.includes('没有命中'), '空态文案不对：' + t.slice(0, 60))
    assert(await page.locator('[data-role="search-empty"] li').count() >= 3, '建议条数不足')
    return '空态 + ' + await page.locator('[data-role="search-empty"] li').count() + ' 条建议'
  })
  await safe('空查询给热词（idle 态），点热词直接出结果', async () => {
    await page.locator('[data-role="search-clear"]').click()
    await page.waitForSelector('[data-role="search-idle"]', { timeout: 10000 })
    const n = await page.locator('[data-role="search-suggest"]').count()
    assert(n >= 8, '热词只有 ' + n + ' 个')
    await page.locator('[data-role="search-suggest"]').first().click()
    await page.waitForTimeout(300)
    assert(await matched() > 0, '点热词后 0 命中')
    return n + ' 个热词'
  })
  await safe(`题目 id 直搜：${FIRST_PID} 第一条就是它`, async () => {
    await search(FIRST_PID)
    const first = page.locator('[data-role="search-result"]').first()
    assert(await first.getAttribute('data-id') === FIRST_PID, '第一条是 ' + await first.getAttribute('data-id'))
    assert(await first.getAttribute('data-kind') === 'problem', '类别不对')
    const href = await first.getAttribute('href')
    assert((href ?? '').includes('#/problems/p/' + FIRST_PID), '链接不对：' + href)
    return FIRST_PID
  })
  await safe('命中词高亮（<mark> 真的渲染出来了，且高亮的就是命中的那段）', async () => {
    const marks = page.locator('[data-role="search-result"] mark')
    const n = await marks.count()
    assert(n > 0, '一个 mark 都没有')
    const first = (await marks.first().innerText()).trim()
    assert(first.toLowerCase() === FIRST_PID.toLowerCase(), '首处高亮不是命中的题号：' + first)
    return n + ' 处高亮，首处 ' + first
  })
  await safe('URL 可分享：带 q 刷新后结果还在', async () => {
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="search-result"]', { timeout: 30000 })
    const v = await page.locator('[data-role="search-input"]').inputValue()
    assert(v === FIRST_PID, '刷新后 q 丢了：' + v)
    assert(await matched() > 0, '刷新后 0 命中')
    return 'q=' + v
  })

  /* ── ⑧ 深链承接：手册行 → /cheatsheet?q=，展品 → /bugs?ex= ── */
  await safe(`手册行深链：搜「${REF_DOC.q}」点进去，手册页过滤框已填好`, async () => {
    await search(REF_DOC.q)
    const row = page.locator('[data-role="search-result"][data-kind="ref"]').first()
    assert(await row.count() === 1, '搜不到手册行')
    const href = await row.getAttribute('href')
    assert((href ?? '').includes('#/cheatsheet?q='), '链接不对：' + href)
    await row.click()
    await page.waitForSelector('[data-role="cheatsheet-page"]', { timeout: 20000 })
    const v = await page.locator('[data-role="cheatsheet-search"]').first().evaluate((n) => (n.tagName === 'INPUT' ? n.value : (n.querySelector('input')?.value ?? '')))
    assert(v.trim().length > 0, '手册页搜索框没被填上')
    assert(decodeURIComponent(page.url()).includes(v.trim()), 'URL 与框内词不一致')
    const hits = await page.locator('[data-role="cheatsheet-hits"]').innerText()
    assert(!/0 行|没有/.test(hits), '过滤后 0 行：' + hits)
    return `q=${v} ｜ ${hits.replace(/\s+/g, ' ').slice(0, 40)}`
  })
  await safe(`展品深链：#/bugs?ex=${BUG_ID} 自动展开那件展品`, async () => {
    await goto('#/bugs?ex=' + BUG_ID)
    await page.waitForSelector(`[data-role="bugs-exhibit"][data-id="${BUG_ID}"]`, { timeout: 30000 })
    await page.waitForFunction((id) => {
      const b = document.querySelector(`[data-role="bugs-exhibit"][data-id="${id}"] [data-role="bugs-toggle"]`)
      return b?.getAttribute('aria-expanded') === 'true'
    }, BUG_ID, { timeout: 30000 })
    assert(await page.locator(`[data-role="bugs-exhibit"][data-id="${BUG_ID}"] [data-role="bugs-detail"]`).count() === 1, '详情区没展开')
    return BUG_ID + ' 已展开'
  })

  /* ── ⑩ 375px 与 h1 ── */
  await safe('搜索页 h1 唯一、输入框有可访问名', async () => {
    await goto('#/search?q=' + encodeURIComponent('指针'))
    await page.waitForSelector('[data-role="search-result"]', { timeout: 30000 })
    assert(await page.locator('h1').count() === 1, 'h1 数量 ' + await page.locator('h1').count())
    assert(await page.locator('label[for="search-q"]').count() === 1, 'search-q 没有 label')
    assert(await page.locator('[data-role="search-result"]').first().evaluate((n) => n.tagName === 'A'), '结果不是链接（键盘到不了）')
    return 'h1=1 / label=1 / 结果是 <a>'
  })
  await safe('375px 窄屏无横向溢出（首页 / 搜索页 / 有结果态）', async () => {
    await page.setViewportSize({ width: 375, height: 780 })
    const bad = []
    for (const h of ['#/', '#/search', '#/search?q=' + encodeURIComponent('指针'), '#/cheatsheet', '#/bugs']) {
      await page.goto(BASE + h, { waitUntil: 'load' })
      await page.waitForTimeout(700)
      const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      if (r.s > r.c + 1) bad.push(`${h} ${r.s}>${r.c}`)
    }
    assert(bad.length === 0, bad.join(' | '))
    await page.setViewportSize({ width: 1440, height: 1000 })
    return '5 页均无溢出'
  })

  /* ── 控制台 ── */
  const bad = logs.filter((l) => l.startsWith('error') || l.startsWith('warning'))
  check('全流程控制台 0 error 0 warning 0 pageerror', bad.length === 0 && errs.length === 0,
    bad.length === 0 && errs.length === 0 ? `${logs.length} 条其它消息` : JSON.stringify({ bad: bad.slice(0, 5), errs: errs.slice(0, 3) }).slice(0, 600))
} catch (e) {
  check('搜索验收流程未抛异常', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '))
} finally {
  await browser.close().catch(() => {})
  preview.kill()
}

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 全站搜索 + 首页改版验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exitCode = failed.length > 0 ? 1 : 0
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref()
