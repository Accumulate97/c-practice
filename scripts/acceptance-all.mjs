// 全站验收批跑器（阶段D 固化，2026-09-13）：npm run acceptance:all
// 替代原 PowerShell 管道批跑。
// 原批跑用 PowerShell 管道重定向，一旦某个套件泄漏 chrome 子进程占住 stdio 句柄，
// 管道就永远等不到 EOF，整批卡死（2026-09-13 list-ui 卡了 15 分钟）。
// 这里改成：监听 child 'exit'（进程本身退出即算完，不等孙进程释放句柄）+ 硬超时 taskkill /T /F。
import { spawn, spawnSync } from 'node:child_process'
import { openSync, closeSync, appendFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// dist 陈旧闸门：所有 *-ui 套件都直接验收 dist 产物，忘了 rebuild 会拿旧代码打分，
// 一整套 FAIL 全是假警报（2026-09-13 踩过）。开跑前先确认 dist 比 src 新。
{
  const newest = (dir) => {
    let best = { mtimeMs: 0, path: '' }
    if (!existsSync(dir)) return best
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(ts|tsx|css)$/.test(e.name)) continue
      const p = join(e.parentPath ?? dir, e.name)
      const m = statSync(p).mtimeMs
      if (m > best.mtimeMs) best = { mtimeMs: m, path: p }
    }
    return best
  }
  const distIdx = 'dist/index.html'
  if (!existsSync(distIdx)) { console.error('dist 不存在 → 先 npm run build'); process.exit(1) }
  const src = newest('src')
  if (src.mtimeMs > statSync(distIdx).mtimeMs) {
    console.error('dist 比源码旧：' + src.path + ' 在上次 build 之后被改过 → 先 npm run build')
    process.exit(1)
  }
}

const SUITES = [
  'acceptance:site-ui', 'acceptance:list-ui', 'acceptance:progress-ui', 'acceptance:viz-ui',
  'acceptance:dbg-ui', 'acceptance:subpath', 'acceptance:stage10', 'acceptance:cc', 'acceptance:dbg',
  'acceptance:viz3d', 'acceptance:playground', 'acceptance:learn', 'acceptance:bugs',
]
const HARD_TIMEOUT_MS = 12 * 60 * 1000
const SUMMARY = 'tmp/acc-summary.txt'
mkdirSync('tmp', { recursive: true })
writeFileSync(SUMMARY, '')

function run(name) {
  const safe = name.replace(':', '_')
  const log = 'tmp/acc-' + safe + '.log'
  const fd = openSync(log, 'w')
  const t0 = Date.now()
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run ' + name], { stdio: ['ignore', fd, fd], windowsHide: true })
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      finish('TIMEOUT', null)
    }, HARD_TIMEOUT_MS)
    function finish(status, code) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { closeSync(fd) } catch {}
      const sec = ((Date.now() - t0) / 1000).toFixed(0)
      appendFileSync(SUMMARY, name + ' ' + status + ' exit=' + code + ' ' + sec + 's\n')
      console.log(name + ' ' + status + ' exit=' + code + ' ' + sec + 's')
      resolve()
    }
    child.on('error', () => finish('ERROR', null))
    child.on('exit', (code, sig) => finish(code === 0 ? 'PASS' : 'FAIL', code === null ? 'sig:' + sig : code))
  })
}

for (const s of SUITES) await run(s)
console.log('ALL DONE')
