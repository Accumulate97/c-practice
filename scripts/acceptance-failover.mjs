/**
 * 判分容灾梯队验收（任务 3 / ADR-0002）：npm run acceptance:failover
 *
 * 与其它 acceptance-* 同一口径：check/safe + 无 FAIL 即退出码 0。两点不同，都有理由：
 *   ① 不打浏览器 —— 这一套验的是 src/judge 的模块行为，用 Vite SSR 直接加载**真实模块**
 *      （failover.ts / client.ts / index.ts / godbolt.ts），比在页面里点按钮更贴近契约；
 *   ② 真实网络段允许 SKIP —— AGENTS.md 的口径是「后端抖动 = 未判定，不是失败」。
 *      Godbolt 打不通时把在线检查记成 SKIP 而不是 FAIL，否则 CI 会因为别人家的服务器红。
 *      离线段（故障注入，10 项）永远必须全绿，它才是「切换逻辑对不对」的证据。
 *
 * 用法：
 *   node scripts/acceptance-failover.mjs              # 离线 10 项 + 在线 4 项（约 7 个真实请求，串行）
 *   node scripts/acceptance-failover.mjs --offline    # 只跑离线段（0 请求）
 */
import { createServer } from 'vite'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const OFFLINE = process.argv.includes('--offline')
const GAP_MS = 300

const checks = []
function check(name, ok, detail) {
  const d = detail === undefined ? '' : String(detail)
  checks.push({ name, ok, detail: d })
  const tag = ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL'
  console.log(tag + ' ' + name + (d ? ' ｜ ' + d : ''))
}
async function safe(name, fn) {
  try {
    const r = await fn()
    if (r !== undefined) check(name, true, r)
  } catch (e) { check(name, false, String((e && e.message) || e).slice(0, 300)) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 加载真实模块（与 scripts/judge-verify.ts 同一套 SSR 手法）─────────────
console.log('启动 Vite SSR 以加载应用真实的判分模块…')
const server = await createServer({
  configFile: false,
  root: resolve(ROOT).split('\\').join('/'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
})
let createFailoverBackend, JudgeTransportError, judgeCfg, getBackend, JudgeClient, createGodboltBackend
try {
  const f = await server.ssrLoadModule('/src/judge/failover.ts')
  const t = await server.ssrLoadModule('/src/judge/types.ts')
  const c = await server.ssrLoadModule('/src/app/config.ts')
  const i = await server.ssrLoadModule('/src/judge/index.ts')
  const cl = await server.ssrLoadModule('/src/judge/client.ts')
  const g = await server.ssrLoadModule('/src/judge/backends/godbolt.ts')
  createFailoverBackend = f.createFailoverBackend
  JudgeTransportError = t.JudgeTransportError
  judgeCfg = c.judge
  getBackend = i.getBackend
  JudgeClient = cl.JudgeClient
  createGodboltBackend = g.createGodboltBackend
} finally {
  await server.close()
}

// ── 替身后端：只造「传输层故障」与「执行事实」两类返回，不碰真实网络 ──────
function okResult(stdout) {
  return { errorClass: 'ok', compiled: true, exitCode: 0, stdout: stdout, stderr: '', diagnostics: [], compilerMessage: '' }
}
function compileErrorResult() {
  return {
    errorClass: 'compile-error', compiled: false, exitCode: 1, stdout: '', stderr: '',
    diagnostics: [{ line: 1, column: 1, severity: 'error', message: "expected ';' before '}' token" }],
    compilerMessage: "error: expected ';' before '}' token",
  }
}
/** behavior(req, calls) 返回 ExecutionResult，或抛 JudgeTransportError */
function fake(id, behavior, opts) {
  const o = opts || {}
  const calls = { n: 0 }
  return {
    id: id,
    maxConcurrency: o.maxConcurrency === undefined ? 2 : o.maxConcurrency,
    minIntervalMs: o.minIntervalMs === undefined ? 0 : o.minIntervalMs,
    timeoutMs: o.timeoutMs === undefined ? 25000 : o.timeoutMs,
    calls: calls,
    async execute(req) { calls.n += 1; return behavior(req, calls) },
  }
}
const broken = (id, kind, retryable) => fake(id, () => {
  throw new JudgeTransportError(kind, '负例注入：' + id + ' 必然故障', { retryable: retryable })
})
const REQ = { code: '#include <stdio.h>\nint main(void){ printf("ok\\n"); return 0; }', stdin: '' }

console.log('')
console.log('── 离线段：故障注入，0 真实请求 ──')

await safe('① 梯队装配：链 id 沿用主后端（缓存键与跨标签页锁不变）', async () => {
  const be = getBackend()
  if (be.id !== 'godbolt') throw new Error('链 id 变成 ' + be.id + '，会让既有进度缓存与锁全部失效')
  const chain = be.chain
  if (!Array.isArray(chain)) throw new Error('getBackend() 没有挂梯队（chain 不存在）—— failoverEnabled=' + judgeCfg.failoverEnabled)
  const want = judgeCfg.godboltFailoverTiers.map((c) => 'godbolt:' + c)
  if (chain.length !== 1 + want.length) throw new Error('梯队级数 ' + chain.length + '，配置要求 ' + (1 + want.length))
  for (let k = 0; k < want.length; k += 1) {
    if (chain[k + 1] !== want[k]) throw new Error('第 ' + (k + 2) + ' 级是 ' + chain[k + 1] + '，配置要求 ' + want[k])
  }
  if (be.maxConcurrency !== judgeCfg.maxConcurrency) throw new Error('并发上限被梯队改写：' + be.maxConcurrency)
  return 'chain=' + chain.join(' -> ') + '，并发 ' + be.maxConcurrency + '，间隔 ' + be.minIntervalMs + 'ms'
})

await safe('② 主级 5xx（可重试）→ 自动切到第二级，学生侧拿到正常结果', async () => {
  const t1 = broken('A', 'busy', true)
  const t2 = fake('B', () => okResult('ok\n'))
  const be = createFailoverBackend([t1, t2])
  const r = await be.execute(REQ)
  if (r.stdout !== 'ok\n') throw new Error('拿到的是 ' + JSON.stringify(r.stdout))
  if (t1.calls.n !== 1 || t2.calls.n !== 1) throw new Error('调用次数 A=' + t1.calls.n + ' B=' + t2.calls.n)
  const st = be.stats()
  if (st.switches !== 1) throw new Error('switches=' + st.switches)
  if (st.servedBy.B !== 1) throw new Error('servedBy 记错：' + JSON.stringify(st.servedBy))
  if (!st.unhealthy.A) throw new Error('故障级没进健康记忆，下个请求还要再撞一次')
  return 'A 故障 → B 接手，A 进入 ' + Math.round(st.unhealthy.A / 1000) + 's 冷却'
})

await safe('③ 软超时（不可重试）→ 立即抛出，绝不换级重跑', async () => {
  const t1 = broken('A', 'busy', false)
  const t2 = fake('B', () => okResult('ok\n'))
  const be = createFailoverBackend([t1, t2])
  let threw = null
  try { await be.execute(REQ) } catch (e) { threw = e }
  if (!threw) throw new Error('不可重试的错误被吞掉了，学生等 20s 后还看不到「运行超时」')
  if (t2.calls.n !== 0) throw new Error('第二级被调用了 ' + t2.calls.n + ' 次 —— 死循环会被跑两遍')
  return '抛出 ' + threw.kind + '，第二级 0 次调用'
})

await safe('④ 学生代码编译错误 → 是事实不是故障，不切换', async () => {
  const t1 = fake('A', () => compileErrorResult())
  const t2 = fake('B', () => okResult('ok\n'))
  const be = createFailoverBackend([t1, t2])
  const r = await be.execute(REQ)
  if (r.errorClass !== 'compile-error') throw new Error('errorClass=' + r.errorClass)
  if (t1.calls.n !== 1 || t2.calls.n !== 0) throw new Error('A=' + t1.calls.n + ' B=' + t2.calls.n)
  if (be.stats().switches !== 0) throw new Error('switches=' + be.stats().switches)
  return '只打主级 1 次，编译诊断原样透传'
})

await safe('⑤ 全链故障 → 抛出聚合原因，交给 client 降级（不伪造通过）', async () => {
  const t1 = broken('A', 'busy', true)
  const t2 = broken('B', 'network', true)
  const t3 = broken('C', 'quota', true)
  const be = createFailoverBackend([t1, t2, t3], { cooldownMs: 0 })
  let threw = null
  try { await be.execute(REQ) } catch (e) { threw = e }
  if (!(threw instanceof JudgeTransportError)) throw new Error('抛的不是 JudgeTransportError，client 认不出来')
  if (!/全链不可用/.test(threw.message)) throw new Error('消息没说明是全链故障：' + threw.message)
  for (const id of ['A', 'B', 'C']) if (threw.message.indexOf(id) < 0) throw new Error('消息里缺 ' + id + ' 的失败原因')
  if (be.stats().exhausted !== 1) throw new Error('exhausted=' + be.stats().exhausted)
  return '聚合三级原因：' + threw.message.slice(0, 70) + '…'
})

await safe('⑥ 全链故障时 JudgeClient 仍走既有降级口径', async () => {
  const be = createFailoverBackend([broken('A', 'busy', true), broken('B', 'network', true)], { cooldownMs: 0 })
  const client = new JudgeClient(be, { exclusiveAcrossTabs: false, retries: 0 })
  const r = await client.run(REQ, 'ok')
  if (r.state === 'accepted') throw new Error('后端全灭却判了 accepted —— 这是最危险的假通过')
  if (r.state !== 'backend-unavailable') throw new Error('state=' + r.state + '（无预存输出时应为 backend-unavailable）')
  if (r.source !== 'backend') throw new Error('source=' + r.source)
  return 'state=' + r.state + '，' + r.summary
})

await safe('⑦ 健康记忆：冷却期内直接跳过故障级，不再多打一次', async () => {
  const t1 = broken('A', 'busy', true)
  const t2 = fake('B', () => okResult('ok\n'))
  const be = createFailoverBackend([t1, t2], { cooldownMs: 60000 })
  await be.execute(REQ)
  await be.execute(REQ)
  await be.execute(REQ)
  if (t1.calls.n !== 1) throw new Error('主级被撞了 ' + t1.calls.n + ' 次，冷却没生效')
  if (t2.calls.n !== 3) throw new Error('第二级服务 ' + t2.calls.n + ' 次')
  be.resetHealth()
  await be.execute(REQ)
  if (t1.calls.n !== 2) throw new Error('resetHealth() 后主级没被重新尝试（calls=' + t1.calls.n + '）')
  return '3 次请求只撞主级 1 次；resetHealth() 后恢复探测'
})

await safe('⑧ 墙钟预算闸：整条链超预算就停手，不逐级耗到分钟级', async () => {
  const t1 = broken('A', 'busy', true)
  const slow = fake('B', async () => { await sleep(30); return okResult('ok\n') })
  const t3 = fake('C', () => okResult('never\n'))
  const be = createFailoverBackend([t1, slow, t3], { cooldownMs: 0, budgetMs: 10 })
  let out = ''
  try { const r = await be.execute(REQ); out = 'B 返回 ' + r.stdout.trim() } catch (e) { out = '抛出：' + e.message.slice(0, 50) }
  if (t3.calls.n !== 0) throw new Error('预算已耗尽还去打第三级（calls=' + t3.calls.n + '）')
  return out + '；第三级 0 次调用'
})

await safe('⑨ 结果缓存不受容灾影响：同一请求第二次 0 新增调用', async () => {
  const t1 = broken('A', 'busy', true)
  const t2 = fake('B', () => okResult('ok\n'))
  const be = createFailoverBackend([t1, t2], { cooldownMs: 60000 })
  const client = new JudgeClient(be, { exclusiveAcrossTabs: false, retries: 0 })
  const first = await client.request(REQ)
  const second = await client.request(REQ)
  if (first.cacheHit) throw new Error('首次请求不该命中缓存')
  if (!second.cacheHit) throw new Error('第二次没命中缓存，容灾把缓存键改了')
  if (t2.calls.n !== 1) throw new Error('第二级被打了 ' + t2.calls.n + ' 次')
  return 'cacheHit=true，第二级仍只被打 1 次'
})

await safe('⑩ 梯队参数取最保守一档（为将来混入别的厂商留余地）', async () => {
  const t1 = fake('A', () => okResult('x'), { maxConcurrency: 2, minIntervalMs: 100, timeoutMs: 25000 })
  const t2 = fake('B', () => okResult('x'), { maxConcurrency: 1, minIntervalMs: 500, timeoutMs: 30000 })
  const be = createFailoverBackend([t1, t2])
  if (be.maxConcurrency !== 1) throw new Error('并发取了 ' + be.maxConcurrency + '，应取最小 1')
  if (be.minIntervalMs !== 500) throw new Error('间隔取了 ' + be.minIntervalMs + '，应取最大 500')
  if (be.timeoutMs !== 30000) throw new Error('超时取了 ' + be.timeoutMs + '，应取最大 30000')
  return '并发 1 / 间隔 500ms / 超时 30s'
})

// ── 在线段：真实 Godbolt，串行 + 间隔，打不通记 SKIP ─────────────────────
const SUMSQ = {
  code: '#include <stdio.h>\nint main(void) {\n  int n;\n  if (scanf("%d", &n) != 1) return 1;\n  long long s = 0;\n  for (int i = 1; i <= n; i += 1) s += (long long)i * i;\n  printf("%lld\\n", s);\n  return 0;\n}\n',
  stdin: '100\n',
}

if (OFFLINE) {
  console.log('')
  console.log('── 在线段：--offline 已跳过 ──')
  for (const n of ['⑪ 真实梯队各级可用', '⑫ 判分口径跨级一致（同一代码同一输出）', '⑬ 主链路未受影响（默认后端真跑 accepted）', '⑭ 真实故障注入：主级 502 学生仍拿到 accepted']) {
    check(n, 'skip', '--offline')
  }
} else {
  console.log('')
  console.log('── 在线段：真实 Godbolt，严格串行 ──')
  const realPrimary = createGodboltBackend({})
  const realTiers = judgeCfg.godboltFailoverTiers.map((c) => createGodboltBackend({ id: 'godbolt:' + c, compiler: c }))

  await safe('⑪ 真实梯队各级可用', async () => {
    const lines = []
    for (const be of [realPrimary].concat(realTiers)) {
      let r
      try { r = await be.execute(REQ) } catch (e) {
        check('⑪ 真实梯队各级可用', 'skip', be.id + ' 打不通（' + e.kind + '），按「后端抖动=未判定」跳过')
        return undefined
      }
      if (r.errorClass !== 'ok' || r.stdout.trim() !== 'ok') throw new Error(be.id + ' 返回异常：' + r.errorClass + ' / ' + JSON.stringify(r.stdout))
      lines.push(be.id + (r.execTimeMs === undefined ? '' : ' ' + r.execTimeMs + 'ms'))
      await sleep(GAP_MS)
    }
    return lines.join('、')
  })

  await safe('⑫ 判分口径跨级一致（同一代码同一输出）', async () => {
    const outs = []
    for (const be of [realPrimary, realTiers[0]]) {
      if (!be) continue
      let r
      try { r = await be.execute(SUMSQ) } catch (e) {
        check('⑫ 判分口径跨级一致（同一代码同一输出）', 'skip', be.id + ' 打不通（' + e.kind + '）')
        return undefined
      }
      if (r.errorClass !== 'ok') throw new Error(be.id + ' errorClass=' + r.errorClass + ' ' + r.compilerMessage.slice(0, 120))
      outs.push({ id: be.id, stdout: r.stdout })
      await sleep(GAP_MS)
    }
    if (outs.length < 2) throw new Error('梯队不足两级，无法交叉验证')
    if (outs[0].stdout !== outs[1].stdout) throw new Error('两级输出不同：' + JSON.stringify(outs))
    if (outs[0].stdout.trim() !== '338350') throw new Error('输出与预期不符：' + JSON.stringify(outs[0].stdout))
    return 'scanf 读到 stdin，' + outs[0].id + ' 与 ' + outs[1].id + ' 都得 ' + outs[0].stdout.trim()
  })

  await safe('⑬ 主链路未受影响（默认后端真跑 accepted）', async () => {
    const client = new JudgeClient(getBackend(), { exclusiveAcrossTabs: false, retries: 0 })
    let r
    try { r = await client.run(REQ, 'ok') } catch (e) {
      check('⑬ 主链路未受影响（默认后端真跑 accepted）', 'skip', '打不通（' + e.kind + '）')
      return undefined
    }
    if (r.degraded || r.source !== 'backend') throw new Error('走了降级：' + r.state + ' / ' + r.source)
    if (r.state !== 'accepted') throw new Error('state=' + r.state + '，' + r.summary)
    return 'state=accepted' + (r.execTimeMs === undefined ? '' : '，execTime ' + r.execTimeMs + 'ms')
  })

  await safe('⑭ 真实故障注入：主级 502 学生仍拿到 accepted', async () => {
    if (!realTiers[0]) throw new Error('配置里没有第二级，无法做真实注入')
    const brokenPrimary = broken('godbolt(注入 502)', 'busy', true)
    const be = createFailoverBackend([brokenPrimary, realTiers[0]], { cooldownMs: 60000 })
    const client = new JudgeClient(be, { exclusiveAcrossTabs: false, retries: 0 })
    let r
    try { r = await client.run(REQ, 'ok') } catch (e) {
      check('⑭ 真实故障注入：主级 502 学生仍拿到 accepted', 'skip', '第二级也打不通（' + e.kind + '）')
      return undefined
    }
    if (r.state !== 'accepted') throw new Error('state=' + r.state + '，容灾没兜住：' + r.summary)
    const st = be.stats()
    if (st.switches !== 1) throw new Error('switches=' + st.switches)
    if (!st.servedBy[realTiers[0].id]) throw new Error('接手级没记进 servedBy：' + JSON.stringify(st.servedBy))
    return '主级 502 → ' + realTiers[0].id + ' 接手，学生侧 accepted（无感）'
  })
}

const fails = checks.filter((c) => c.ok === false)
const skips = checks.filter((c) => c.ok === 'skip')
const passes = checks.filter((c) => c.ok === true)
console.log('')
console.log('容灾验收：' + passes.length + ' PASS / ' + skips.length + ' SKIP / ' + fails.length + ' FAIL（共 ' + checks.length + ' 项）')
if (fails.length > 0) {
  for (const f of fails) console.log('  FAIL ' + f.name + ' ｜ ' + f.detail)
  process.exit(1)
}
process.exit(0)
