/**
 * 可视化语料生成器（阶段 7 · 任务 2）。
 *
 *   输入：算法标识（VIZ_SPECS 的 id）+ 参数（数组长度 n / 输入数据）
 *   输出：public/data/viz/{id}.json —— { id, title, renderer, category, chapter, meta, steps[] }
 *         steps 每项是**完整状态快照**（不是增量 diff），后退只靠下标回退
 *
 * 为什么走 Vite SSR 而不是直接 import：生成器住在 src/ 下（应用真正会用的那份代码），
 * tsconfig 的模块解析、路径别名、TS 语法都由 Vite 统一处理，脚本侧不再维护第二份实现 ——
 * 与 scripts/judge-verify.ts 同一口径（那里加载判分后端，这里加载演示生成器）。
 *
 * 三条纪律：
 *   1. 语料一律脚本生成，禁止手写 JSON（07_可视化演示规范.md）；文件头写死 _generated 标记。
 *   2. 输出必须可复现：不写时间戳（generated_at 会让同一份规格每天产生 git diff 假变更），
 *      只写 generatedBy = gen-viz@<version>；同版本 + 同输入 = 字节相同的语料。
 *   3. 落盘前逐演示校验：n ≤ 50（规范五红线）、每步 description 非空、
 *      snapshot.kind 与 spec.renderer 一致、实际出现的统计键与声明的 counterKeys 完全吻合。
 *      任何一条不过 → 该文件不写，进程退出码 1。
 *
 * 用法：
 *   npm run gen:viz                    重生成全部演示
 *   npm run gen:viz -- sort-bubble     只重生成指定演示（可多个）
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'data', 'viz')
/** 规范五红线：单幅画面元素数不得超过 50，超了既看不清也拖慢渲染 */
const MAX_N = 50
const GENERATED = 'GENERATED — 由 npm run gen:viz 生成，禁止手工编辑（语料必须脚本产出，手改会在下次生成时被覆盖）'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

/** 脚本侧的结构镜像：只声明校验用得到的字段，不从 src/ 反向 import 类型（scripts 的 tsconfig 不含 src） */
interface StepLike {
  description: unknown
  codeLine?: unknown
  snapshot: { kind?: unknown; values?: unknown; roles?: unknown; counters?: unknown } | null
}
interface SpecLike {
  id: string
  title: string
  category: string
  chapter: string
  renderer: string
  algorithm: string
  counterKeys: string[]
  n?: number
  defaultInput?: number[]
  code?: string
  generate: (input: number[]) => StepLike[]
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const failures: string[] = []
const fail = (id: string, msg: string): void => { failures.push(`[${id}] ${msg}`) }

console.log('启动 Vite SSR 以加载应用真实的演示生成器…')
const boot = Date.now()
const server = await createServer({
  configFile: false,
  root: resolve(ROOT).split('\\').join('/'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
})

let written = 0
let totalSteps = 0
try {
  const mod = (await server.ssrLoadModule('/src/modules/viz/algorithms/index.ts')) as {
    VIZ_SPECS: SpecLike[]
    SORT_INPUT: number[]
  }
  const all = mod.VIZ_SPECS
  console.log(`SSR 就绪（${Date.now() - boot} ms）：规格表 ${all.length} 条`)

  const unknown = only.filter((id) => !all.some((s) => s.id === id))
  for (const id of unknown) console.error(`❌ 规格表里没有演示 ${id}`)
  if (unknown.length > 0) failures.push(`未知演示 id：${unknown.join(', ')}`)

  const specs = only.length > 0 ? all.filter((s) => only.includes(s.id)) : all
  mkdirSync(OUT_DIR, { recursive: true })

  for (const spec of specs) {
    // 排序类没显式给输入就用共享的 SORT_INPUT（对比模式要同数据才公平）；
    // 其余演示的生成器不吃输入参数，给空数组即可，也不往 meta.input 里塞无关数据。
    const input = spec.defaultInput ?? (spec.category === 'sort' ? mod.SORT_INPUT : [])
    let steps: StepLike[]
    try {
      steps = spec.generate(input)
    } catch (error) {
      fail(spec.id, `生成器抛错：${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      fail(spec.id, '生成器返回空步骤序列')
      continue
    }

    const n = spec.n ?? (spec.defaultInput ? spec.defaultInput.length : undefined)
    if (n !== undefined && n > MAX_N) fail(spec.id, `n = ${n} 超过上限 ${MAX_N}`)

    const seenCounters = new Set<string>()
    let bad = 0
    for (let i = 0; i < steps.length; i += 1) {
      const st = steps[i]!
      if (typeof st.description !== 'string' || st.description.trim() === '') {
        if (bad === 0) fail(spec.id, `第 ${i + 1} 步缺少 description 解说文字`)
        bad += 1
      }
      const snap = st.snapshot
      if (!snap || typeof snap !== 'object') {
        if (bad === 0) fail(spec.id, `第 ${i + 1} 步缺少 snapshot`)
        bad += 1
        continue
      }
      if (snap.kind !== spec.renderer) {
        if (bad === 0) fail(spec.id, `第 ${i + 1} 步 snapshot.kind = ${String(snap.kind)}，与 renderer = ${spec.renderer} 不一致`)
        bad += 1
      }
      if (snap.kind === 'bar') {
        const values = Array.isArray(snap.values) ? snap.values.length : -1
        const roles = Array.isArray(snap.roles) ? snap.roles.length : -1
        if (values !== roles || values < 0) {
          fail(spec.id, `第 ${i + 1} 步 values(${values}) 与 roles(${roles}) 不等长`)
          bad += 1
        } else if (values > MAX_N) {
          fail(spec.id, `第 ${i + 1} 步柱子 ${values} 根，超过上限 ${MAX_N}`)
          bad += 1
        }
      }
      if (snap.counters && typeof snap.counters === 'object') {
        for (const k of Object.keys(snap.counters as Record<string, unknown>)) seenCounters.add(k)
      }
    }
    if (bad > 0) { fail(spec.id, `共 ${bad} 步不合格，跳过落盘`); continue }

    const declared = [...spec.counterKeys].sort().join(',')
    const observed = [...seenCounters].sort().join(',')
    if (declared !== observed) {
      fail(spec.id, `统计口径不符：声明 counterKeys = [${declared || '空'}]，实际出现 = [${observed || '空'}]`)
      continue
    }

    const demo: Record<string, unknown> = {
      _generated: GENERATED,
      id: spec.id,
      title: spec.title,
      renderer: spec.renderer,
      category: spec.category,
      chapter: spec.chapter,
      relatedProblems: [],
    }
    if (spec.code) demo.code = spec.code
    demo.meta = {
      algorithm: spec.algorithm,
      ...(n !== undefined ? { n } : {}),
      ...(spec.defaultInput ? { input: spec.defaultInput } : {}),
      counterKeys: spec.counterKeys,
      generatedBy: `gen-viz@${pkg.version}`,
    }
    demo.steps = steps

    const body = JSON.stringify(demo, null, 2) + '\n'
    writeFileSync(join(OUT_DIR, `${spec.id}.json`), body, 'utf8')
    written += 1
    totalSteps += steps.length
    const lastCounters = steps[steps.length - 1]!.snapshot?.counters as Record<string, number> | undefined
    const counterText = lastCounters
      ? Object.entries(lastCounters).map(([k, v]) => `${k}=${v}`).join(' ')
      : '（无统计）'
    console.log(`  ✓ ${spec.id.padEnd(22)} ${String(steps.length).padStart(4)} 步  ${counterText}`)
  }

  // 陈旧语料：目录里还在、规格表里已删的文件会污染索引，报出来但不擅自删除
  const specIds = new Set(all.map((s) => s.id))
  if (existsSync(OUT_DIR)) {
    const stale = readdirSync(OUT_DIR).filter(
      (f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json' && !specIds.has(f.replace(/\.json$/, '')),
    )
    for (const f of stale) console.warn(`⚠ 陈旧语料 public/data/viz/${f}（规格表里已无此项，未自动删除）`)
  }
} finally {
  await server.close()
}

console.log(`\n生成 ${written} 个演示语料 / 共 ${totalSteps} 步 → public/data/viz/`)
if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} 处校验失败：`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('✅ 全部演示通过校验（n ≤ 50 / 每步有解说 / kind 与 renderer 一致 / 统计口径吻合）')
console.log('下一步：npm run build:index 把演示收进 public/data/viz/index.json')