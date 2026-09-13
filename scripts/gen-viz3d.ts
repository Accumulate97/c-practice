/**
 * 3D 可视化馆专属语料生成器（任务 2）。
 *
 * 与 scripts/gen-viz.ts 同一口径：走 Vite SSR 加载 src/ 里应用真正会用的那份生成器，
 * 不在 scripts 侧维护第二份实现。产出落在 public/data/viz3d/（独立目录，
 * 不进 viz/index.json，因此 2D 馆的列表与 verify:data 的扫描范围都不受影响）。
 *
 * 四道闸门（任何一条不过 → 该文件不写、退出码 1）：
 *   1. 每步 description 非空、snapshot.kind === 'memory'、regions 结构完整；
 *   2. 实际出现的统计键与 spec.counterKeys 完全吻合（防止「声明了却没画」）；
 *   3. n ≤ 50（07 规范五红线），单帧内存格 ≤ 50；
 *   4. relatedProblems 必须是题目索引里真实存在的 id（双向关联不许悬空）。
 *
 * 用法：
 *   npm run gen:viz3d                     重生成全部
 *   npm run gen:viz3d -- mem3d-leak       只重生成指定演示
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'data', 'viz3d')
const MAX_N = 50
const GENERATED = 'GENERATED — 由 npm run gen:viz3d 生成，禁止手工编辑（语料必须脚本产出，手改会在下次生成时被覆盖）'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

interface CellLike { key?: unknown; address?: unknown; value?: unknown; role?: unknown; note?: unknown }
interface RegionLike { key?: unknown; title?: unknown; note?: unknown; cells?: unknown }
interface StepLike { description?: unknown; codeLine?: unknown; snapshot?: { kind?: unknown; regions?: unknown; counters?: unknown } }
interface SpecLike {
  id: string
  title: string
  category: string
  chapter: string
  renderer: string
  algorithm: string
  counterKeys: string[]
  code: string
  n?: number
  related: { chapter: string; keywords: string[]; max: number }
  generate: () => StepLike[]
}

/* ---------- 题目索引：relatedProblems 必须落在真实题目上 ---------- */
const probIndex = JSON.parse(readFileSync(join(ROOT, 'public/data/problems/index.json'), 'utf8')) as {
  problems: { id: string; title?: string; chapter?: string; category?: string }[]
}
function resolveRelated(spec: SpecLike): string[] {
  const { chapter, keywords, max } = spec.related
  const hits: string[] = []
  const seen = new Set<string>()
  // 关键字优先：命中标题的排前面；同分则按索引顺序，保证可复现
  for (const kw of keywords) {
    for (const p of probIndex.problems) {
      if (hits.length >= max) break
      if (p.chapter !== chapter || seen.has(p.id)) continue
      if ((p.title ?? '').includes(kw)) { hits.push(p.id); seen.add(p.id) }
    }
  }
  // 关键字一个都没命中就退回本章前几道，宁可关联略宽也不许悬空
  if (hits.length === 0) {
    for (const p of probIndex.problems) {
      if (hits.length >= max) break
      if (p.chapter === chapter && p.category === 'c') { hits.push(p.id); seen.add(p.id) }
    }
  }
  return hits
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const failures: string[] = []
const fail = (id: string, msg: string): void => { failures.push(`[${id}] ${msg}`) }

console.log('启动 Vite SSR 以加载 3D 语料生成器…')
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
const indexDemos: Record<string, unknown>[] = []
try {
  const mod = (await server.ssrLoadModule('/src/modules/viz3d/generators.ts')) as { VIZ3D_SPECS: SpecLike[] }
  const all = mod.VIZ3D_SPECS
  console.log(`SSR 就绪（${Date.now() - boot} ms）：3D 规格表 ${all.length} 条`)

  const unknown = only.filter((id) => !all.some((s) => s.id === id))
  for (const id of unknown) console.error(`❌ 规格表里没有演示 ${id}`)
  if (unknown.length > 0) failures.push(`未知演示 id：${unknown.join(', ')}`)

  const specs = only.length > 0 ? all.filter((s) => only.includes(s.id)) : all
  mkdirSync(OUT_DIR, { recursive: true })

  for (const spec of specs) {
    let steps: StepLike[]
    try {
      steps = spec.generate()
    } catch (error) {
      fail(spec.id, `生成器抛错：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!Array.isArray(steps) || steps.length === 0) { fail(spec.id, '生成器返回空步骤序列'); continue }
    if (spec.n !== undefined && spec.n > MAX_N) fail(spec.id, `n = ${spec.n} 超过上限 ${MAX_N}`)

    const seenCounters = new Set<string>()
    let bad = 0
    for (let i = 0; i < steps.length; i += 1) {
      const st = steps[i]
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
        fail(spec.id, `第 ${i + 1} 步 snapshot.kind = ${String(snap.kind)}，与 renderer = ${spec.renderer} 不一致`)
        bad += 1
      }
      const regions = snap.regions as RegionLike[] | undefined
      if (!Array.isArray(regions) || regions.length === 0) {
        fail(spec.id, `第 ${i + 1} 步 regions 为空`)
        bad += 1
        continue
      }
      let cellCount = 0
      for (const r of regions) {
        if (typeof r.key !== 'string' || typeof r.title !== 'string') { fail(spec.id, `第 ${i + 1} 步存在缺 key/title 的分区`); bad += 1; break }
        const cells = r.cells as CellLike[]
        if (!Array.isArray(cells)) { fail(spec.id, `第 ${i + 1} 步分区 ${String(r.key)} 的 cells 不是数组`); bad += 1; break }
        for (const c of cells) {
          cellCount += 1
          if (typeof c.key !== 'string' || typeof c.address !== 'string' || typeof c.value !== 'string') {
            fail(spec.id, `第 ${i + 1} 步分区 ${String(r.key)} 存在缺 key/address/value 的内存格`)
            bad += 1
            break
          }
        }
      }
      if (cellCount > MAX_N) { fail(spec.id, `第 ${i + 1} 步内存格 ${cellCount} 个，超过上限 ${MAX_N}`); bad += 1 }
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

    const related = resolveRelated(spec)
    if (related.length === 0) { fail(spec.id, 'relatedProblems 解析为空（本章在索引里查不到题目）'); continue }

    const demo: Record<string, unknown> = {
      _generated: GENERATED,
      id: spec.id,
      title: spec.title,
      renderer: spec.renderer,
      category: spec.category,
      chapter: spec.chapter,
      relatedProblems: related,
      code: spec.code,
      meta: {
        algorithm: spec.algorithm,
        ...(spec.n !== undefined ? { n: spec.n } : {}),
        counterKeys: spec.counterKeys,
        generatedBy: `gen-viz3d@${pkg.version}`,
        hall: 'viz3d',
      },
      steps,
    }
    writeFileSync(join(OUT_DIR, `${spec.id}.json`), JSON.stringify(demo, null, 2) + '\n', 'utf8')
    written += 1
    totalSteps += steps.length
    indexDemos.push({
      id: spec.id,
      title: spec.title,
      chapter: spec.chapter,
      category: spec.category,
      renderer: spec.renderer,
      relatedProblems: related,
      steps: steps.length,
      url: `data/viz3d/${spec.id}.json`,
    })
    console.log(`  ✓ ${spec.id.padEnd(20)} ${String(steps.length).padStart(3)} 步  related=${related.join(',')}`)
  }
} finally {
  await server.close()
}

// 增量模式（-- 指定 id）不能覆盖整个索引，否则会把没重生成的条目从索引里抹掉
let merged = indexDemos
if (only.length > 0) {
  const prevPath = join(OUT_DIR, 'index.json')
  const prev = (readFileSync(prevPath, 'utf8') ? JSON.parse(readFileSync(prevPath, 'utf8')) : null) as { demos?: Record<string, unknown>[] } | null
  const kept = (prev?.demos ?? []).filter((d) => !indexDemos.some((n) => n.id === d.id))
  merged = [...kept, ...indexDemos]
}
writeFileSync(
  join(OUT_DIR, 'index.json'),
  JSON.stringify({ _generated: GENERATED, count: merged.length, demos: merged }, null, 2) + '\n',
  'utf8',
)

console.log(`\n生成 ${written} 个 3D 专属语料 / 共 ${totalSteps} 步 → public/data/viz3d/（索引 ${merged.length} 条）`)
if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} 处校验失败：`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('✅ 全部通过校验（每步有解说 / kind 一致 / 内存格 ≤ 50 / 统计口径吻合 / 关联题目不悬空）')
