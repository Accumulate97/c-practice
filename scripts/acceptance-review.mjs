/**
 * 错题重练 UI 验收（任务 3-5）：npm run acceptance:review
 *
 * 与其它 acceptance-*-ui.mjs 同一口径：dist 产物 → vite preview → playwright-core(chrome) → 控制台必须干净。
 * 不打 Godbolt：复习引擎只消费**已落盘的判分事实**（localStorage 里的 progress 信封），
 * 播种事实 → 断言计划，全链路纯前端可复现。守住七个点：
 *   ① 收录与错题本同源：在册自动收进 1 号箱；出册（做对/已掌握）不删卡
 *   ② 机器事实自动移箱：passed 且时刻比锚点新 → 升箱；lastWrongAt 比锚点新 → 回 1 号箱
 *   ③ sync 幂等：同一事实不消费两次，无新事实的 reload 零 notice
 *   ④ 手动自评：做对升箱排期、做错回 1 号箱留在今天；5 号箱做对 = 毕业 + 墓碑防重新收录
 *   ⑤ 持久化：一切变化落 cpractice:review:v1；读坏先备份原文再重建（计划可丢，原文不丢）
 *   ⑥ 路由级 lazy：首页不下载 ReviewPage chunk
 *   ⑦ 375px 无横向溢出；h1 唯一；交互元素具名且 ≥24px
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 4197
const BASE = `http://127.0.0.1:${PORT}/`
const DAY = 24 * 60 * 60 * 1000
const PKEY = 'cpractice:progress:v1'
const RKEY = 'cpractice:review:v1'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ｜ ' + detail : ''}`)
}
async function safe(name, fn) {
  try { const d = await fn(); check(name, true, d ?? '') } catch (e) { check(name, false, String(e?.message ?? e).slice(0, 300)) }
}

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

const IDX = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'problems', 'index.json'), 'utf8'))
const [A, B, C, D] = IDX.problems.slice(0, 4).map((p) => p.id)

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

/** 播种 localStorage 后必须 reload（goto 同 URL 不会重载，踩过的坑） */
async function seed(fn, arg) {
  await page.evaluate(fn, arg)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
  await page.waitForTimeout(450)
}
const readReview = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), RKEY)
const cardIds = async (sel) => page.locator(sel).evaluateAll((ns) => ns.map((n) => n.getAttribute('data-id')))

/** 一条 schema v1 的判分记录（缺省 = 5 天前机器确证失败 2 次、错题本在册）。在浏览器里执行 */
const REC_FN = `
  (over) => Object.assign({
    result: 'attempted', attempts: 2, everPassed: false, firstPassedAt: null,
    firstAttemptAt: Date.now() - 432000000, lastAt: Date.now() - 432000000,
    wrongCount: 2, lastWrongAt: Date.now() - 432000000, wrongDismissedAt: null,
    lastAnswer: null, lastAnswerKind: null, lastAnswerTruncated: false,
    starred: false, note: '', selfAssessed: false,
  }, over || {})
`

try {
  await page.goto(BASE + '#/', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="skip-link"]')
  await page.waitForTimeout(900)
  await safe('首页不下载 ReviewPage chunk（路由级 lazy 生效）', () => {
    const hit = reqs.filter((u) => /ReviewPage-[^/]*\.js/.test(u))
    if (hit.length) throw new Error(hit.join(','))
    return '0 请求'
  })
  await safe('工具排有「错题重练」入口，指向 #/review', async () => {
    const loc = page.locator('nav a[href="#/review"]')
    if (!(await loc.count())) throw new Error('找不到 /review 链接')
    return (await loc.first().innerText()).trim()
  })

  await page.goto(BASE + '#/review', { waitUntil: 'load' })
  await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
  await page.waitForTimeout(400)

  await safe('无错题时：规则文案完整（五箱 + 1/2/4/7/15 天）+ 空态指引', async () => {
    const rules = (await page.locator('[data-role="review-rules"]').innerText()).replace(/\s+/g, ' ')
    for (const w of ['1 / 2 / 4 / 7 / 15', '错题本', '毕业']) if (!rules.includes(w)) throw new Error('规则缺「' + w + '」')
    if (!(await page.locator('[data-role="review-empty"][data-variant="no-cards"]').count())) throw new Error('缺 no-cards 空态')
    if (await page.locator('[data-role="review-card"]').count()) throw new Error('无进度却有卡')
    return '空态 + 规则齐全'
  })

  await safe('自动收录：播种 2 条错题记录 → 2 张卡进 1 号箱、今天到期、落盘', async () => {
    await seed(([a, b, pk, rk, recSrc]) => {
      const rec = eval(recSrc)
      localStorage.setItem(pk, JSON.stringify({ state: { records: { [a]: rec(), [b]: rec() } }, version: 1 }))
      localStorage.removeItem(rk)
    }, [A, B, PKEY, RKEY, REC_FN])
    await page.waitForSelector('[data-role="review-card"]', { timeout: 10000 })
    const due = await cardIds('[data-role="review-card"]')
    if (due.length !== 2 || !due.includes(A) || !due.includes(B)) throw new Error('到期卡=' + JSON.stringify(due))
    const st = await readReview()
    if (!st || st.cards[A]?.box !== 1 || st.cards[B]?.box !== 1) throw new Error('落盘箱号≠1')
    const dueTxt = (await page.locator('[data-role="review-card"] [data-role="review-due"]').first().innerText()).trim()
    if (!/今天到期|逾期/.test(dueTxt)) throw new Error('到期文案=' + dueTxt)
    const cnt = (await page.locator('[data-role="review-due-count"]').innerText()).replace(/\s+/g, ' ')
    if (!/待复习 2 张/.test(cnt)) throw new Error('计数=' + cnt)
    const notice = (await page.locator('[data-role="review-notice"]').innerText()).replace(/\s+/g, ' ')
    if (!/新收录 2 题/.test(notice)) throw new Error('收录 notice=' + notice)
    return cnt + ' · 两卡都在 1 号箱 · notice 如实播报'
  })

  await safe('手动升箱：点「这次做对了」→ 升 2 号箱、移出到期、排期未来、落盘', async () => {
    await page.locator(`[data-role="review-card"][data-id="${A}"] [data-role="review-promote"]`).click()
    await page.waitForTimeout(500)
    const st = await readReview()
    if (st.cards[A]?.box !== 2) throw new Error('box=' + st.cards[A]?.box)
    if (!(st.cards[A].dueAt > Date.now())) throw new Error('dueAt 没排到未来')
    if (st.cards[A].lastEvent !== 'manual-promote') throw new Error('lastEvent=' + st.cards[A].lastEvent)
    const due = await cardIds('[data-role="review-card"]')
    if (due.includes(A)) throw new Error('升箱后仍在到队列')
    const up = await cardIds('[data-role="review-upcoming-card"]')
    if (!up.includes(A)) throw new Error('未进未来队列')
    const notice = await page.locator('[data-role="review-notice"]').innerText()
    if (!/升到 2 号箱/.test(notice)) throw new Error('notice=' + notice)
    return '箱 2 · 2 天后到期 · 进未来队列'
  })

  await safe('手动降箱：点「还是错了」→ 回 1 号箱、留在今天队列', async () => {
    await page.locator(`[data-role="review-card"][data-id="${B}"] [data-role="review-demote"]`).click()
    await page.waitForTimeout(500)
    const st = await readReview()
    if (st.cards[B]?.box !== 1) throw new Error('box=' + st.cards[B]?.box)
    if (!(st.cards[B].dueAt <= Date.now() + 1000)) throw new Error('dueAt 没留在现在')
    const due = await cardIds('[data-role="review-card"]')
    if (!due.includes(B)) throw new Error('降箱后不在到队列')
    const notice = await page.locator('[data-role="review-notice"]').innerText()
    if (!/回到 1 号箱/.test(notice)) throw new Error('notice=' + notice)
    return '箱 1 · 今天到期 · notice 如实'
  })

  await safe('机器做对自动升箱：改判分记录为 passed → 2 号箱升 3 号箱，dueAt=记录时刻+4天', async () => {
    await seed(([pk, a]) => {
      const env = JSON.parse(localStorage.getItem(pk))
      const now = Date.now()
      Object.assign(env.state.records[a], { result: 'passed', everPassed: true, firstPassedAt: now, lastAt: now, attempts: 3 })
      localStorage.setItem(pk, JSON.stringify(env))
    }, [PKEY, A])
    const st = await readReview()
    const env = await page.evaluate((pk) => JSON.parse(localStorage.getItem(pk)), PKEY)
    const lastAt = env.state.records[A].lastAt
    if (st.cards[A]?.box !== 3) throw new Error('box=' + st.cards[A]?.box)
    if (st.cards[A].lastEvent !== 'machine-passed') throw new Error('lastEvent=' + st.cards[A].lastEvent)
    if (st.cards[A].dueAt !== lastAt + 4 * DAY) throw new Error(`dueAt=${st.cards[A].dueAt} ≠ lastAt+4d=${lastAt + 4 * DAY}`)
    if (st.cards[A].lastEventAt !== lastAt) throw new Error('锚点没存记录时刻（幂等会被破坏）')
    return '箱 2→3 · 排期精确到毫秒 · 锚点=记录时刻'
  })

  await safe('机器做错自动降箱：新 lastWrongAt → 3 号箱回 1 号箱、今天到期', async () => {
    await seed(([pk, rk, c, recSrc]) => {
      const rec = eval(recSrc)
      const penv = JSON.parse(localStorage.getItem(pk))
      penv.state.records[c] = rec({ lastAt: Date.now(), lastWrongAt: Date.now() })
      localStorage.setItem(pk, JSON.stringify(penv))
      const rst = JSON.parse(localStorage.getItem(rk))
      rst.cards[c] = { box: 3, addedAt: Date.now() - 9 * 86400000, dueAt: Date.now() - 86400000, lastEventAt: Date.now() - 2 * 86400000, lastEvent: 'manual-promote' }
      localStorage.setItem(rk, JSON.stringify(rst))
    }, [PKEY, RKEY, C, REC_FN])
    const st = await readReview()
    if (st.cards[C]?.box !== 1) throw new Error('box=' + st.cards[C]?.box)
    if (st.cards[C].lastEvent !== 'machine-failed') throw new Error('lastEvent=' + st.cards[C].lastEvent)
    const due = await cardIds('[data-role="review-card"]')
    if (!due.includes(C)) throw new Error('降箱后不在到队列')
    return '箱 3→1 · 立即到期'
  })

  await safe('sync 幂等：无新事实的 reload 零 notice、零写盘、箱态不变', async () => {
    const before = await readReview()
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
    await page.waitForTimeout(500)
    if (await page.locator('[data-role="review-notice"]').count()) throw new Error('无新事实却弹了 notice')
    const after = await readReview()
    if (after.savedAt !== before.savedAt) throw new Error(`无变化却写盘：savedAt ${before.savedAt} → ${after.savedAt}`)
    if (JSON.stringify(after.cards) !== JSON.stringify(before.cards)) throw new Error('箱态被无事实 sync 改动')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
    await page.waitForTimeout(400)
    const again = await readReview()
    if (again.savedAt !== before.savedAt) throw new Error('第二次 reload 写盘了')
    return '两次 reload：notice 0 · savedAt 不变 · cards 逐字节相同'
  })

  await safe('毕业：5 号箱点「做对了」→ 卡移除 + 墓碑落盘；reload 后不被重新收录', async () => {
    await seed(([pk, rk, d, recSrc]) => {
      const rec = eval(recSrc)
      const penv = JSON.parse(localStorage.getItem(pk))
      penv.state.records[d] = rec()
      localStorage.setItem(pk, JSON.stringify(penv))
      const rst = JSON.parse(localStorage.getItem(rk))
      rst.cards[d] = { box: 5, addedAt: Date.now() - 30 * 86400000, dueAt: Date.now() - 3600000, lastEventAt: Date.now() - 86400000, lastEvent: 'manual-promote' }
      localStorage.setItem(rk, JSON.stringify(rst))
    }, [PKEY, RKEY, D, REC_FN])
    await page.locator(`[data-role="review-card"][data-id="${D}"] [data-role="review-promote"]`).click()
    await page.waitForTimeout(500)
    const notice = await page.locator('[data-role="review-notice"]').innerText()
    if (!/毕业/.test(notice)) throw new Error('notice=' + notice)
    const st1 = await readReview()
    if (st1.cards[D]) throw new Error('毕业了卡还在')
    if (!(st1.graduations?.[D] > 0)) throw new Error('墓碑没落盘')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
    await page.waitForTimeout(500)
    const st2 = await readReview()
    if (st2.cards[D]) throw new Error('reload 后被重新收录（墓碑失效）')
    if (await page.locator(`[data-role="review-card"][data-id="${D}"]`).count()) throw new Error('DOM 里还有 D')
    return '毕业 + 墓碑粘住（进度记录仍在错题本也不重收）'
  })

  await safe('错题本出册不删卡：点过「我已掌握」的题，复习卡继续排期', async () => {
    await seed(([pk, b]) => {
      const penv = JSON.parse(localStorage.getItem(pk))
      penv.state.records[b].wrongDismissedAt = Date.now()
      localStorage.setItem(pk, JSON.stringify(penv))
    }, [PKEY, B])
    const st = await readReview()
    if (!st.cards[B]) throw new Error('出册把卡删了')
    if (st.cards[B].box !== 1) throw new Error('箱号被动过：' + st.cards[B].box)
    const due = await cardIds('[data-role="review-card"]')
    if (!due.includes(B)) throw new Error('B 不在到队列')
    return '已掌握的题照样排期 —— 现在对了 ≠ 记住了'
  })

  await safe('读坏先备份再重建：坏 JSON → issue 如实告知 + 备份键存在 + 计划从进度重算', async () => {
    await seed(([rk]) => { localStorage.setItem(rk, '{{{ 这不是 JSON') }, [RKEY])
    const issue = await page.locator('[data-role="review-issue"]').innerText()
    if (!/备份/.test(issue)) throw new Error('issue=' + issue)
    const backed = await page.evaluate((rk) => Object.keys(localStorage).filter((k) => k.startsWith(rk + ':backup:')), RKEY)
    if (!backed.length) throw new Error('没有备份键')
    const st = await readReview()
    if (!st.cards[C] || st.cards[C].box !== 1) throw new Error('C 没从进度重算回来')
    if (!st.cards[D] || st.cards[D].box !== 1) throw new Error('D 没重收（墓碑随坏数据丢了，如实重收是对的）')
    if (st.cards[A] || st.cards[B]) throw new Error('passed/已掌握的题不该被重收')
    return issue.slice(0, 60) + '…'
  })

  await safe('375px 窄屏无横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
    await page.waitForTimeout(400)
    const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
    if (r.s > r.c) throw new Error(`scrollWidth=${r.s} > clientWidth=${r.c}`)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[data-role="review-due-count"]', { timeout: 20000 })
    await page.waitForTimeout(300)
    return `scrollWidth=${r.s}`
  })

  await safe('无障碍抽查：唯一 h1 + 交互元素具名且 ≥24px（label[for] 计入具名）', async () => {
    const r = await page.evaluate(() => {
      const h1 = document.querySelectorAll('h1').length
      const nm = (el) => {
        const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
        if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && (l.innerText || '').trim()) return l.innerText.trim() }
        const wrap = el.closest('label'); if (wrap && (wrap.innerText || '').trim()) return wrap.innerText.trim()
        const tt = el.getAttribute('title'); if (tt && tt.trim()) return tt.trim()
        return (el.textContent || '').trim()
      }
      const bad = []
      for (const el of document.querySelectorAll('button, input, select, textarea, [role="switch"]')) {
        if (!nm(el)) bad.push((el.outerHTML || '').slice(0, 60))
        const b = el.getBoundingClientRect()
        if (b.width && (b.width < 24 || b.height < 24)) bad.push(`小 ${Math.round(b.width)}x${Math.round(b.height)} ${nm(el).slice(0, 18)}`)
      }
      return { h1, bad: bad.slice(0, 5) }
    })
    if (r.h1 !== 1) throw new Error('h1=' + r.h1)
    if (r.bad.length) throw new Error(JSON.stringify(r.bad))
    return 'h1=1 · 交互元素全部具名且 ≥24px'
  })

  await safe('控制台无 error/warning', () => {
    const bad = logs.filter((l) => l.startsWith('error') || l.startsWith('warning'))
    if (bad.length || errs.length) throw new Error(JSON.stringify([...errs, ...bad]).slice(0, 400))
    return 'clean'
  })
} finally {
  await browser.close()
  preview.kill()
}

const fail = checks.filter((c) => !c.ok)
console.log(`\n错题重练验收：${checks.length - fail.length}/${checks.length} PASS`)
if (perr.trim()) console.log('preview stderr: ' + perr.trim().slice(0, 300))
if (fail.length) { for (const f of fail) console.log('  FAIL ' + f.name + ' ｜ ' + f.detail); process.exit(1) }
