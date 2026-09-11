/**
 * 子目录部署验收：把 dist/ 挂在 http://127.0.0.1:PORT/C-practice/ 下跑真实浏览器。
 *
 * 为什么单独一个脚本：GitHub Pages 项目站点跑在 /<repo>/ 子路径，vite preview 却总是挂在 /，
 * 用 preview 验收等于没验收「相对 base + HashRouter 在子目录下能不能活」。这里用 node:http
 * 起一个最小静态服务器（无依赖、无第三方包），复刻 Pages 的真实路径形态，然后验三件事：
 *   ① 首页与三大板块的数据 JSON 能从相对路径拉到（base './' 生效）
 *   ② 深链刷新（F5）不 404 —— HashRouter 的意义所在
 *   ③ 控制台干净
 *
 * 用法：npm run build && node scripts/acceptance-subpath.mjs [prefix]
 *   prefix 省略 = /C-practice/（与仓库名一致，也就是线上真实前缀）
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4181
const PREFIX = '/' + (process.argv[2] ?? 'C-practice').replace(/^\/+|\/+$/g, '') + '/'
const DIST = join(ROOT, 'dist')
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', rel), 'utf8'))
const P = readJson('problems/index.json')
const K = readJson('knowledge/index.json')
const V = readJson('viz/index.json')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist 不存在，请先 npm run build')
  process.exit(1)
}

/* ---------- 最小静态服务器：dist/ 挂在 PREFIX 下，hash 部分浏览器不会发给服务端 ---------- */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  let pathname = decodeURIComponent(url.pathname)
  if (!pathname.startsWith(PREFIX)) {
    res.writeHead(404).end('not under prefix')
    return
  }
  pathname = pathname.slice(PREFIX.length - 1) || '/index.html'
  const abs = resolve(join(DIST, normalize(pathname).replace(/^(\.\.[/\\])+/, '')))
  if (!abs.startsWith(resolve(DIST) + sep) && abs !== resolve(DIST)) {
    res.writeHead(403).end('forbidden')
    return
  }
  // 目录请求（例如 /C-practice/assets）落到 index.html，不能直接 readFileSync 目录 → EISDIR
  let file = abs
  try {
    if (statSync(abs).isDirectory()) file = join(abs, 'index.html')
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + pathname)
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + pathname)
    return
  }
  try {
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch (e) {
    console.error('静态服务器读文件失败：' + pathname + ' → ' + (e instanceof Error ? e.message : String(e)))
    try { res.writeHead(500).end('500') } catch { /* 响应已结束 */ }
  }
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const checks = []
const consoleMsgs = []
const pageErrors = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + String(detail).slice(0, 260) : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('requestfailed', (r) => consoleMsgs.push({ type: 'error', text: `requestfailed ${r.url()} ${r.failure()?.errorText ?? ''}` }))

  /* A. 站点根与资源都落在子目录下 */
  const root = await fetch(BASE)
  const html = await root.text()
  check('子目录根路径返回 200 且是站点首页', root.status === 200 && html.includes('<div id="root"'), `HTTP ${root.status}`)
  const absoluteRefs = [...html.matchAll(/(?:src|href)="\/(?!\/)/g)].length
  check('首页 HTML 没有以 / 开头的绝对资源引用（子目录部署会 404）', absoluteRefs === 0, `绝对引用 ${absoluteRefs} 处`)

  /* B. 三大板块在子目录下都能拉到 JSON 数据并渲染 */
  const targets = [
    { hash: '#/knowledge', sel: '[data-role="knowledge-list"] [data-role="row"]', label: '知识卡片列表' },
    { hash: '#/problems', sel: '[data-role="problem-table"]', label: '题目列表' },
    { hash: '#/viz', sel: '[data-role="viz-card"]', label: '演示列表' },
  ]
  for (const t of targets) {
    await page.goto(BASE + t.hash, { waitUntil: 'domcontentloaded' })
    // 必须 waitForSelector：isVisible() 不等待，懒加载 chunk + fetch 的竞态会误报
    let ok = false
    try { await page.waitForSelector(t.sel, { timeout: 20000 }) ; ok = true } catch { /* 没渲染出来 */ }
    const n = ok ? await page.locator(t.sel).count() : 0
    check(`${t.label}：相对路径拉到 index.json 并渲染`, ok && n > 0, `${n} 个节点`)
  }

  /* C. 深链刷新（等价 F5）—— GitHub Pages 无 rewrite，HashRouter 必须扛住 */
  const deep = [
    // 题目详情页的 h1 是章节名，题目 id 在徽标里；断言 main 文本含 id 才证明加载的是这一道题
    { hash: `#/problems/p/${P.problems[0].id}`, sel: 'main h1', text: P.problems[0].id },
    { hash: `#/knowledge/${K.cards[0].id}`, sel: '[data-role="knowledge-detail"]', text: K.cards[0].title },
    { hash: `#/viz/${V.demos[0].id}`, sel: '[data-role="viz-canvas"]', text: V.demos[0].title },
  ]
  for (const d of deep) {
    // 整文档加载（不是 SPA 内 hash 跳转），等价于用户在深链上按 F5
    await page.goto(BASE + d.hash, { waitUntil: 'domcontentloaded' })
    let ok = false
    try { await page.waitForSelector(d.sel, { timeout: 20000 }); ok = true } catch { /* 没渲染出来 */ }
    const text = ok ? (await page.locator('main').innerText()).replace(/\s+/g, ' ') : ''
    check(`深链刷新不 404：${d.hash}`, ok && text.includes(d.text.slice(0, 12)), text.slice(0, 60))
  }

  /* D. 控制台干净 */
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('子目录部署全流程控制台 error/warn 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? `0 error 0 warn 0 pageerror` : JSON.stringify({ bad: bad.slice(0, 5), pageErrors: pageErrors.slice(0, 3) }))
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n═══ 子目录部署验收（${PREFIX}）：${checks.length - failed.length}/${checks.length} 通过 ═══`)
for (const f of failed) console.log(`  ✗ ${f.name}`)
process.exit(failed.length === 0 ? 0 : 1)
