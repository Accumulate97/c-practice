// 无障碍专项探针（阶段D 固化，2026-09-13）：npm run a11y:probe
// 复用 scripts/acceptance-stage10.mjs 里那份 auditA11y（避免两份口径漂移），
// 差别在于把「全部」问题打出来 —— stage10 每类只报第 1 条、整体只报前 5 条，定位不全。
// auditA11y 用大括号配平从源文件里抠出来，不依赖行号（行号一变就失效）。
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.A11Y_PORT ?? 4189)
const BASE = `http://127.0.0.1:${PORT}/`

function extractAudit() {
  const src = readFileSync('scripts/acceptance-stage10.mjs', 'utf8')
  const start = src.indexOf('function auditA11y()')
  if (start < 0) throw new Error('在 acceptance-stage10.mjs 里找不到 auditA11y')
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break }
  }
  return eval('(' + src.slice(start, i + 1) + ')')
}
const auditA11y = extractAudit()

const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] })
let perr = ''
preview.stderr.on('data', (d) => { perr += d.toString() })
await new Promise((r) => setTimeout(r, 2500))

const P = JSON.parse(readFileSync('public/data/problems/index.json', 'utf8'))
const K = JSON.parse(readFileSync('public/data/knowledge/index.json', 'utf8'))
const V = JSON.parse(readFileSync('public/data/viz/index.json', 'utf8'))
const byType = (t) => P.problems.find((p) => p.type === t)?.id
// 与 stage10 同一份页面清单（去掉依赖前置流程状态的 chain 卡片，取索引首卡）
const pages = [
  '#/', '#/knowledge', `#/knowledge/${K.cards[0].id}`, '#/problems',
  `#/problems/p/${byType('programming')}`, `#/problems/p/${byType('code_completion')}`,
  `#/problems/p/${byType('debug')}`, `#/problems/p/${byType('code_reading')}`,
  `#/problems/p/${byType('single_choice')}`, `#/problems/p/${byType('fill_blank')}`,
  '#/viz', `#/viz/${V.demos[0].id}`, '#/viz/compare', '#/progress', '#/path', '#/errata', '#/playground', '#/judge-lab', '#/cheatsheet', '#/bugs', '#/review', '#/nope-404',
]

let bad = 0
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    for (const h of pages) {
      await page.evaluate((x) => { location.hash = x }, h)
      await page.waitForTimeout(450)
      const r = await page.evaluate(auditA11y)
      const issues = []
      if (r.h1 !== 1) issues.push(['h1', r.h1])
      for (const k of ['unnamed', 'contrast', 'tables', 'small']) for (const it of r[k]) issues.push([k, it])
      if (issues.length === 0) continue
      bad += issues.length
      console.log(`\n### ${h} @${theme} —— ${issues.length} 处`)
      for (const [k, it] of issues) console.log(`  [${k}] ${JSON.stringify(it)}`)
    }
  }
} finally {
  await browser.close().catch(() => {})
  preview.kill()
}
console.log(bad === 0 ? `\n✅ ${pages.length} 页 × 2 主题 = ${pages.length * 2} 次体检，0 问题` : `\n❌ 合计 ${bad} 处无障碍问题`)
process.exit(bad === 0 ? 0 : 1)
