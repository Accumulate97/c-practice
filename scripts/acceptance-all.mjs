// 全站验收批跑器（阶段D 固化，2026-09-13）：npm run acceptance:all
// 替代原 PowerShell 管道批跑。
// 原批跑用 PowerShell 管道重定向，一旦某个套件泄漏 chrome 子进程占住 stdio 句柄，
// 管道就永远等不到 EOF，整批卡死（2026-09-13 list-ui 卡了 15 分钟）。
// 这里改成：监听 child 'exit'（进程本身退出即算完，不等孙进程释放句柄）+ 硬超时 taskkill /T /F。
import { spawn, spawnSync } from 'node:child_process'
import { openSync, closeSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SUITES = [
  'acceptance:site-ui', 'acceptance:list-ui', 'acceptance:progress-ui', 'acceptance:viz-ui',
  'acceptance:dbg-ui', 'acceptance:subpath', 'acceptance:stage10', 'acceptance:cc', 'acceptance:dbg',
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
