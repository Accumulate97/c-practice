/**
 * 模块 3（程序填空）UI 验收：真实浏览器里跑 dist 产物。
 *
 * 覆盖 Node 侧验收覆盖不到的三件事：
 *   ① Tab / Shift-Tab 在空位间循环跳转（含绕回），且编号徽标的高亮跟着走
 *   ② 空位的视觉标识真的落地了（.cm-blank 底色 / .cm-blank-badge-active 高亮不是 transparent）
 *   ③ 控制台 error / warning 必须为空
 * 顺带跑一次真实提交（Godbolt 3 组用例）确认「填正确答案 → 判分通过」在浏览器里同样成立，
 * 以及槽外只读被拦下时会给一句人话提示而不是静默吞键。
 *
 * 用 playwright-core + 本机已装的 Chrome（仓库不下载浏览器，与 package.json 现状一致）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4173
const BASE = `http://127.0.0.1:${PORT}/`
const PROBLEM = 'c-ch04-cc-001'
const ANSWERS = { 1: 'y<z', 2: 'x<z', 3: 'x<y' }

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('dist 不存在，请先 npm run build')
  process.exit(1)
}
const cssFile = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.css)/)
if (cssFile) {
  const css = readFileSync(join(ROOT, 'dist', 'assets', cssFile[1]), 'utf8')
  check('dist CSS 含空位槽样式', css.includes('.cm-blank-badge-active') && css.includes('--code-blank-bg'),
    cssFile[1] + ' ' + Math.round(css.length / 1024) + ' kB')
} else {
  check('dist CSS 含空位槽样式', false, 'index.html 里找不到 CSS 引用')
}

const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
})
let previewErr = ''
preview.stderr.on('data', (d) => { previewErr += d.toString() })

async function waitPreview() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch { /* 还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('vite preview 起不来：' + previewErr.slice(0, 400))
}

const consoleMsgs = []
const pageErrors = []

async function main() {
  await waitPreview()
  console.log('vite preview 就绪 → ' + BASE)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('console', (m) => { consoleMsgs.push({ type: m.type(), text: m.text() }) })
  page.on('pageerror', (e) => { pageErrors.push(e.message) })

  await page.goto(BASE + '#/problems/p/' + PROBLEM, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cm-blank-badge', { timeout: 30000 })

  const badgeCount = await page.locator('.cm-blank-badge').count()
  check('空位徽标数量 = blanks 数量', badgeCount === 3, '实际 ' + badgeCount)

  const badgeTexts = await page.locator('.cm-blank-badge').allTextContents()
  check('徽标按顺序编号', badgeTexts.join(',') === '1,2,3', badgeTexts.join(','))

  // ── Tab / Shift-Tab 跳转 ──
  await page.locator('button[title^="跳到空位 1"], button:has-text("空位 1")').first().click()
  const activeSeq = [await activeBadge(page)]
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Tab'); activeSeq.push(await activeBadge(page)) }
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Shift+Tab'); activeSeq.push(await activeBadge(page)) }
  check('Tab 循环 1→2→3→1，Shift-Tab 回绕 1→3→2→1',
    activeSeq.join('>') === '1>2>3>1>3>2>1', activeSeq.join('>'))

  // ── 视觉标识落地 ──
  const styles = await page.evaluate(() => {
    const badge = document.querySelector('.cm-blank-badge-active')
    const cs = badge ? getComputedStyle(badge) : null
    return { badgeBg: cs?.backgroundColor ?? 'none', badgeRadius: cs?.borderRadius ?? 'none' }
  })
  check('聚焦徽标有非透明底色', styles.badgeBg !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(styles.badgeBg),
    'bg=' + styles.badgeBg + ' radius=' + styles.badgeRadius)

  // ── 逐个空位填写（Tab 跳过去时整段选中，打字即替换）──
  await page.locator('button:has-text("空位 1")').first().click()
  for (const idx of [1, 2, 3]) {
    await page.keyboard.type(ANSWERS[idx])
    if (idx < 3) await page.keyboard.press('Tab')
  }
  const filledLabel = await page.locator('text=/已填 \\d+\\/\\d+/').first().innerText().catch(() => '')
  check('三个空位都填上了', filledLabel.includes('已填 3/3'), filledLabel)

  const markCount = await page.locator('.cm-blank').count()
  const focusStyles = await page.evaluate(() => {
    const el = document.querySelector('.cm-blank')
    const cs = el ? getComputedStyle(el) : null
    return { bg: cs?.backgroundColor ?? 'none', borderBottom: cs?.borderBottomWidth + ' ' + cs?.borderBottomColor }
  })
  check('已填内容渲染成带底色/下边框的空位槽', markCount === 3 && !/rgba\(0, 0, 0, 0\)/.test(focusStyles.bg),
    'marks=' + markCount + ' bg=' + focusStyles.bg + ' border=' + focusStyles.borderBottom)

  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-ui-filled.png'), fullPage: false })

  // ── 真实提交（Godbolt 3 组，串行）──
  await page.locator('button:has-text("提交判分")').first().click()
  await page.waitForFunction(
    () => /判分通过：3\/3|未通过：|本次未判定/.test(document.body.innerText),
    null, { timeout: 120000 },
  )
  const verdict = await page.evaluate(() => {
    const m = document.body.innerText.match(/(判分通过：3\/3[^\n]*|未通过：[^\n]*|本次未判定[^\n]*)/)
    return m ? m[1] : '(未找到结论文案)'
  })
  check('填正确答案 → 判分通过', verdict.startsWith('判分通过：3/3'), verdict)

  const textPanel = await page.evaluate(() => {
    const m = document.body.innerText.match(/逐空位文本比对（[^\n]*）/)
    return m ? m[0] : '(未找到文本比对面板)'
  })
  check('文本比对面板显示 3/3 命中参考写法', textPanel.includes('3/3'), textPanel)
  await page.screenshot({ path: join(ROOT, 'tmp', 'acc-ui-verdict.png'), fullPage: true })

  // ── 槽外只读：必须给提示，不是静默吞键 ──
  await page.locator('button:has-text("清空重填")').first().click()
  await page.locator('.cm-content').click({ position: { x: 8, y: 8 } })
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('XX')
  await page.waitForTimeout(300)
  const blockedMsg = await page.evaluate(() => /空位以外的代码是只读的/.test(document.body.innerText))
  check('槽外编辑被拦下并给出人话提示', blockedMsg)

  // ── 控制台必须干净 ──
  const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning')
  check('控制台 error/warn 为空', bad.length === 0 && pageErrors.length === 0,
    bad.length === 0 && pageErrors.length === 0 ? '共 ' + consoleMsgs.length + ' 条 log/其它，0 error 0 warn'
      : JSON.stringify({ bad, pageErrors }).slice(0, 600))
  if (consoleMsgs.length > 0) {
    const kinds = {}
    for (const m of consoleMsgs) kinds[m.type] = (kinds[m.type] ?? 0) + 1
    console.log('     控制台消息类型分布：' + JSON.stringify(kinds))
  }

  await browser.close()
}

async function activeBadge(page) {
  return page.evaluate(() => document.querySelector('.cm-blank-badge-active')?.textContent ?? '-')
}

try {
  await main()
} catch (error) {
  check('UI 验收流程未抛异常', false, error instanceof Error ? error.message : String(error))
} finally {
  preview.kill()
}

const failed = checks.filter((c) => !c.ok)
console.log('\n════ UI 验收汇总 ════')
console.log(`  ${checks.length} 项检查，失败 ${failed.length} 项`)
for (const f of failed) console.log('  FAIL ' + f.name + ' ← ' + f.detail)
process.exitCode = failed.length > 0 ? 1 : 0
// 兜底看门狗（阶段D 补，2026-09-13）：main() 中途抛异常时 browser.close() 被跳过，
// 残留 chrome 子进程会一直占着 stdio 句柄，node 事件循环永不退出 —— 曾把整批验收卡死 15 分钟。
// unref 后不影响正常退出；若 3 秒后仍有句柄赖着不走，按已记录的退出码强制收工。
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref()