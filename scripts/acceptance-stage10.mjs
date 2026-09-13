/**
 * 阶段 10 全站收口 UI 验收：真实浏览器里跑 dist 产物。
 *
 * 与其它 acceptance-*-ui.mjs 同一口径（vite preview → playwright-core → 控制台必须干净），差异在：
 *   ① 期望值一律从 public/data/{knowledge,problems,viz}/index.json 现读，脚本里不抄数量、不抄 id
 *      （通用化硬要求：后续加 _staging 真题 / 数据结构 / 变式题后，这个脚本不改一行也要继续跑）
 *   ② 验的是「三向联动闭环」这条跨板块路径，而不是单个板块内部
 *
 * 用法：npm run build && node scripts/acceptance-stage10.mjs [suite]
 *   suite 省略 = 全跑；可选 list / loop / missing / theme / mobile / errata / search / fallback / a11y / perf / player5 / category
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

/**
 * 无障碍体检（阶段 10-4）：在真实浏览器里算，不靠肉眼。
 * 四条口径：① 交互控件必须有可访问名称（aria-label / 关联 label / 文本）
 *           ② 正文对比度 ≥ 4.5:1，大字（≥24px 或 ≥18.66px 粗体）≥ 3:1（WCAG 1.4.3）
 *           ③ 表格要有名称、表头要有 scope（WCAG 1.3.1）
 *           ④ 点击目标 ≥ 24×24 CSS px（WCAG 2.5.8）；控件裹在 label 里时按 label 的整体算
 * 颜色解析支持 rgb/rgba/hex/oklab/oklch —— Tailwind v4 的半透明底色算出来是 oklab，
 * 只认 rgb 会把白底当成黑底，报一片假阳性（本次打磨踩过）。
 */
function auditA11y() {
  const out = { theme: document.documentElement.dataset.theme, unnamed: [], contrast: [], tables: [], small: [], h1: document.querySelectorAll('h1').length }
  const hidden = (el) => { let n = el; while (n && n.nodeType === 1) { if (n.getAttribute('aria-hidden') === 'true') return true; n = n.parentElement } return false }
  const nm = (el) => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
    const lb = el.getAttribute('aria-labelledby')
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((x) => (x.innerText || '').trim()).join(' '); if (t) return t }
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && (l.innerText || '').trim()) return l.innerText.trim() }
    const wrap = el.closest('label'); if (wrap && (wrap.innerText || '').trim()) return wrap.innerText.trim()
    if (el.tagName === 'IMG') { const a = el.getAttribute('alt'); if (a !== null) return a }
    const tt = el.getAttribute('title'); if (tt && tt.trim()) return tt.trim()
    return (el.innerText || el.textContent || '').trim()
  }
  for (const el of document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab]')) {
    if (el.getAttribute('type') === 'hidden' || hidden(el)) continue
    const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') continue
    const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue
    if (!nm(el)) out.unnamed.push({ t: el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : ''), html: el.outerHTML.slice(0, 110).replace(/\s+/g, ' ') })
    if (el.matches('button,input,select,textarea')) {
      const box = el.closest('label') ?? el
      const br = box.getBoundingClientRect()
      if (br.width < 24 || br.height < 24) out.small.push({ nm: nm(el).slice(0, 20), w: Math.round(br.width), h: Math.round(br.height) })
    }
  }
  for (const el of document.querySelectorAll('img')) { if (!hidden(el) && !el.hasAttribute('alt')) out.unnamed.push({ t: 'img-no-alt', html: el.outerHTML.slice(0, 90) }) }
  for (const tb of document.querySelectorAll('table')) {
    const named = tb.querySelector('caption') !== null || (tb.getAttribute('aria-label') ?? '').length > 0
    const th = [...tb.querySelectorAll('th')]
    if (!named) out.tables.push(`无名称（${(tb.getAttribute('data-role') || tb.className || '').toString().slice(0, 40)}）`)
    else if (th.length > 0 && !th.every((x) => x.getAttribute('scope') !== null)) out.tables.push(`表头缺 scope（${tb.getAttribute('aria-label') ?? ''}）`)
  }
  const toRgb = (c) => {
    c = c.trim()
    let m = c.match(/^rgba?\(([^)]+)\)$/)
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] } }
    m = c.match(/^#([0-9a-f]{3,8})$/i)
    if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map((x) => x + x).join(''); const n = parseInt(h.slice(0, 6), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 } }
    m = c.match(/^ok(lab|lch)\(([^)]+)\)$/)
    if (m) {
      const p = m[2].split(/[\s,/]+/).filter(Boolean).map(Number)
      let L, A, B, al
      if (m[1] === 'oklab') { L = p[0]; A = p[1]; B = p[2]; al = p[3] === undefined ? 1 : p[3] }
      else { L = p[0]; const C = p[1], H = (p[2] || 0) * Math.PI / 180; A = C * Math.cos(H); B = C * Math.sin(H); al = p[3] === undefined ? 1 : p[3] }
      const l_ = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3)
      const m_ = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3)
      const s_ = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3)
      const rr = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
      const gg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
      const bb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
      const f = (v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055 }
      return { r: f(rr) * 255, g: f(gg) * 255, b: f(bb) * 255, a: al }
    }
    return null
  }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  const bgOf = (el) => {
    const stack = []; let n = el
    while (n && n.nodeType === 1) { const c = toRgb(getComputedStyle(n).backgroundColor); if (c) stack.push(c); n = n.parentElement }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i -= 1) { const c = stack[i]; base = c.a >= 1 ? { r: c.r, g: c.g, b: c.b, a: 1 } : over(c, base) }
    return base
  }
  const seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode()) !== null) {
    const text = (node.nodeValue || '').trim(); if (text.length === 0) continue
    const el = node.parentElement; if (el === null || hidden(el)) continue
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue
    const rc = el.getBoundingClientRect(); if (rc.width < 2 || rc.height < 2) continue
    const fgRaw = toRgb(st.color); if (fgRaw === null) continue
    const bg = bgOf(el)
    const fg = fgRaw.a >= 1 ? fgRaw : over(fgRaw, bg)
    const r = ratio(fg, bg)
    const fs = parseFloat(st.fontSize)
    const bold = parseInt(st.fontWeight, 10) >= 700
    const need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5
    if (r < need) {
      const key = `${st.color}|${Math.round(fs)}|${bold ? 1 : 0}|${text.slice(0, 10)}`
      if (!seen.has(key)) {
        seen.add(key)
        out.contrast.push({ r: Number(r.toFixed(2)), need, fs, tag: el.tagName.toLowerCase(), text: text.slice(0, 20), fg: st.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` })
      }
    }
  }
  return out
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
    const pages = ['#/knowledge', `#/knowledge/${chain?.card.id ?? K.cards[0].id}`, '#/problems', `#/problems/p/${P.problems[0].id}`, '#/viz', `#/viz/${V.demos[0].id}`, '#/progress', '#/cheatsheet', '#/bugs', '#/review', '#/']
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

  /* ════ E. 375px 窄屏（阶段 10-4 加强）════ */
  if (want('mobile')) {
    const mctx = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true })
    const mp = await mctx.newPage()
    // 覆盖：三板块列表页 + 四种主力题型 + 两种概念题详情页 + 卡片详情 + 对比页 + 勘误表
    // 目标一律从索引现挑（通用化硬要求：加了 _staging / 数据结构题后这段不用改）
    const pick = (t) => P.problems.find((p) => p.type === t)?.id ?? P.problems[0].id
    const targets = [
      '#/',
      '#/knowledge',
      `#/knowledge/${chain?.card.id ?? K.cards[0].id}`,
      '#/problems',
      `#/problems/p/${pick('programming')}`,
      `#/problems/p/${pick('code_completion')}`,
      `#/problems/p/${pick('debug')}`,
      `#/problems/p/${pick('code_reading')}`,
      `#/problems/p/${pick('single_choice')}`,
      `#/problems/p/${pick('fill_blank')}`,
      '#/viz',
      `#/viz/${V.demos.find((d) => d.renderer === 'bar')?.id ?? V.demos[0].id}`,
      `#/viz/${V.demos.find((d) => d.renderer === 'tree')?.id ?? V.demos[0].id}`,
      '#/viz/compare',
      '#/progress',
      '#/path',
      '#/errata',
      '#/cheatsheet',
      '#/bugs',
      '#/review',
    ]
    const overflow = []
    for (const h of targets) {
      await mp.goto(BASE + h, { waitUntil: 'networkidle' })
      await mp.waitForTimeout(250)
      const r = await mp.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      if (r.s > r.c + 1) overflow.push(`${h} scrollWidth=${r.s} > clientWidth=${r.c}`)
    }
    check(`375px 下 ${targets.length} 个关键页面无横向溢出`, overflow.length === 0, overflow.join('; ') || '全部页面无溢出')

    // 宽表格（题目列表 min-w 58rem）必须靠自己的容器横滚，不能把整个页面撑破
    await mp.goto(BASE + '#/problems', { waitUntil: 'networkidle' })
    await mp.waitForSelector('[data-role="problem-table"]')
    const scroller = await mp.evaluate(() => {
      const box = document.querySelector('[data-role="problem-table"]')?.parentElement
      return {
        inner: box?.scrollWidth ?? 0, outer: box?.clientWidth ?? 0,
        page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth,
      }
    })
    check('375px 下题目宽表格在容器内横滚，页面本身不溢出',
      scroller.inner > scroller.outer && scroller.page <= scroller.view + 1,
      `表格 ${scroller.inner}px > 容器 ${scroller.outer}px；页面 ${scroller.page}/${scroller.view}`)

    // 窄屏作答：提交按钮完整落在视口内（不是被裁掉一半只能看不能点）
    await mp.goto(BASE + `#/problems/p/${pick('code_completion')}`, { waitUntil: 'networkidle' })
    const submit = mp.locator('button:has-text("提交判分")').first()
    await submit.scrollIntoViewIfNeeded()
    const sbox = await submit.boundingBox()
    check('375px 下「提交判分」按钮完整可见可点',
      sbox !== null && sbox.width > 0 && sbox.x >= -1 && sbox.x + sbox.width <= 376,
      sbox === null ? '找不到按钮' : `x=${sbox.x.toFixed(0)} 宽=${sbox.width.toFixed(0)}`)

    // 窄屏播放器：控件可点，且单步真的推进了一步（不是按钮在但点了没反应）
    await mp.goto(BASE + `#/viz/${V.demos.find((d) => d.renderer === 'bar')?.id ?? V.demos[0].id}`, { waitUntil: 'networkidle' })
    await mp.waitForSelector('[data-role="viz-step"]')
    const stepBefore = (await mp.locator('[data-role="viz-step"]').innerText()).trim()
    await mp.locator('button[aria-label="下一步 ▶"]').click()
    await mp.waitForTimeout(250)
    const stepAfter = (await mp.locator('[data-role="viz-step"]').innerText()).trim()
    const btns = await mp.locator('button:visible').count()
    check('375px 下演示播放控件可见可点，单步真的走了一步',
      btns >= 4 && stepBefore !== stepAfter, `可见按钮 ${btns} 个；${stepBefore} → ${stepAfter}`)
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

  /* ════ I. 无障碍（阶段 10-4）════
   * 两条口径：① 机器可测的（可访问名称 / 对比度 / 表格 / 点击目标 / 标题层级）用 auditA11y 在
   *    深浅两主题 × 17 个页面上全量扫，一处不过就算不过；
   * ② 机器不好测的（键盘可操作主流程）用真键盘走一遍：跳转链接 → main、列表 → 详情、播放器快捷键。
   * 主题一律点按钮切，不直接写 localStorage —— persist 的形状是 {state:{mode}}，手写会踩闪白那个坑。
   */
  if (want('a11y')) {
    const byType = (t) => P.problems.find((p) => p.type === t)?.id ?? P.problems[0].id
    const a11yPages = [
      '#/', '#/knowledge', `#/knowledge/${chain?.card.id ?? K.cards[0].id}`, '#/problems',
      `#/problems/p/${byType('programming')}`, `#/problems/p/${byType('code_completion')}`,
      `#/problems/p/${byType('debug')}`, `#/problems/p/${byType('code_reading')}`,
      `#/problems/p/${byType('single_choice')}`, `#/problems/p/${byType('fill_blank')}`,
      '#/viz', `#/viz/${V.demos[0].id}`, '#/viz/compare', '#/progress', '#/path', '#/errata', '#/playground', '#/judge-lab', '#/cheatsheet', '#/bugs', '#/review', '#/nope-404',
    ]
    const a11yBad = []
    for (const theme of ['light', 'dark']) {
      await page.goto(BASE + '#/', { waitUntil: 'networkidle' })
      const cur = await page.evaluate(() => document.documentElement.dataset.theme)
      if (cur !== theme) {
        await page.locator(`button[aria-label="${theme === 'dark' ? '深色' : '浅色'}主题"]`).click()
        await page.waitForTimeout(250)
      }
      for (const h of a11yPages) {
        await page.evaluate((x) => { location.hash = x }, h)
        await page.waitForTimeout(400)
        const r = await page.evaluate(auditA11y)
        if (r.theme !== theme) a11yBad.push(`${h} 主题=${r.theme}≠${theme}`)
        if (r.h1 !== 1) a11yBad.push(`${h}@${theme} h1=${r.h1}`)
        for (const k of ['unnamed', 'contrast', 'tables', 'small']) {
          if (r[k].length > 0) a11yBad.push(`${h}@${theme} ${k}×${r[k].length} ${JSON.stringify(r[k][0]).slice(0, 160)}`)
        }
      }
    }
    check(`无障碍体检：${a11yPages.length} 页 × 深浅两主题全绿（0 无名控件 / 0 对比度不足 / 0 表格缺陷 / 0 点击目标过小 / 每页恰好 1 个 h1）`,
      a11yBad.length === 0, a11yBad.slice(0, 5).join(' | ') || `${a11yPages.length * 2} 次体检 0 问题`)

    /* 键盘：焦点入口 + 跳转链接真的把焦点交给 main */
    // 必须先 about:blank 再回来：hash-only 的 goto 不重载文档，上一段点过的主题按钮还留着焦点，
    // 直接 Tab 会从那儿往后数（本次就这么假失败过一回，报「第一个 Tab 落在 🖥️」）
    await page.goto('about:blank')
    await page.goto(BASE + '#/', { waitUntil: 'networkidle' })
    await page.evaluate(() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur() })
    await page.keyboard.press('Tab')
    const first = await page.evaluate(() => {
      const el = document.activeElement
      const st = el ? getComputedStyle(el) : null
      return { text: (el?.textContent ?? '').trim().slice(0, 24), outline: st ? (parseFloat(st.outlineWidth) || 0) : 0 }
    })
    check('键盘：第一个 Tab 落在「跳到主要内容」跳转链接上，且有可见焦点环（outline ≥ 2px）',
      /跳到主要内容/.test(first.text) && first.outline >= 2, JSON.stringify(first))
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const landed = await page.evaluate(() => document.activeElement?.id ?? '')
    check('键盘：Enter 之后焦点落到 <main id="main">（不用鼠标也能续着往下 Tab）', landed === 'main', `activeElement.id=${landed || '(空)'}`)

    /* 键盘：知识列表 → 卡片详情 */
    await page.goto(BASE + '#/knowledge', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-role="knowledge-list"] [data-role="row"]')
    await page.evaluate(() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur() })
    let tabs = -1
    for (let i = 1; i <= 80; i += 1) {
      await page.keyboard.press('Tab')
      const hit = await page.evaluate(() => (document.activeElement?.getAttribute?.('href') ?? '').startsWith('#/knowledge/'))
      if (hit) { tabs = i; break }
    }
    check('键盘：知识列表页 80 次 Tab 内能聚焦到卡片详情链接', tabs > 0, `第 ${tabs} 次 Tab 命中`)
    if (tabs > 0) {
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => location.hash.startsWith('#/knowledge/') && location.hash.length > '#/knowledge/'.length, null, { timeout: 15000 })
      await page.waitForSelector('[data-role="knowledge-detail"]', { timeout: 15000 })
      check('键盘：Enter 打开卡片详情页（详情可访问名 data-role="knowledge-detail"）', true, await hash())
    }

    /* 键盘：播放器快捷键（空格播放/暂停、← → 单步、Home/End 跳首尾） */
    const kbDemo = V.demos.find((d) => d.renderer === 'bar')?.id ?? V.demos[0].id
    await page.goto(BASE + `#/viz/${kbDemo}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-role="viz-step"]')
    const stepText = async () => (await page.locator('[data-role="viz-step"]').innerText()).trim()
    const s0 = await stepText()
    await page.evaluate(() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur() })
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const playing = await page.locator('button[data-role="viz-play"][aria-label="暂停"]').count()
    await page.keyboard.press('Space')
    await page.waitForTimeout(200)
    const paused = await page.locator('button[data-role="viz-play"][aria-label="播放"]').count()
    check('键盘：演示页空格 = 播放/暂停切换（aria-label 跟着变，读屏能听出状态）', playing === 1 && paused === 1, `播放态 ${playing} 暂停态 ${paused}`)
    await page.keyboard.press('End')
    await page.waitForTimeout(300)
    const sEnd = await stepText()
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(300)
    const sPrev = await stepText()
    await page.keyboard.press('Home')
    await page.waitForTimeout(300)
    const sHome = await stepText()
    check('键盘：End / ← / Home 真的移动了步骤，且 Home 回到第 1 步',
      sEnd !== sPrev && sPrev !== sHome && sHome === s0, `${s0} →End ${sEnd} →← ${sPrev} →Home ${sHome}`)

    /* 读屏：判分结论区必须是 live region，否则结果出来了听屏用户听不见 */
    await page.goto(BASE + `#/problems/p/${byType('single_choice')}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-role="choice-option"], [data-role="option"]', { timeout: 20000 })
    await page.locator('[data-role="choice-option"], [data-role="option"]').first().click()
    await page.waitForSelector('[data-role="verdict"]', { timeout: 20000 })
    const live = await page.evaluate(() => {
      const el = document.querySelector('[data-role="verdict"]')
      return { role: el?.getAttribute('role') ?? '', live: el?.getAttribute('aria-live') ?? '' }
    })
    check('读屏：单选题判定结论区是 role="status" aria-live="polite"（结果自动播报）',
      live.role === 'status' && live.live === 'polite', JSON.stringify(live))
  }

  /* ════ J. 性能：路由级懒加载 + 语料按需拉取（阶段 10-4）════
   * 首页必须零演示体积：播放器 / 填空编辑器 / Markdown 表格都只能待在懒加载 chunk 里，
   * 详情语料（data/viz/{id}.json、题目分片）只能进对应页面才 fetch。
   * 坑：hash-only 导航不会重新加载模块，所以「首页快照」必须真 goto 一次才准。
   */
  if (want('perf')) {
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const pp = await pctx.newPage()
    let jsUrls = []
    let dataUrls = []
    pp.on('response', (res) => {
      const u = res.url()
      if (!u.startsWith(BASE)) return
      const rel = u.slice(BASE.length).split('?')[0]
      if (rel.endsWith('.js')) jsUrls.push(rel)
      else if (u.includes('/data/')) dataUrls.push(rel)   // rel 没有前导斜杠，只能按完整 URL 判
    })
    const jsWith = async (urls, marker) => {
      for (const u of urls) {
        try { if ((await (await fetch(BASE + u)).text()).includes(marker)) return u } catch { /* 忽略 */ }
      }
      return null
    }

    await pp.goto(BASE, { waitUntil: 'networkidle' })
    await pp.waitForTimeout(600)
    const homeJs = [...jsUrls]
    const homeData = [...dataUrls]
    check('首页不预取任何详情语料（data 请求 ≤3 个且全是 index.json，语料留到进页再拉）',
      homeData.length <= 3 && homeData.every((u) => u.endsWith('/index.json')), homeData.join(', ') || '首页 0 个 data 请求')
    const leak = []
    for (const [marker, what] of [['viz-play', '演示播放器'], ['cm-blank-badge', 'CodeMirror 填空编辑器'], ['md-table', 'Markdown 表格']]) {
      if (await jsWith(homeJs, marker) !== null) leak.push(what)
    }
    check('首页 JS 里不含演示播放器 / 填空编辑器 / Markdown 表格（都在路由级懒加载块里，首页零体积）',
      leak.length === 0, leak.length === 0 ? `首页 ${homeJs.length} 个 JS，三项重资产均未出现` : `首页泄漏：${leak.join('、')}`)

    jsUrls = []; dataUrls = []
    const perfDemo = V.demos.find((d) => d.renderer === 'bar')?.id ?? V.demos[0].id
    await pp.evaluate((h) => { location.hash = h }, `#/viz/${perfDemo}`)
    await pp.waitForSelector('[data-role="viz-play"]', { timeout: 20000 })
    await pp.waitForTimeout(800)
    const vizJs = [...jsUrls]
    const vizData = [...dataUrls]
    check('进演示页才加载播放器 chunk', await jsWith(vizJs, 'viz-play') !== null, `新增加载 ${vizJs.length} 个 JS`)
    check('进演示页才按需 fetch 该演示语料 data/viz/{id}.json',
      vizData.some((u) => u.endsWith(`/viz/${perfDemo}.json`)), vizData.join(', ') || '(没拉到任何 data)')

    jsUrls = []; dataUrls = []
    const perfCc = P.problems.find((p) => p.type === 'code_completion')?.id ?? P.problems[0].id
    await pp.evaluate((h) => { location.hash = h }, `#/problems/p/${perfCc}`)
    await pp.waitForSelector('.cm-blank-badge', { timeout: 30000 })
    await pp.waitForTimeout(800)
    const ccJs = [...jsUrls]
    const ccData = [...dataUrls]
    check('进程序填空题才加载填空编辑器 chunk', await jsWith(ccJs, 'cm-blank-badge') !== null, `新增加载 ${ccJs.length} 个 JS`)
    check('进题目详情才按需 fetch 题目分片，且只拉这一片（不整包下载题库）',
      ccData.length >= 1 && ccData.every((u) => u.startsWith('data/problems/') && !u.endsWith('/index.json')), ccData.join(', ') || '(没拉到任何 data)')
    await pctx.close()
  }

  /* ════ K. 播放器抽查（阶段 10-5）：随机 5 套演示，播放 / 单步 / 后退 / 重置四键都真动 ════
   * 抽样口径：以「演示总数」为种子做确定性伪随机抽样 —— 既不写死 id（加演示后自动换样），
   * 也不会每次跑抽到不同一批导致验收结论不可复现。
   */
  if (want('player5')) {
    let seed = V.demos.length * 7919 + 13
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pool = [...V.demos]
    const picks = []
    for (let i = 0; i < Math.min(5, pool.length); i += 1) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
    const readStep = async () => {
      const t = await page.locator('[data-role="viz-step"]').innerText()
      const m = t.match(/(\d+)\s*\/\s*(\d+)/)
      return { i: Number(m?.[1] ?? 0), n: Number(m?.[2] ?? 0) }
    }
    const bad = []
    const trace = []
    for (const d of picks) {
      await page.goto(BASE + `#/viz/${d.id}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-role="viz-step"]', { timeout: 20000 })
      await page.waitForTimeout(250)
      const s0 = await readStep()
      await page.locator('button[data-role="viz-play"]').click()
      await page.waitForTimeout(1200)
      const sPlay = await readStep()
      const playingLabel = await page.locator('button[data-role="viz-play"]').getAttribute('aria-label')
      await page.locator('button[data-role="viz-play"]').click()
      await page.waitForTimeout(300)
      const sPaused = await readStep()
      // 暂停要「停得住」：再等 900ms 复查一次。只等 200ms 会把「读步号 → 点暂停」这段
      // 往返延迟里本来就该走的一步算成 bug（graph-bfs 步间隔短，第一版就是这么假失败的）
      await page.waitForTimeout(900)
      const sStill = await readStep()
      await page.locator('button[aria-label="下一步 ▶"]').click()
      await page.waitForTimeout(250)
      const sNext = await readStep()
      await page.locator('button[aria-label="◀ 上一步"]').click()
      await page.waitForTimeout(250)
      const sPrev = await readStep()
      await page.locator('button[aria-label="⏮ 重置"]').click()
      await page.waitForTimeout(300)
      const sReset = await readStep()
      trace.push(`${d.id}(${s0.i}/${s0.n}→播${sPlay.i}→单步${sNext.i}→退${sPrev.i}→重置${sReset.i})`)
      if (sPlay.i <= s0.i) bad.push(`${d.id} 播放没推进（${s0.i}→${sPlay.i}）`)
      if (playingLabel !== '暂停') bad.push(`${d.id} 播放中 aria-label=${playingLabel}`)
      if (sStill.i !== sPaused.i) bad.push(`${d.id} 点暂停后停不住（${sPaused.i}→${sStill.i}）`)
      if (sPaused.i < s0.n && sNext.i !== sPaused.i + 1) bad.push(`${d.id} 单步没走一步（${sPaused.i}→${sNext.i}）`)
      if (sPrev.i !== sNext.i - 1) bad.push(`${d.id} 后退没退一步（${sNext.i}→${sPrev.i}）`)
      if (sReset.i !== 1) bad.push(`${d.id} 重置没回到第 1 步（→${sReset.i}）`)
    }
    check(`随机抽 ${picks.length} 套演示：播放 / 暂停 / 单步 / 后退 / 重置五键都真动（抽样自索引，不写死 id）`,
      bad.length === 0, bad.length === 0 ? trace.join(' ') : bad.join(' | '))
  }

  /* ════ L. 两个 category（c / ds）都要走得通（阶段 10-5，通用化硬要求第 5 条）════
   * 现在库里 ds 只有 1 道题 + 30 张卡片，将来数据结构 450 题入库时这套断言不用改一行：
   * category 列表、每个 category 的张数、样例题/样例卡片，全部从索引现算。
   */
  if (want('category')) {
    const kCats = [...new Set(K.cards.map((c) => c.category))]
    const pCats = [...new Set(P.problems.map((p) => p.category))]
    await page.goto(BASE + '#/knowledge', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-role="knowledge-list"] [data-role="row"]')
    const opts = await page.locator('select[aria-label="按课程筛选"] option').evaluateAll(
      (els) => els.map((e) => ({ v: e.getAttribute('value') ?? '', t: (e.textContent ?? '').trim() })))
    check(`知识列表「按课程筛选」下拉含索引里出现的全部 category（${kCats.join(' / ')}）+ 全部课程项`,
      opts.length === kCats.length + 1 && kCats.every((c) => opts.some((o) => o.v === c)),
      opts.map((o) => `${o.v || '(全部)'}=${o.t}`).join(' | '))
    const catBad = []
    for (const c of kCats) {
      const expectCount = K.cards.filter((x) => x.category === c).length
      await page.locator('select[aria-label="按课程筛选"]').selectOption(c)
      await page.waitForTimeout(350)
      const got = Number(await page.locator('[data-role="filtered-count"]').innerText())
      const headers = await page.locator('[data-role="group-header"]').allInnerTexts()
      if (got !== expectCount) catBad.push(`${c} 筛出 ${got} ≠ 索引 ${expectCount}`)
      if (headers.length === 0) catBad.push(`${c} 没有分组表头`)
      // 该 category 下随便挑一张卡片，详情页必须能开、标题必须与索引一致
      const sample = K.cards.find((x) => x.category === c)
      await page.goto(BASE + `#/knowledge/${sample.id}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-role="knowledge-detail"]', { timeout: 20000 })
      const kMain = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
      const kTitle = (await page.locator('main h1').innerText()).trim()
      if (!kMain.includes(sample.id) || kTitle.length === 0) catBad.push(`${sample.id} 详情页正文/标题不对：h1=${kTitle.slice(0, 24)}`)
      if (/加载失败|出错了/.test(kMain)) catBad.push(`${sample.id} 详情页出现失败文案`)
      await page.goto(BASE + '#/knowledge', { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-role="knowledge-list"] [data-role="row"]')
    }
    check(`每个 category 筛选后的张数与索引逐条统计一致，且各挑一张卡片详情页都能正确打开（共 ${kCats.length} 类）`,
      catBad.length === 0, catBad.join(' | ') || kCats.map((c) => `${c}=${K.cards.filter((x) => x.category === c).length} 张`).join('，'))

    const pBad = []
    for (const c of pCats) {
      const sample = P.problems.find((p) => p.category === c)
      await page.goto(BASE + '#/problems', { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-role="summary"][data-total]', { timeout: 20000 })
      await page.locator('[data-role="search-input"]').fill(sample.id)
      await page.waitForTimeout(500)
      const rows = await page.locator('[data-role="row"]').evaluateAll((els) => els.map((e) => e.dataset.id ?? ''))
      if (!rows.includes(sample.id)) pBad.push(`${c} 题 ${sample.id} 搜不到（命中 ${rows.length} 行）`)
      await page.goto(BASE + `#/problems/p/${sample.id}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-role="related-knowledge"], [data-role="empty"]', { timeout: 20000 })
      const mainTxt = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
      if (!mainTxt.includes(sample.id)) pBad.push(`${sample.id} 详情页正文里找不到自己的题号`)
      if (/加载失败|出错了/.test(mainTxt)) pBad.push(`${sample.id} 详情页出现失败文案`)
      // 关联卡片：有则必须是本 category 的卡；无则必须是友好空状态，绝不能报错/白屏
      const rel = await page.locator('[data-role="related-knowledge"] a[href^="#/knowledge/"]').evaluateAll(
        (els) => els.map((e) => e.getAttribute('href') ?? ''))
      const relIds = rel.map((h) => h.replace('#/knowledge/', ''))
      if (relIds.length > 0 && !relIds.every((id) => (K.cards.find((k) => k.id === id)?.category ?? c) === c)) {
        pBad.push(`${sample.id} 关联卡片跨了 category：${relIds.slice(0, 3).join(',')}`)
      }
      if (relIds.length === 0 && (await page.locator('[data-role="related-knowledge"]').count()) > 0) {
        const t = (await page.locator('[data-role="related-knowledge"]').innerText()).replace(/\s+/g, ' ')
        if (!/暂无|没有|尚未|无关联/.test(t)) pBad.push(`${sample.id} 无关联卡片却没给空状态文案：${t.slice(0, 50)}`)
      }
    }
    check(`每个 category 的题目：列表搜得到、详情页打得开、关联卡片不跨 category（缺失走空状态）（共 ${pCats.length} 类）`,
      pBad.length === 0, pBad.join(' | ') || pCats.map((c) => `${c}=${P.problems.filter((p) => p.category === c).length} 题`).join('，'))
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
