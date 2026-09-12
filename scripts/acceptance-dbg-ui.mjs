/**
 * 模块 4（程序改错）UI 验收：真实浏览器里跑 dist 产物。
 *
 * Node 侧验收（scripts/acceptance-dbg.ts）已经证了判分链路本身；这里只补浏览器里才看得见的四件事：
 *   ① 教学口径：默认 0 泄露（bugs 原文 / fixed_code / 行号都不出现），三级提示逐级点开才展开
 *   ② 第 2 级提示给的是**现算的真实差异行**，不是 bugs 文本里那套行号
 *      （那套行号曾大面积写错，内容返工后仍有部分题不符，故一律现算；逐题对照见 acceptance-dbg.ts 日志）
 *   ③ 不改代码直接提交 → 判分失败面板；改出语法错 → 「编译错误」人话而不是白屏
 *   ④ 控制台 error / warning 必须为空
 * 用 playwright-core + 本机已装的 Chrome（仓库不下载浏览器，与模块 3 UI 验收同一套）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4174
const BASE = `http://127.0.0.1:${PORT}/`
const ID = 'c-ch04-dbg-001'

// 从题片里读真身，避免脚本里再抄一份代码（抄错就白测了）
const shard = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/c-ch04.json'), 'utf8'))
const P = shard.problems.find((x) => x.id === ID)
const BUG_LINES = (() => {
  const a = P.code.split('\n'), b = P.fixed_code.split('\n'), out = []
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? null) !== (b[i] ?? null)) out.push(i + 1)
  return out
})()
const PROSE_LINES = P.bugs.map((t) => Number(/^第\s*(\d+)\s*行/.exec(t)?.[1] ?? 0))
// bugs 原文里独有的词：出现即等于泄题
const LEAK_TOKEN = '赋值运算符'
const BROKEN = P.code.replace('scanf("%d %d %d", &x, &y, &z);', 'scanf("%d %d %d", &x, &y, &z)')

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist 不存在，请先 npm run build'); process.exit(1) }

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

const consoleMsgs = []
const pageErrors = []
const bodyText = (page) => page.evaluate(() => document.body.innerText)

async function submitAndWait(page, verdictRe, timeout = 150000) {
  await page.locator('button:has-text("提交判分")').first().click()
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), verdictRe, { timeout })
  return bodyText(page)
}

async function main() {
  await waitPreview()
  console.log(`vite preview 就绪 → ${BASE}  题目 ${ID}`)
  const same = JSON.stringify([...BUG_LINES].sort((x, y) => x - y)) === JSON.stringify([...PROSE_LINES].sort((x, y) => x - y))
  console.log(`  真实差异行 [${BUG_LINES}]  bugs prose [${PROSE_LINES}]（本题两者${same ? '一致' : '不一致'}；harness 一律以现算的真实差异行为准）`)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(e.message))

  await page.goto(BASE + '#/problems/p/' + ID, { waitUntil: 'networkidle' })
  await page.waitForSelector('textarea[aria-label*="程序改错"]', { timeout: 30000 })

  // ── ① 默认零泄露 ──
  let txt = await bodyText(page)
  const hintCount = await page.locator('[data-hint]').count()
  check('默认不展示任何提示面板', hintCount === 0, 'data-hint 元素 ' + hintCount + ' 个')
  check('默认不泄露 bugs 原文', !txt.includes(LEAK_TOKEN))
  check('默认不泄露 fixed_code', !txt.includes('参考修正代码') && !txt.includes('if (x < y) { t = x; x = y; y = t; }'))
  check('默认不泄露错误处数', !/共有\s*\d+\s*处错误/.test(txt))
  const shown = await page.locator('textarea[aria-label*="程序改错"]').first().inputValue()
  check('编辑器里是带 bug 的原代码', shown === P.code, '首行 ' + shown.split('\n')[0])

  // ── ② 三级提示阶梯 ──
  await page.locator('button:has-text("提示 1")').first().click()
  txt = await bodyText(page)
  check('提示 1：揭示错误处数', (await page.locator('[data-hint="1"]').count()) === 1 && txt.includes(`${P.bugs.length} 处错误`), `本题共有 ${P.bugs.length} 处错误`)
  check('提示 1 仍不泄露行号与原因', !txt.includes(LEAK_TOKEN))

  await page.locator('button:has-text("提示 2")').first().click()
  txt = await bodyText(page)
  const lineSentence = (txt.match(/需要改动的行：[^\n]*/) ?? [''])[0]
  check('提示 2：揭示行号面板', (await page.locator('[data-hint="2"]').count()) === 1)
  check('提示 2 行号 = 现算真实差异行', BUG_LINES.every((n) => lineSentence.includes(`第 ${n} 行`)), lineSentence)
  check('提示 2 不再复述 prose 的错误行号', PROSE_LINES.filter((n) => !BUG_LINES.includes(n)).every((n) => !lineSentence.includes(`第 ${n} 行`)),
    `prose [${PROSE_LINES}] vs 真实 [${BUG_LINES}]`)
  check('提示 2 仍不泄露错误原因', !txt.includes(LEAK_TOKEN))

  await page.locator('button:has-text("提示 3")').first().click()
  txt = await bodyText(page)
  check('提示 3：揭示错误原因（bugs 原文）', (await page.locator('[data-hint="3"] li').count()) === P.bugs.length && txt.includes(LEAK_TOKEN), `${P.bugs.length} 条`)
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-dbg-hints.png'), fullPage: true })

  // ── ③ 不改代码直接提交 → 判分失败 ──
  txt = await submitAndWait(page, '未通过：|本次未判定|判分通过')
  const badLine = (txt.match(/未通过：[^\n]*/) ?? txt.match(/本次未判定[^\n]*/) ?? [''])[0]
  check('不改代码直接提交 → 判分失败', badLine.startsWith('未通过：'), badLine)
  check('失败给出人话状态「✗ 输出不符」', txt.includes('✗ 输出不符'))
  check('失败时仍不泄露 fixed_code', !txt.includes('参考修正代码'))
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-dbg-fail.png'), fullPage: true })

  // ── ④ 改出语法错误 → compile-error 面板，不崩 ──
  await page.locator('textarea[aria-label*="程序改错"]').first().fill(BROKEN)
  txt = await submitAndWait(page, '未通过：|本次未判定|判分通过')
  check('删分号 → 显示「✗ 编译错误」而非崩溃', txt.includes('✗ 编译错误'), (txt.match(/未通过：[^\n]*/) ?? [''])[0])
  check('编译错误面板带诊断行号', /第\s*\d+\s*行/.test(txt))
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-dbg-compile-error.png'), fullPage: true })

  // ── ⑤ 改对全部 bug → 判分通过 + 揭示 fixed_code 与解析 ──
  await page.locator('textarea[aria-label*="程序改错"]').first().fill(P.fixed_code)
  txt = await submitAndWait(page, '判分通过：3\\/3|未通过：|本次未判定')
  const okLine = (txt.match(/判分通过：[^\n]*/) ?? txt.match(/未通过：[^\n]*/) ?? [''])[0]
  check('改对全部 bug → 判分通过 3/3', okLine.startsWith('判分通过：3/3'), okLine)
  check('答对后揭示 fixed_code 与完整解析', txt.includes('答对了！参考修正代码与完整解析') && txt.includes('完整解析') && txt.includes(P.fixed_code.split('\n')[5].trim()))
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-dbg-solved.png'), fullPage: true })

  // ── ⑥ 恢复原始代码 ──
  await page.locator('button:has-text("恢复原始代码")').first().click()
  const back = await page.locator('textarea[aria-label*="程序改错"]').first().inputValue()
  check('恢复原始代码按钮有效', back === P.code)

  // ── ⑦ 控制台必须干净 ──
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('控制台 error/warn 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? `共 ${consoleMsgs.length} 条其它消息，0 error 0 warn 0 pageerror`
      : JSON.stringify({ bad: bad.slice(0, 6), pageErrors: pageErrors.slice(0, 3) }).slice(0, 800))
  if (consoleMsgs.length) {
    const kinds = {}
    for (const m of consoleMsgs) kinds[m.type] = (kinds[m.type] ?? 0) + 1
    console.log('     控制台消息类型分布：' + JSON.stringify(kinds))
  }

  await browser.close()
}

try { await main() } catch (e) { check('UI 验收流程未抛异常', false, e instanceof Error ? e.message : String(e)) } finally { preview.kill() }

const failed = checks.filter((c) => !c.ok)
console.log('\n════ 模块 4 UI 验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exitCode = failed.length > 0 ? 1 : 0

// 兜底看门狗（阶段D 补，2026-09-13）：main() 中途抛异常时 browser.close() 被跳过，
// 残留 chrome 子进程会一直占着 stdio 句柄，node 事件循环永不退出 —— 曾把整批验收卡死 15 分钟。
// unref 后不影响正常退出；若 3 秒后仍有句柄赖着不走，按已记录的退出码强制收工。
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref()