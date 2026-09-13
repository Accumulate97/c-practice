/**
 * 任务 3-4「错误博物馆」实测探针：npm run probe:bugs
 *
 * 为什么必须有这一步：展品文案里"会崩 / 会打印什么 / 编译器会警告什么"如果靠手写，就是编故事。
 * 本脚本把 10 件展品的病症代码与正确写法**全部真机跑一遍**（Godbolt，与应用同一份后端实现），
 * 把真实 stdout、退出码、编译器诊断写进 public/data/bugs/observed.json，页面上「上次实测」四个字
 * 才有资格出现。
 *
 * 纪律（与 judge-verify.ts 同口径）：
 *   ① 严格串行 + 尊重 backend.minIntervalMs（并发只会把吞吐从 1.36 QPS 拖到 0.52 QPS）。
 *   ② 传输层错误（5xx / 网络）= 「未判定」，复跑 2 轮；仍失败则**沿用上一次的证据**并标 stale，
 *      绝不把"没测到"写成"测过了"。内容错误（编译失败）不重试，直接如实记录。
 *   ③ 闸门：任何一件展品的任何一段代码编译不过 → 退出码 1（学生点「运行看后果」必须先能编译）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EX_PATH = join(ROOT, 'public', 'data', 'bugs', 'exhibits.json')
const OB_PATH = join(ROOT, 'public', 'data', 'bugs', 'observed.json')

interface Diag { line: number; column: number; severity: string; message: string }
interface ExecResult {
  errorClass: string; compiled: boolean; exitCode: number; stdout: string; stderr: string
  diagnostics: Diag[]; compilerMessage: string; execTimeMs?: number
}
interface RunRequest { code: string; stdin: string; compileOnly?: boolean; userArguments?: string }
interface Backend {
  id: string; maxConcurrency: number; minIntervalMs: number; timeoutMs: number
  execute(req: RunRequest): Promise<ExecResult>
}
type Variant = { code: string; stdin: string }
type Exhibit = { id: string; title: string; buggy: Variant; safe: Variant }
type Observed = Record<string, unknown>

const exhibits = (JSON.parse(readFileSync(EX_PATH, 'utf8')) as { exhibits: Exhibit[] }).exhibits
const prev: { runs?: Record<string, Observed> } = existsSync(OB_PATH) ? JSON.parse(readFileSync(OB_PATH, 'utf8')) : {}

console.log('启动 Vite SSR 以加载应用真实的判分后端…')
const server = await createServer({
  configFile: false,
  root: resolve(ROOT).split('\\').join('/'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
})
let backend: Backend
let cfg: { godboltCompiler: string; userArguments: string }
try {
  const mod = (await server.ssrLoadModule('/src/judge/backends/godbolt.ts')) as { createGodboltBackend: (o: Record<string, unknown>) => Backend }
  const conf = (await server.ssrLoadModule('/src/app/config.ts')) as { judge: typeof cfg }
  backend = mod.createGodboltBackend({})
  cfg = conf.judge
} finally {
  await server.close()
}
console.log(`后端就绪 id=${backend.id} compiler=${cfg.godboltCompiler} args="${cfg.userArguments}" minIntervalMs=${backend.minIntervalMs} timeoutMs=${backend.timeoutMs}`)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const isTransport = (e: unknown): boolean => {
  const m = String((e as Error)?.message ?? e)
  return /HTTP 5\d\d|502|503|504|network|fetch failed|timeout|ETIMEDOUT|ECONNRESET|busy|quota/i.test(m)
}

const runs: Record<string, Observed> = {}
const rows: string[] = []
let stale = 0
let failed = 0

for (const ex of exhibits) {
  for (const variant of ['buggy', 'safe'] as const) {
    const key = `${ex.id}:${variant}`
    const { code, stdin } = ex[variant]
    let res: ExecResult | null = null
    let lastErr = ''
    for (let attempt = 1; attempt <= 3 && res === null; attempt++) {
      try {
        const t0 = Date.now()
        res = await backend.execute({ code, stdin: stdin ?? '' })
        rows.push(`${key} ok ${Date.now() - t0}ms`)
      } catch (e) {
        lastErr = String((e as Error)?.message ?? e).slice(0, 200)
        if (!isTransport(e)) break            // 内容错误不重试
        await sleep(800 * attempt)            // 传输层错误串行复跑
      }
      await sleep(backend.minIntervalMs)
    }
    if (res === null) {
      const carried = prev.runs?.[key]
      if (carried) { runs[key] = { ...carried, stale: true, staleReason: lastErr }; stale++ }
      else { runs[key] = { probed: false, error: lastErr }; failed++ }
      console.log(`⚠ ${key} 未判定（传输层）：${lastErr}${carried ? '｜沿用上次证据并标 stale' : ''}`)
      continue
    }
    runs[key] = {
      probed: true,
      probedAt: new Date().toISOString(),
      errorClass: res.errorClass,
      compiled: res.compiled,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr.slice(0, 800),
      diagnostics: res.diagnostics.map((d) => ({ line: d.line, severity: d.severity, message: d.message.slice(0, 300) })),
      execTimeMs: res.execTimeMs ?? null,
    }
    if (!res.compiled) { failed++; console.log(`✗ ${key} 编译失败（展品代码必须能编译）`) }
    const first = res.stdout.split('\n').filter(Boolean)[0] ?? '(无输出)'
    console.log(`· ${key.padEnd(26)} ${res.errorClass.padEnd(14)} exit=${String(res.exitCode).padEnd(4)} warn=${String(res.diagnostics.length).padEnd(2)} ${first.slice(0, 62)}`)
  }
}

writeFileSync(OB_PATH, JSON.stringify({
  generatedBy: 'scripts/probe-bug-exhibits.ts',
  probedAt: new Date().toISOString(),
  backend: { id: backend.id, compiler: cfg.godboltCompiler, userArguments: cfg.userArguments },
  note: '真实 Godbolt 实测证据（stdout / 退出码 / 编译诊断），页面「上次实测」区块直接引用，不得手改。',
  runs,
}, null, 2) + '\n', 'utf8')

const total = Object.keys(runs).length
const compileFail = Object.values(runs).filter((r) => r.probed === true && r.compiled !== true).length
console.log(`\n实测 ${total} 段代码：编译失败 ${compileFail} · 未判定 ${failed} · 沿用旧证据 ${stale}`)
console.log(`→ public/data/bugs/observed.json`)
if (compileFail || failed) process.exit(1)
