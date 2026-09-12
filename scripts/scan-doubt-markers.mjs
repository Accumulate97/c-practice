#!/usr/bin/env node
// scripts/scan-doubt-markers.mjs —— 全库「存疑/OCR 残留」标记扫描闸门
// 口径：把「会被学生看到并影响判分的表面文本」（stem / options / blanks / answer / solution / codeTemplate / testCases）
//       与「explanation 等元信息里的知情注记」分开统计。
//       表面文本命中 = 未清理的存疑/OCR 残留 → exit 1（闸门不放行）；
//       元信息命中 = 阶段 C 裁决留痕，属设计内保留 → 只计数，不失败。
import { readFileSync, readdirSync } from 'node:fs'

const DIR = 'public/data/problems'
const RE = /\[\?\]|存疑|待裁决|待确认|TODO|FIXME|一>|″|＊|＝＝/g
const META_KEYS = ['explanation', 'note', 'analysis', 'source', 'ai_generated', 'generated_at']

let surfaceHits = 0
let metaHits = 0
const surfaceList = []
const metaList = []

for (const f of readdirSync(DIR).sort()) {
  if (!/^(c|ds)-ch\d+\.json$/.test(f)) continue
  const j = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
  for (const p of j.problems ?? []) {
    const surface = {}
    const meta = {}
    for (const [k, v] of Object.entries(p)) {
      if (META_KEYS.includes(k)) meta[k] = v
      else surface[k] = v
    }
    const s = JSON.stringify(surface).match(RE)
    const m = JSON.stringify(meta).match(RE)
    if (s) {
      surfaceHits += s.length
      surfaceList.push(`${p.id} x${s.length} :: ${JSON.stringify(s.slice(0, 3))}`)
    }
    if (m) {
      metaHits += m.length
      metaList.push(`${p.id} x${m.length}`)
    }
  }
}

console.log(`表面文本（stem/options/blanks/answer/solution/codeTemplate/testCases）命中：${surfaceHits} 处 / ${surfaceList.length} 题`)
for (const x of surfaceList.slice(0, 40)) console.log('  !! ' + x)
console.log(`元信息（explanation 等）知情注记：${metaHits} 处 / ${metaList.length} 题（设计内保留，不判失败）`)
if (surfaceHits > 0) {
  console.error('\n❌ 存在未清理的存疑/OCR 残留标记，请逐题裁决后重跑。')
  process.exit(1)
}
console.log('\n✅ 表面文本 0 残留。')
