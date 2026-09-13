/**
 * 全局搜索语料生成（任务 4-1）。产出 public/data/search/unified.json —— 全站唯一一份搜索语料。
 *
 * 为什么再建一份索引（已经有 search/problems.json 了）：
 *   那份只有题目、且是给 MiniSearch 用的字段形状；任务 4 的搜索要求「题目 + 卡片 + 演示 一处搜全部」，
 *   六类语料必须同形状同口径，否则前端要 fetch 六个文件、写六套打分。
 *   不引 MiniSearch（用户裁决：选最稳妥、体积最小的方案）—— 3000 条量级手写子串打分 <1 ms，
 *   省掉 ~7 KB gzip 依赖，也不用维护它的索引序列化格式。
 *
 * 语料一律**现算派生**，不新增第二份真相：
 *   题目   ← data/problems/index.json（build-index.ts 产出）
 *   卡片   ← data/knowledge/index.json
 *   演示   ← data/viz/index.json
 *   3D     ← data/viz3d/index.json
 *   展品   ← data/bugs/exhibits.json（gen-bug-data.mjs 产出）
 *   手册   ← src/modules/ref/data.ts 的 REF_SECTIONS（页面渲染用的同一份常量，直接 import）
 *   站内页 ← 下面 PAGES 常量（与 AppShell 导航同源，改导航记得改这里）
 *
 * 输出刻意压成单行 JSON（无缩进）：语料 ~400 KB，缩进版本要翻倍，而它是要走网络下载的。
 * 用法：npm run build:search（已串进 build:index）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DATA = join(ROOT, 'public', 'data')
const OUT = join(DATA, 'search', 'unified.json')

const readJson = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'))

// 展示用的中文标签只允许有一份真相：直接 import 前端在用的那两个模块（Node 24 原生剥离类型）
const { TYPE_LABEL } = await import('../src/modules/problems/type-meta.ts')
const { REF_SECTIONS } = await import('../src/modules/ref/data.ts')

const CAT = (c) => (c === 'c' ? 'C 语言' : c === 'ds' ? '数据结构' : c || '未分类')
const typeLabel = (t) => TYPE_LABEL[t] ?? t
/** 语料里的文本一律压掉换行与多余空白：搜索是子串匹配，换行只会白白吃掉体积 */
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

const docs = []
const push = (k, id, t, s, x, extra) => {
  const d = { k, id, t: flat(t), s: flat(s) }
  const xx = flat(x)
  if (xx) d.x = xx
  if (extra) Object.assign(d, extra)
  docs.push(d)
}

/* ── 1. 题目 ───────────────────────────────────────────────────────── */
const pIdx = readJson('problems/index.json')
for (const p of pIdx.problems) {
  push('problem', p.id, p.title, `${CAT(p.category)} · ${p.chapter} · ${typeLabel(p.type)}`,
    `${(p.tags ?? []).join(' ')} ${typeLabel(p.type)} ${p.id}`,
    { n: p.verified ? 1 : 0 })
}

/* ── 2. 知识卡片 ───────────────────────────────────────────────────── */
const kIdx = readJson('knowledge/index.json')
for (const c of kIdx.cards) {
  push('knowledge', c.id, c.title, `${CAT(c.category)} · ${c.chapter} · ${c.section ?? ''}`,
    `${c.summary ?? ''} ${(c.keyPoints ?? []).join(' ')} ${c.id}`)
}

/* ── 3. 2D 演示 ────────────────────────────────────────────────────── */
const VIZ_CAT = { sort: '排序', linear: '线性表', tree: '树', graph: '图', search: '查找', memory: '内存与指针', string: '字符串' }
const vIdx = readJson('viz/index.json')
for (const v of vIdx.demos) {
  push('viz', v.id, v.title, `2D 演示 · ${VIZ_CAT[v.category] ?? v.category} · ${v.steps} 步`,
    `${v.renderer} ${v.id} ${(v.relatedProblems ?? []).join(' ')}`)
}

/* ── 4. 3D 演示 ────────────────────────────────────────────────────── */
// 目录（38 条）在 src/modules/viz3d/catalog.ts，是列表页与演示页共用的唯一入口表。
// 标题一律现查：catalog.title 覆盖 → 对应 source 的 index.json 标题 → id 兜底，
// 绝不把标题抄进语料（那会变成第二份真相）。
const { VIZ3D_CATALOG, VIZ3D_GROUPS } = await import('../src/modules/viz3d/catalog.ts')
const v3Idx = readJson('viz3d/index.json')
const v3Title = new Map()
const v3Steps = new Map()
for (const v of vIdx.demos) { v3Title.set(v.id, v.title); v3Steps.set(v.id, v.steps) }
for (const v of v3Idx.demos) { v3Title.set(v.id, v.title); v3Steps.set(v.id, v.steps) }
const groupLabel = new Map(VIZ3D_GROUPS.map((g) => [g.key, `${g.emoji} ${g.label}`]))
for (const e of VIZ3D_CATALOG) {
  const base = v3Title.get(e.id) ?? e.id
  const steps = v3Steps.get(e.id)
  const title = e.title && e.title.trim() ? e.title.trim() : `3D ${base}`
  push('viz3d', e.id, title,
    `${groupLabel.get(e.group) ?? e.group} · ${steps ? steps + ' 步 · ' : ''}语料${e.source === 'viz' ? '复用 2D' : '3D 专属'}`,
    `${e.blurb} ${e.scene} ${base} ${e.id}`)
}

/* ── 5. 错误博物馆展品 ─────────────────────────────────────────────── */
const bugs = readJson('bugs/exhibits.json')
for (const b of bugs.exhibits) {
  push('bug', b.id, `${b.emoji ?? ''} ${b.title}`, `错误博物馆 · ${b.chapter ?? ''} · ${b.severityLabel ?? ''}`,
    `${b.symptom ?? ''} ${b.story ?? ''} ${b.compilerSays ?? ''} ${b.category ?? ''} ${b.id}`)
}

/* ── 6. 速查手册（逐行）───────────────────────────────────────────── */
// 一行的「标题」取第一个可搜索列的值（如 %d、+=、int），其余列拼进 x 供全文匹配。
// 深链带 q=：落到手册页时搜索框已填好、行级过滤已生效，学生不必再打一遍字。
for (const sec of REF_SECTIONS) {
  for (const tb of sec.tables) {
    const searchable = tb.columns.filter((c) => !c.noSearch)
    tb.rows.forEach((row, i) => {
      const head = searchable[0] ?? tb.columns[0]
      const term = flat(row[head.key])
      const rest = tb.columns.map((c) => flat(row[c.key])).filter((v, j) => v && tb.columns[j].key !== head.key).join(' ')
      push('ref', `${sec.id}:${tb.id}:${i}`, term, `速查手册 · ${sec.title} · ${tb.title}`, rest, { q: term })
    })
  }
}

/* ── 7. 站内页面 / 工具（与 AppShell 导航同源）────────────────────── */
const PAGES = [
  ['path', '学习路径（闯关式主线）', '按章节递进：学卡片 → 看演示 → 练题目，通关才解锁下一关', '闯关 解锁 主线 章节 递进 学习计划'],
  ['playground', '代码游乐场', '自由编写并运行 C 代码，支持 stdin、多编译器切换、诊断高亮', 'playground 自由运行 编译器 gcc clang 试验台 在线编译'],
  ['cheatsheet', '速查手册', 'printf/scanf 格式符、运算符优先级、ASCII 码表、关键字、库函数', '手册 速查 格式符 优先级 ascii 关键字 库函数'],
  ['bugs', '错误博物馆', '经典 bug 可交互演示，每段代码都能真机运行看后果', '博物馆 bug 野指针 越界 内存泄漏 溢出 悬空'],
  ['review', '错题重练', 'Leitner 五箱间隔重复，按遗忘曲线自动安排复习', '复习 间隔重复 遗忘曲线 错题 leitner'],
  ['progress', '我的进度', '做题统计、章节掌握度、错题本、收藏、笔记、导入导出', '进度 统计 正确率 错题本 收藏 笔记 导出'],
  ['viz3d', '3D 可视化馆', '二叉树 / 链表 / 栈队 / 内存沙盘 / 调用栈 / 矩阵 / 图 / 排序的立体演示', '3d 三维 立体 webgl 旋转 沙盘'],
  ['knowledge', '知识点汇总', '学：这个概念是什么（知识卡片）', '知识 卡片 概念 学'],
  ['viz', '可视化演示', '懂：它是怎么工作的（2D 分步动画）', '演示 动画 可视化 懂'],
  ['problems', '在线刷题', '练：我会不会用（四种主力题型 + 七种辅助题型）', '刷题 题目 练习 练 判分'],
  ['judge-lab', '判分实测台', '开发工具：直连 Godbolt 验判分链路（非学习入口）', '判分 实测 godbolt 后端 调试'],
  ['errata', '勘误表', '教材 OCR 缺陷与题目修正的逐条留痕', '勘误 修正 ocr 教材'],
]
for (const [id, t, s, x] of PAGES) push('page', id, t, '站内页面', x, { u: `/${id}` })

/* ── 汇总写出 ─────────────────────────────────────────────────────── */
const totals = { all: docs.length }
for (const d of docs) totals[d.k] = (totals[d.k] ?? 0) + 1

const payload = {
  _generated: 'GENERATED — 由 npm run build:search 生成，禁止手工编辑（手改会被覆盖）',
  schema: 1,
  source: ['problems/index.json', 'knowledge/index.json', 'viz/index.json', 'viz3d/index.json', 'bugs/exhibits.json', 'modules/ref/data.ts'],
  fields: { k: '类别', id: '类别内唯一 id', t: '标题', s: '副标题（展示用）', x: '附加可搜索文本', q: '深链查询词（仅手册行）', u: '路由（仅站内页）', n: '1=已实机验证（仅题目）' },
  totals,
  docs,
}

writeFileSync(OUT, JSON.stringify(payload), 'utf8')
// 另出一份**极小**的计数文件：首页要显示「2074 题 / 345 卡片」这类规模数字，
// 但绝不能为了几个数字把 727 KB 语料拖进首屏 —— 故拆一个 <1 KB 的 totals.json 给它。
writeFileSync(join(DATA, 'search', 'totals.json'), JSON.stringify({
  _generated: payload._generated,
  schema: 1,
  ...totals,
}), 'utf8')

const kb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(1)
console.log(`✅ 搜索语料已生成：public/data/search/unified.json（${kb} KB）`)
console.log('   ' + Object.entries(totals).map(([k, v]) => `${k}=${v}`).join('  '))
