// 题型配比报告：全库 / 分类别 / 分章 统计，与 AGENTS.md 80/20 目标对比
import fs from 'node:fs'
import path from 'node:path'

const dir = 'public/data/problems'
const MAIN = ['code_completion', 'debug', 'code_reading', 'programming']
const AUX = ['single_choice', 'true_false', 'fill_blank', 'code_ordering', 'complexity', 'short_answer', 'matching']

const files = fs.readdirSync(dir).filter((f) => /^(c|ds)-ch\d+\.json$/.test(f)).sort()
const byType = {}, byCat = { c: {}, ds: {} }, byChapter = {}
let total = 0
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  const cat = f.startsWith('ds') ? 'ds' : 'c'
  byChapter[j.chapter || f] = byChapter[j.chapter || f] || {}
  for (const p of j.problems) {
    total++
    byType[p.type] = (byType[p.type] || 0) + 1
    byCat[cat][p.type] = (byCat[cat][p.type] || 0) + 1
    const bk = `${cat}:${j.chapter || f}`
    byChapter[bk] = byChapter[bk] || { total: 0, main: 0 }
    byChapter[bk].total++
    if (MAIN.includes(p.type)) byChapter[bk].main++
  }
}
delete byChapter[Object.keys(byChapter)[0]] // 清理误建的裸 chapter 键（若与 bk 重复无影响）

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '-')
const catTotal = (c) => Object.values(byCat[c]).reduce((a, b) => a + b, 0)
const mainOf = (o) => MAIN.reduce((a, t) => a + (o[t] || 0), 0)

console.log(`总题量 ${total}（C 语言 ${catTotal('c')} · 数据结构 ${catTotal('ds')}）`)
console.log('')
console.log('题型'.padEnd(20), '全库'.padStart(6), '占比'.padStart(8), '  C语言'.padStart(8), '  数据结构'.padStart(8))
for (const t of [...MAIN, ...AUX]) {
  const n = byType[t] || 0
  if (!n) continue
  const grp = MAIN.includes(t) ? '主力' : '辅助'
  console.log(`${t}(${grp})`.padEnd(24), String(n).padStart(5), pct(n, total).padStart(8), String(byCat.c[t] || 0).padStart(8), String(byCat.ds[t] || 0).padStart(10))
}
const unknown = Object.keys(byType).filter((t) => !MAIN.includes(t) && !AUX.includes(t))
if (unknown.length) console.log('未登记题型:', unknown.map((t) => `${t}=${byType[t]}`).join(', '))

const mainAll = MAIN.reduce((a, t) => a + (byType[t] || 0), 0)
console.log('')
console.log(`主力题型（程序填空/改错/阅读/编程）合计 ${mainAll} = ${pct(mainAll, total)}  ·  目标 80%`)
console.log(`辅助题型（选择/判断/填空/排序/复杂度/简答/连线）合计 ${total - mainAll} = ${pct(total - mainAll, total)}  ·  目标 20%`)
console.log('')
console.log('分片主力占比（章）:')
for (const [k, v] of Object.entries(byChapter)) {
  if (!k.includes(':')) continue
  console.log(`  ${k.padEnd(14)} ${String(v.total).padStart(4)} 道 · 主力 ${pct(v.main, v.total)}`)
}
