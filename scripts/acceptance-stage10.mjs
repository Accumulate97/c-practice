/**
 * 阶段 10 全站收口 UI 验收：真实浏览器里跑 dist 产物。
 *
 * 与其它 acceptance-*-ui.mjs 同一口径（vite preview → playwright-core → 控制台必须干净），差异在：
 *   ① 期望值一律从 public/data/{knowledge,problems,viz}/index.json 现读，脚本里不抄数量、不抄 id
 *      （通用化硬要求：后续加 _staging 真题 / 数据结构 / 变式题后，这个脚本不改一行也要继续跑）
 *   ② 验的是「三向联动闭环」这条跨板块路径，而不是单个板块内部
 *
 * 用法：npm run build && node scripts/acceptance-stage10.mjs [suite]
 *   suite 省略 = 全跑；可选 list / loop / missing / theme / mobile / errata / search / fallback
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4179
const BASE = `http://127.0.0.1:${PORT}/`
const SUITE = process.argv[2] ?? ''

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', rel), 'utf8'))
const K = readJson('knowledge/index.json')
const P = readJson('problems/index.json')
const V = readJson('viz/index.json')

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + String(detail).slice(0, 300) : ''}`)
}

/* ---------- 从索引现算「卡片 → 演示 → 题目 → 卡片」的一条可走通链路 ---------- */
const cardsByViz = new Map()
for (const c of K.cards) for (const v of c.relatedViz ?? []) {
  if (!cardsByViz.has(v)) cardsByViz.set(v, [])
  cardsByViz.get(v).push(c)
}
/** 索引里不含 relatedKnowledge（只有详情页要，没必要进索引），按需从分片现读 */
const shardCache = new Map()
function fullCard(id) {
  const entry = K.cards.find((c) => c.id === id)
  if (!entry) return null
  if (!shardCache.has(entry.file)) shardCache.set(entry.file, readJson(`knowledge/${entry.file}`).cards ?? [])
  return shardCache.get(entry.file).find((c) => c.id === id) ?? null
}

const cardsByProblem = new Map()
for (const c of K.cards) for (const pid of c.relatedProblems ?? []) {
  if (!cardsByProblem.has(pid)) cardsByProblem.set(pid, [])
  cardsByProblem.get(pid).push(c)
}
const vizIds = new Set(V.demos.map((d) => d.id))
const problemIds = new Set(P.problems.map((p) => p.id))

/** 演示页的关联题目 = 演示直连 ∪ 关联卡片再跳一跳（与 RelatedForViz 同口径） */
function vizRelatedProblems(demoId) {
  const demo = V.demos.find((d) => d.id === demoId)
  const direct = demo?.relatedProblems ?? []
  const via = (cardsByViz.get(demoId) ?? []).flatMap((c) => c.relatedProblems ?? [])
  return [...new Set([...direct, ...via])].filter((id) => problemIds.has(id))
}
/** 题目页的关联卡片 = 倒排直连 ∪ 同课程同章（与 RelatedCardsForProblem 同口径，上限 8） */
function problemRelatedCards(problemId) {
  const direct = cardsByProblem.get(problemId) ?? []
  const seen = new Set(direct.map((c) => c.id))
  const prob = P.problems.find((p) => p.id === problemId)
  const same = prob
    ? K.cards.filter((c) => !seen.has(c.id) && c.category === prob.category && c.chapter === prob.chapter)
    : []
  return [...direct, ...same].slice(0, 8)
}

const chain = (() => {
  for (const card of K.cards) {
    for (const vid of card.relatedViz ?? []) {
      if (!vizIds.has(vid)) continue
      const problems = vizRelatedProblems(vid)
      for (const pid of problems) {
        const back = problemRelatedCards(pid)
        if (back.length > 0) return { card, vizId: vid, problemId: pid, backCards: back }
      }
    }
  }
  return null
})()

/* ---------- 预览服务器 ---------- */
if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('dist 不存在，请先 npm run build')
  process.exit(1)
}
mkdirSync(join(ROOT, 'tmp'), { recursive: true })
const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let previewErr = ''
preview.stderr.on('data', (d) => { previewErr += d.toString() })
async function waitPreview() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('vite preview 起不来：' + previewErr.slice(0, 400))
}

const consoleMsgs = []
const pageErrors = []
let browser
const want = (name) => SUITE.length === 0 || SUITE === name

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}`)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))

  const hash = () => page.evaluate(() => location.hash)
  const goto = async (h) => {
    await page.goto(BASE + h, { waitUntil: 'networkidle' })
  }
  const noOverflow = async () =>
    page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))

  /* ════ A. 知识卡片列表页 ════ */
  if (want('list')) {
    await goto('#/knowledge')
    await page.waitForSelector('[data-role="knowledge-list"] [data-role="row"]')
    const total = await page.getAttribute('[data-role="summary"]', 'data-total')
    check('列表页卡片总数来自索引（不硬编码）', Number(total) === K.count, `data-total=${total} 索引 count=${K.count}`)

    const rows = await page.locator('[data-role="row"]').count()
    const size = await page.getAttribute('[data-role="summary"]', 'data-rows')
    check('首屏分页渲染（默认 50 张/页，不是一次性铺 345 张）', rows === Number(size) && rows <= 50, `rows=${rows} data-rows=${size}`)

    const groups = new Set()
    for (const c of K.cards) groups.add(`${c.category}|${c.chapter}`)
    const headers = await page.locator('[data-role="group-header"]').allTextContents()
    check('本页章节分组表头数 ≤ 索引里的章节数，且文案来自数据', headers.length > 0 && headers.length <= groups.size,
      `表头 ${headers.length} 个 / 索引 ${groups.size} 章`)

    // 章节筛选：挑一个卡片数不是全部章节的章，验筛出的张数与索引一致
    const target = [...groups].map((key) => {
      const [category, chapter] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
      return { key, category, chapter, n: K.cards.filter((c) => c.category === category && c.chapter === chapter).length }
    }).find((g) => g.n > 0 && g.n < K.count)
    await page.selectOption('select[aria-label="按章节筛选"]', target.key)
    await page.waitForFunction(
      (n) => Number(document.querySelector('[data-role="summary"]')?.getAttribute('data-filtered')) === n,
      target.n,
    )
    const filtered = await page.getAttribute('[data-role="summary"]', 'data-filtered')
    check('章节筛选后的张数与索引逐条统计一致', Number(filtered) === target.n,
      `${target.chapter} → ${filtered} 张（索引 ${target.n} 张）`)

    // 「有演示」快捷筛选：与索引里 relatedViz 非空的卡片数一致
    await page.selectOption('select[aria-label="按章节筛选"]', '')
    const withViz = K.cards.filter((c) => (c.relatedViz ?? []).length > 0).length
    await page.locator('button[aria-pressed]', { hasText: '有演示' }).click()
    await page.waitForFunction((n) => Number(document.querySelector('[data-role="summary"]')?.getAttribute('data-filtered')) === n, withViz)
    check('「🎬 有演示」筛选数 = 索引里 relatedViz 非空的卡片数',
      Number(await page.getAttribute('[data-role="summary"]', 'data-filtered')) === withViz, `${withViz} 张卡片已回填 relatedViz`)

    // 搜索：用一张卡片标题里的连续片段当关键词，命中数必须 ≥1 且包含那张卡片
    await page.locator('button[aria-pressed]', { hasText: '有演示' }).click()
    const probe = K.cards.find((c) => c.title.length >= 4)
    const kw = probe.title.slice(0, 4)
    await page.fill('[data-role="search-input"]', kw)
    await page.waitForTimeout(250)
    const hitIds = await page.locator('[data-role="row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    check('搜索能按标题命中，且命中集合是索引口径的子集',
      hitIds.includes(probe.id) && hitIds.every((id) => K.cards.some((c) => c.id === id)),
      `关键词「${kw}」命中 ${hitIds.length} 张，含 ${probe.id}`)

    // 空状态：一个不可能命中的关键词
    await page.fill('[data-role="search-input"]', 'zzz-不存在的关键词-zzz')
    await page.waitForSelector('[data-role="empty"]')
    const emptyText = (await page.locator('[data-role="empty"]').innerText()).replace(/\s+/g, ' ')
    check('无匹配时显示友好空状态（不是白屏 / 不是报错）', emptyText.includes('没有匹配'), emptyText.slice(0, 80))
    await page.locator('[data-role="empty"] button', { hasText: '清空筛选' }).click()
    await page.waitForSelector('[data-role="row"]')
    check('空状态里能一键清空筛选并回到列表', (await page.locator('[data-role="row"]').count()) > 0)
  }

  /* ════ B. 三向联动闭环：卡片 → 演示 → 题目 → 卡片 ════ */
  if (want('loop')) {
    check('索引里能现算出一条「卡片→演示→题目→卡片」链路', chain !== null,
      chain ? `${chain.card.id} → ${chain.vizId} → ${chain.problemId} → ${chain.backCards.length} 张卡片` : '没有任何一条链路可走')
    if (!chain) throw new Error('链路不存在，闭环无法验收')

    // B1 卡片详情页
    await goto(`#/knowledge/${chain.card.id}`)
    await page.waitForSelector('[data-role="knowledge-detail"]')
    const title = await page.locator('[data-role="card-title"]').innerText()
    check('卡片详情页标题与索引一致', title.trim() === chain.card.title.trim(), `${chain.card.id} → ${title.trim()}`)
    const vizLinks = await page.locator('[data-role="related-viz-link"]').count()
    const expectedViz = (chain.card.relatedViz ?? []).filter((v) => vizIds.has(v)).length
    check('relatedViz 渲染成可点链接，条数与数据一致', vizLinks === expectedViz, `${vizLinks} 条 / 数据 ${expectedViz} 条`)
    const kp = await page.locator('[data-role="keypoints"] li').count()
    check('要点清单渲染（keyPoints）', kp === (chain.card.keyPoints ?? []).length, `${kp} 条`)
    const md = await page.locator('[data-role="markdown"]').count()
    check('正文 content 渲染成 Markdown 块', md >= 1)

    // B2 卡片 → 演示
    await page.locator(`[data-role="related-viz-link"][data-id="${chain.vizId}"]`).click()
    await page.waitForFunction((v) => location.hash === `#/viz/${v}`, chain.vizId)
    await page.waitForSelector('[data-role="viz-title"]')
    const vizTitle = await page.locator('[data-role="viz-title"]').innerText()
    const demo = V.demos.find((d) => d.id === chain.vizId)
    check('卡片 → 演示：跳到播放页且标题正确', vizTitle.trim() === demo.title.trim(), `${chain.vizId} → ${vizTitle.trim()}`)

    // B3 演示页的反向通路
    await page.waitForSelector('[data-role="viz-related"]')
    const backCardIds = await page.locator('[data-role="viz-related-knowledge-link"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    const expectedBack = (cardsByViz.get(chain.vizId) ?? []).slice(0, 8).map((c) => c.id)
    check('演示 → 卡片：relatedViz 倒排反查出的卡片全部可达',
      expectedBack.length > 0 && expectedBack.every((id) => backCardIds.includes(id)),
      `演示页列出 ${backCardIds.length} 张卡片，期望含 ${expectedBack.length} 张`)
    const vizProbIds = await page.locator('[data-role="viz-related-problems-link"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    check('演示 → 题目：关联题目链路可达', vizProbIds.includes(chain.problemId),
      `演示页列出 ${vizProbIds.length} 道题，含 ${chain.problemId}`)

    // B4 演示 → 题目
    await page.locator(`[data-role="viz-related-problems-link"][data-id="${chain.problemId}"]`).click()
    await page.waitForFunction((p) => location.hash === `#/problems/p/${p}`, chain.problemId)
    await page.waitForSelector('[data-role="related-knowledge"]')
    const probCardIds = await page.locator('[data-role="related-knowledge-links-link"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    const expectedProbCards = problemRelatedCards(chain.problemId).map((c) => c.id)
    check('题目 → 卡片：同章反查出的卡片可达', probCardIds.length > 0 && probCardIds[0] === expectedProbCards[0],
      `${chain.problemId} 列出 ${probCardIds.length} 张卡片，首个 ${probCardIds[0]}`)

    // B5 题目 → 卡片，闭环回到知识板块
    await page.locator(`[data-role="related-knowledge-links-link"][data-id="${probCardIds[0]}"]`).click()
    await page.waitForFunction((id) => location.hash === `#/knowledge/${id}`, probCardIds[0])
    await page.waitForSelector('[data-role="knowledge-detail"]')
    const backTitle = await page.locator('[data-role="card-title"]').innerText()
    check('闭环：从题目跳回知识卡片并正确渲染', backTitle.trim().length > 0,
      `${chain.card.id} → ${chain.vizId} → ${chain.problemId} → ${probCardIds[0]}（${backTitle.trim()}）`)

    // B6 relatedKnowledge 横向跳转
    const relatedIds = (fullCard(probCardIds[0])?.relatedKnowledge ?? [])
      .filter((id) => K.cards.some((c) => c.id === id))
    if (relatedIds.length > 0) {
      await page.waitForSelector(`[data-role="related-knowledge-link"][data-id="${relatedIds[0]}"]`)
      // 条数必须在点击前量：点完就跳到下一张卡片了，那时量到的是新卡片的关联区
      const shownRelated = await page.locator('[data-role="related-knowledge-link"]').count()
      await page.locator(`[data-role="related-knowledge-link"][data-id="${relatedIds[0]}"]`).click()
      await page.waitForFunction((id) => location.hash === `#/knowledge/${id}`, relatedIds[0])
      await page.waitForSelector('[data-role="knowledge-detail"]')
      check('卡片 → 卡片：relatedKnowledge 条数与分片一致且横向跳转可达',
        shownRelated === (fullCard(probCardIds[0])?.relatedKnowledge ?? []).filter((id) => K.cards.some((c) => c.id === id)).length,
        `${probCardIds[0]} 列出 ${shownRelated} 张 → 点进 ${relatedIds[0]}`)
    } else {
      const empty = await page.locator('[data-role="related-knowledge-empty"]').count()
      check('无 relatedKnowledge 时显示空状态文案', empty === 1, '这张卡片没有横向关联')
    }

    // B7 同章上一张 / 下一张导航（不写死 id）
    await goto(`#/knowledge/${chain.card.id}`)
    await page.waitForSelector('[data-role="sibling-nav"]')
    const navText = (await page.locator('[data-role="sibling-nav"]').innerText()).replace(/\s+/g, ' ')
    check('同章上一张/下一张导航渲染', navText.includes('本章全部'), navText.slice(0, 90))
  }

  /* ════ C. 404 与空状态 ════ */
  if (want('missing')) {
    await goto('#/knowledge/zz-nope-zz')
    await page.waitForSelector('[data-role="notfound"]')
    check('不存在的卡片 → 404 空状态', (await page.locator('[data-role="notfound"]').innerText()).includes('找不到这张知识卡片'))

    await goto('#/viz/zz-nope-zz')
    await page.waitForSelector('text=找不到这个演示')
    check('不存在的演示 → 404 空状态', true)

    await goto('#/problems/p/zz-nope-zz')
    await page.waitForSelector('text=找不到这道题')
    check('不存在的题目 → 404 空状态', true)

    await goto('#/zz/yy/xx')
    await page.waitForSelector('main')
    const nf = await page.locator('main').innerText()
    check('未知路由 → 全站 404 页', nf.length > 0 && !nf.includes('知识卡片索引加载失败'), nf.replace(/\s+/g, ' ').slice(0, 80))

    // 索引拉不到时列表页给重试，不白屏。
    // 必须新开 context：只改 hash 的 page.goto 不会重新加载文档，
    // loader 里缓存的 indexPromise 早已成功，永远走不到错误态。
    // 这个页故意不挂 console 监听 —— 500 的资源报错是被测行为，不该污染「控制台干净」这一项。
    const ectx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const ep = await ectx.newPage()
    await ep.route('**/data/knowledge/index.json', (route) => route.fulfill({ status: 500, body: 'boom' }))
    await ep.goto(BASE + '#/knowledge', { waitUntil: 'networkidle' })
    await ep.waitForSelector('[data-role="load-error"]')
    const retryBtns = await ep.locator('[data-role="load-error"] button').count()
    check('索引 500 → 列表页显示加载失败 + 重试按钮（不白屏）', retryBtns === 1, `重试按钮 ${retryBtns} 个`)
    // 后端恢复后点重试必须真的重新拉取（loader 失败后清缓存），列表恢复
    await ep.unroute('**/data/knowledge/index.json')
    await ep.locator('[data-role="load-error"] button').click()
    await ep.waitForSelector('[data-role="knowledge-list"] [data-role="row"]', { timeout: 10000 })
    check('重试按钮：后端恢复后能重新拉到索引并渲染列表', true)
    await ectx.close()
  }

  /* ════ D. 深浅色主题 ════ */
  if (want('theme')) {
    const pages = ['#/knowledge', `#/knowledge/${chain?.card.id ?? K.cards[0].id}`, '#/problems', `#/problems/p/${P.problems[0].id}`, '#/viz', `#/viz/${V.demos[0].id}`, '#/progress', '#/']
    const bad = []
    for (const h of pages) {
      await goto(h)
      await page.waitForTimeout(200)
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
        const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        const bodyFg = await page.evaluate(() => getComputedStyle(document.body).color)
        if (bodyBg === bodyFg) bad.push(`${h}@${theme} 前景=背景 ${bodyBg}`)
      }
    }
    check('深浅色主题下 8 个页面前景/背景色都可区分', bad.length === 0, bad.join('; ') || `${pages.length} 页 × 2 主题`)
  }

  /* ════ E. 375px 窄屏 ════ */
  if (want('mobile')) {
    const mctx = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true })
    const mp = await mctx.newPage()
    const targets = [
      '#/knowledge',
      `#/knowledge/${chain?.card.id ?? K.cards[0].id}`,
      '#/problems',
      `#/problems/p/${P.problems.find((p) => p.type === 'code_completion')?.id ?? P.problems[0].id}`,
      `#/problems/p/${P.problems.find((p) => p.type === 'programming')?.id ?? P.problems[0].id}`,
      `#/viz/${V.demos.find((d) => d.renderer === 'bar')?.id ?? V.demos[0].id}`,
      `#/viz/${V.demos.find((d) => d.renderer === 'tree')?.id ?? V.demos[0].id}`,
      '#/progress',
    ]
    const overflow = []
    for (const h of targets) {
      await mp.goto(BASE + h, { waitUntil: 'networkidle' })
      await mp.waitForTimeout(250)
      const r = await mp.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      if (r.s > r.c + 1) overflow.push(`${h} scrollWidth=${r.s} > clientWidth=${r.c}`)
    }
    check('375px 下 8 个关键页面无横向溢出', overflow.length === 0, overflow.join('; ') || '全部页面无溢出')

    // 窄屏下播放器控件与作答按钮可点
    await mp.goto(BASE + `#/viz/${V.demos.find((d) => d.renderer === 'bar')?.id ?? V.demos[0].id}`, { waitUntil: 'networkidle' })
    const btns = await mp.locator('button:visible').count()
    check('375px 下演示播放控件可见可点', btns >= 4, `可见按钮 ${btns} 个`)
    await mctx.close()
  }

  /* ════ F. 勘误表（阶段 10-3） ════ */
  if (want('errata')) {
    await goto('#/')
    await page.waitForSelector('[data-role="errata-link"]')
    await page.locator('[data-role="errata-link"]').click()
    await page.waitForFunction(() => location.hash === '#/errata', null, { timeout: 20000 })
    await page.waitForSelector('[data-role="errata-body"]')
    const bodyText = (await page.locator('[data-role="errata-body"]').innerText()).replace(/\s+/g, ' ')
    check('页脚入口能进勘误表页，正文取自 data/errata.md', bodyText.includes('原书勘误表') && bodyText.includes('处理原则'), `${bodyText.length} 字`)

    // 表格里的题号必须是能点进题目的站内链接，且 id 真的存在于题库索引（防文档写错题号）
    const hrefs = await page.locator('[data-role="errata-body"] a[href^="#/problems/p/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
    check('勘误表里的题号渲染成站内链接（不是死文本）', hrefs.length > 0, `${hrefs.length} 条：${hrefs.slice(0, 3).join(', ')}`)
    const ids = new Set(P.problems.map((x) => x.id))
    const dangling = hrefs.map((h) => h.replace('#/problems/p/', '')).filter((id) => !ids.has(id))
    check('勘误表引用的题目 id 全部存在于题库索引', dangling.length === 0, dangling.length === 0 ? `${hrefs.length} 条全部命中` : `查无此题：${dangling.join(', ')}`)

    const firstId = (hrefs[0] ?? '').replace('#/problems/p/', '')
    await page.locator('[data-role="errata-body"] a[href^="#/problems/p/"]').first().click()
    await page.waitForFunction((id) => location.hash === `#/problems/p/${id}`, firstId, { timeout: 20000 })
    await page.waitForSelector('main h1')
    check('勘误表 → 题目详情：链接可点且落到正确题目', (await page.locator('main').innerText()).includes(firstId), firstId)

    // errata.md 拉不到 → 给重试提示，不白屏（新开 context：hash-only 导航不会重载模块）
    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const ap = await actx.newPage()
    await ap.route('**/data/errata.md', (route) => route.fulfill({ status: 404, body: 'nope' }))
    await ap.goto(BASE + '#/errata', { waitUntil: 'domcontentloaded' })
    await ap.waitForSelector('[data-role="load-error"]')
    check('errata.md 404 → 勘误表页显示失败提示 + 重试（不影响刷题）', (await ap.locator('[data-role="load-error"]').innerText()).includes('勘误表暂时读不到'))
    await actx.close()
  }

  /* ════ G. 题目列表搜索接线（阶段 10-3） ════ */
  if (want('search')) {
    await goto('#/problems')
    await page.waitForSelector('[data-role="summary"][data-total]')
    const total = Number(await page.getAttribute('[data-role="summary"]', 'data-total'))
    check('题目列表页总数来自索引（不硬编码）', total === P.count, `data-total=${total} 索引 count=${P.count}`)
    await page.waitForSelector('[data-role="search-input"]')
    const expectFiltered = (n) => page.waitForFunction(
      (v) => document.querySelector('[data-role="summary"]')?.getAttribute('data-filtered') === String(v), n, { timeout: 15000 })

    // ① 完整题号 → 精确 1 条
    const one = P.problems[0]
    await page.fill('[data-role="search-input"]', one.id)
    await expectFiltered(1)
    const rowIds = await page.locator('[data-role="row"]').evaluateAll((els) => els.map((e) => e.dataset.id))
    check('搜索完整题号 → 精确命中 1 条', rowIds.length === 1 && rowIds[0] === one.id, rowIds.join(','))

    // ② 小节字符串 → 命中数与索引现算一致（口径：id/title/section/chapter/tags 子串）
    const sec = P.problems.map((x) => String(x.section ?? '')).find((v) => v.length > 3) ?? ''
    const expectSec = P.problems.filter((x) => [x.id, x.title, x.section, x.chapter, ...(x.tags ?? [])].join(' ').toLowerCase().includes(sec.toLowerCase())).length
    await page.fill('[data-role="search-input"]', sec)
    await expectFiltered(expectSec)
    check('按小节搜索：命中数与索引现算一致', expectSec > 0, `「${sec}」→ ${expectSec} 条`)

    // ③ 无匹配 → 友好空状态 + 一键清空
    await page.fill('[data-role="search-input"]', 'zzz-不存在的关键词-zzz')
    await page.waitForSelector('[data-role="empty"]')
    const emptyText = (await page.locator('[data-role="empty"]').innerText()).replace(/\s+/g, ' ')
    check('搜索无匹配 → 友好空状态（回显关键词，不白屏）', emptyText.includes('无匹配题目') && emptyText.includes('zzz-不存在的关键词-zzz'), emptyText.slice(0, 90))
    await page.locator('[data-role="empty"] button').click()
    await expectFiltered(P.count)
    check('空状态一键清空筛选 → 回到全量', true, `恢复 ${P.count} 题`)
  }

  /* ════ H. 判分后端全挂时的降级（AGENTS.md 二·5 诚实性红线） ════ */
  if (want('fallback')) {
    // 站内只注册了 godbolt 一个后端（Piston 401 / Judge0 要 key，均经 ADR-0001 裁决否决），
    // 所以「备用后端」验的不是切换，而是**降级必须诚实**：说清未判定、不计正确率、绝不伪造通过。
    const target = P.problems.find((x) => x.type === 'debug') ?? P.problems[0]
    const fctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const fp = await fctx.newPage()
    await fp.route('**://godbolt.org/**', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }))
    await fp.goto(BASE + `#/problems/p/${target.id}`, { waitUntil: 'domcontentloaded' })
    await fp.waitForSelector('button:has-text("提交判分")', { timeout: 30000 })
    await fp.locator('button:has-text("提交判分")').first().click()
    await fp.waitForFunction(() => /本次未判定|判分后端暂不可用/.test(document.body.innerText), null, { timeout: 90000 })
    const txt = (await fp.locator('main').innerText()).replace(/\s+/g, ' ')
    check('Godbolt 全挂（503）→ 走降级：显示「本次未判定」而不是白屏', /本次未判定/.test(txt), txt.slice(0, 110))
    check('降级提示明说「不计正确率、不置 verified」', /不计正确率/.test(txt) && /不置 verified|未判定/.test(txt))
    check('降级态绝不伪造「判分通过」', !txt.includes('判分通过'), target.id)
    await fctx.close()
  }

  /* ════ 控制台 ════ */
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('全流程控制台 error/warn/pageerror 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0
      ? `共 ${consoleMsgs.length} 条其它消息，0 error 0 warn 0 pageerror`
      : JSON.stringify({ bad: bad.slice(0, 6), pageErrors: pageErrors.slice(0, 3) }))
}

try {
  await main()
} catch (e) {
  check('阶段 10 验收流程未抛异常', false, (e instanceof Error ? e.stack : String(e)).split('\n').slice(0, 5).join(' | '))
} finally {
  preview.kill()
  try { await browser?.close() } catch { /* 已关闭 */ }
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n═══ 阶段 10 UI 验收：${checks.length - failed.length}/${checks.length} 通过 ═══`)
for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ' ｜ ' + f.detail : ''}`)
process.exit(failed.length === 0 ? 0 : 1)
