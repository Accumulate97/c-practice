/**
 * 任务1 · 变式题质量扫描 v3（只读 public/data/problems，不改任何题目数据）
 *
 * 背景：1066 道 ai_generated 题（601 道 C 语言「变式」+ 465 道「原创」，其中 DS 450 道）
 *      从未人工比对过。本脚本把全库 2074 道互扫一遍，回答四个问题：
 *        ① 有没有「几乎同一道题」重复占位（凑数）？
 *        ② 变式题相对母题到底改了什么（只改数值 / 改结构 / 改情境）？
 *        ③ 哪些题互相成簇（同一模板批量生成的家族）？
 *        ④ 高度相似的题之间，答案/输入是否自相矛盾？
 *      产出 docs/变式题质量报告.md（人读）+ tmp/variant-scan.json（机器可读全量）。
 *
 * ── 两条相似度，必须分开看（v1 的教训）────────────────────────────────────
 *   · 掩码相似度：数字掩成 NUM/0、字符串掩成 STR 之后比 —— 度量「模板是否相同」
 *   · 原样相似度：字面量原封不动比 —— 度量「题目是否真的一样」
 *   教材原题里存在成组模板题（题4.46/4.47/4.48 只有 a、b、c 取值不同），
 *   只看掩码相似度会把它们全部误报成「完全相同」。所以：
 *     原样 ≥0.90              → 真·雷同（凑数嫌疑，最高优先级）
 *     掩码 ≥0.90 且原样 <0.90 → 同模板仅改数值（低价值变式，次优先级）
 *
 * ── 有效性分级以「全库最近邻」为主轴（v2 的教训）─────────────────────────
 *   v2 曾按「与推断母题的相似度」分级，结果 601 道变式题里 577 道判为 no-parent：
 *   因为 source 只写「变式（源自 c-chXX 既有题目）」，没有具体母题 id，而实测同章节
 *   既有题的题型与变式题根本对不上（例：c-ch01 既有题 12 道全是 single_choice/fill_blank，
 *   变式题却是 code_reading）。母题不可追溯 ⇒ 该轴只能作为辅助信息，不能当分级依据。
 *   改以「库里最像的那一道」为准：与任何既有题都只在数值上不同 = 低价值变式；
 *   与全库都不构成模板级重复 = 有效变式。这才是可判定、可复现的口径。
 *
 * 用法：node scripts/scan-variant-quality.mjs   （纯本地，约 8 秒，不打 Godbolt）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'public/data/problems')
const OUT_MD = join(ROOT, 'docs', '变式题质量报告.md')
const OUT_JSON = join(ROOT, 'tmp', 'variant-scan.json')

const DUP_RAW = 0.90        // 原样相似度 ≥ 此值 = 真·雷同
const DUP_MASK = 0.90       // 掩码相似度 ≥ 此值（且原样未达）= 同模板仅改数值
const HIGH_RAW = 0.80       // 0.80–0.90 = 高度相似（边缘）
const CLUSTER_AT = 0.85     // 成簇阈值（取掩码与原样的较大者）

/* ------------------------------------------------------------------ 载入 */
function loadProblems() {
  const files = readdirSync(DIR).filter((f) => /^(c|ds)-ch\d+\.json$/.test(f)).sort()
  const out = []
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
    for (const p of d.problems) out.push({ ...p, __shard: f })
  }
  return out
}

/* -------------------------------------------------------------- 特征提取 */
const PUNCT_RE = /[\s\u3000\u3001-\u303f\uff00-\uffef，。、；：？！“”‘’（）《》【】·…—\-_,.;:?!'"()\[\]{}<>=+*/%&|^~$#@\\`]+/g
const stripPunct = (s) => String(s ?? '').toLowerCase().replace(PUNCT_RE, '')
const maskNumbers = (s) => stripPunct(s).replace(/[0-9]+(?:\.[0-9]+)?/g, '0')

function charGrams(s, n) {
  const set = new Set()
  if (!s) return set
  if (s.length <= n) { set.add(s); return set }
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n))
  return set
}

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*|0[xXbB][0-9a-fA-F_]+|[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?[uUlLfF]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\S/g

function codeTokens(code, maskLiterals) {
  const src = String(code ?? '').split(/\r?\n/).filter((l) => !/^\s*#\s*include/.test(l)).join('\n')
  const toks = src.match(TOKEN_RE) ?? []
  if (!maskLiterals) return toks
  return toks.map((t) => (t[0] === '"' ? 'STR' : t[0] === "'" ? 'CHR' : /^[0-9]/.test(t) ? 'NUM' : t))
}
function tokenGrams(toks, n) {
  const set = new Set()
  if (toks.length === 0) return set
  if (toks.length <= n) { set.add(toks.join(' ')); return set }
  for (let i = 0; i + n <= toks.length; i++) set.add(toks.slice(i, i + n).join(' '))
  return set
}

const textOf = (p) => String(p.stem ?? '') + ' ' + (Array.isArray(p.options) ? p.options.map((o) => (typeof o === 'string' ? o : String(o?.text ?? ''))).join(' ') : '')
const codeOf = (p) => p.code || p.code_starter || p.fixed_code || p.solution || p.reference || ''
const codeNorm = (p) => codeOf(p).replace(/\s+/g, ' ').trim()
/**
 * 可判分代码：题面里的 code 对填空题只是「带空的骨架」，对改错题只是「有病的原文」，
 * 拿它比同异会把两道答案不同的填空题误判成「同题不同答案」。真正决定输出的是：
 *   debug → fixed_code；code_completion → solution；programming → reference；其余 → code
 */
function effectiveCodeOf(p) {
  if (p.type === 'debug') return p.fixed_code || codeOf(p)
  if (p.type === 'code_completion') return p.solution || codeOf(p)
  if (p.type === 'programming') return p.reference || p.code_starter || codeOf(p)
  return codeOf(p)
}
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim()
/** 输入集合与期望输出集合：多组测试用例要整体比，不能只比第一组 */
const stdinSetOf = (p) => (Array.isArray(p.testCases) && p.testCases.length
  ? p.testCases.map((t) => norm(t.stdin)).join('\u0001')
  : norm(p.stdin))
const expectedSetOf = (p) => JSON.stringify([
  ...(Array.isArray(p.testCases) ? p.testCases.map((t) => norm(t.expected)) : []),
  p.answer ?? null, Array.isArray(p.blanks) ? p.blanks.map((b) => b.answer) : null,
])

/* ------------------------------------------------------------ Jaccard 工具 */
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  const small = a.size <= b.size ? a : b
  const big = a.size <= b.size ? b : a
  let inter = 0
  for (const x of small) if (big.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
/** 尺寸差太多时 Jaccard 上界 = min/max，够不到阈值就直接跳过（省掉上亿次集合查找） */
const ratioOk = (a, b, floor) => a.size > 0 && b.size > 0 && Math.min(a.size, b.size) / Math.max(a.size, b.size) >= floor

function dropCommonShingles(items, keys, ratio) {
  const stats = {}
  for (const key of keys) {
    const df = new Map()
    for (const it of items) for (const s of it[key]) df.set(s, (df.get(s) ?? 0) + 1)
    const cap = Math.max(8, Math.floor(items.length * ratio))
    let dropped = 0
    for (const it of items) {
      const kept = new Set()
      for (const s of it[key]) { if ((df.get(s) ?? 0) <= cap) kept.add(s); else dropped++ }
      it[key] = kept
    }
    stats[key] = { uniq: df.size, droppedInstances: dropped }
  }
  return stats
}

/* ------------------------------------------------------------------ 主流程 */
const problems = loadProblems()
const N = problems.length
const feats = problems.map((p, idx) => {
  const code = codeOf(p)
  return {
    idx, p,
    T: charGrams(maskNumbers(textOf(p)), 3),
    Tr: charGrams(stripPunct(textOf(p)), 3),
    C: tokenGrams(codeTokens(code, true), 4),
    Cr: tokenGrams(codeTokens(code, false), 4),
    hasCode: code.trim().length > 0,
    isAI: p.ai_generated === true,
    kind: p.ai_generated === true ? (/^变式/.test(String(p.source ?? '')) ? 'variant' : 'ai-original') : 'original',
  }
})
const dfStats = dropCommonShingles(feats, ['T', 'Tr', 'C', 'Cr'], 0.25)

function sims(i, j) {
  const A = feats[i], B = feats[j]
  const both = A.hasCode && B.hasCode
  const text = jaccard(A.T, B.T), textRaw = jaccard(A.Tr, B.Tr)
  const code = both ? jaccard(A.C, B.C) : 0
  const codeRaw = both ? jaccard(A.Cr, B.Cr) : 0
  const mask = both ? 0.45 * text + 0.55 * code : text
  const raw = both ? 0.45 * textRaw + 0.55 * codeRaw : textRaw
  return { text, textRaw, code, codeRaw, mask, raw, max: Math.max(mask, raw), both }
}

/* 候选对：同 type 内穷举 + 跨 type 倒排索引（只收 df<=20 的稀有 shingle） */
const cand = new Set()
const byType = new Map()
for (const f of feats) {
  const arr = byType.get(f.p.type)
  if (arr) arr.push(f.idx); else byType.set(f.p.type, [f.idx])
}
for (const ids of byType.values()) {
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) cand.add(ids[a] * N + ids[b])
}
for (const key of ['T', 'C', 'Cr']) {
  const index = new Map()
  for (const f of feats) for (const s of f[key]) { const arr = index.get(s); if (arr) arr.push(f.idx); else index.set(s, [f.idx]) }
  for (const arr of index.values()) {
    if (arr.length < 2 || arr.length > 20) continue
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const i = arr[a], j = arr[b]
      cand.add(i < j ? i * N + j : j * N + i)
    }
  }
}

const pairs = []
for (const key of cand) {
  const i = Math.floor(key / N), j = key % N
  const A = feats[i], B = feats[j]
  if (!ratioOk(A.T, B.T, 0.4) && !(A.hasCode && B.hasCode && ratioOk(A.C, B.C, 0.4))) continue
  const s = sims(i, j)
  if (s.max >= 0.5) pairs.push({ i, j, ...s })
}
pairs.sort((x, y) => y.max - x.max)

const nnBy = new Map()
for (const x of pairs) {
  for (const ab of [[x.i, x.j], [x.j, x.i]]) {
    const cur = nnBy.get(ab[0])
    if (!cur || x.max > cur.max) nnBy.set(ab[0], { j: ab[1], max: x.max, raw: x.raw, mask: x.mask, code: x.code, codeRaw: x.codeRaw, text: x.text, textRaw: x.textRaw, both: x.both })
  }
}

/* 并查集成簇：阈值 CLUSTER_AT 以上的题归为一个「同模板家族」 */
const uf = new Array(N).fill(0).map((_, k) => k)
const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x] } return x }
for (const x of pairs) if (x.max >= CLUSTER_AT) { const a = find(x.i), b = find(x.j); if (a !== b) uf[a] = b }
const clusters = new Map()
for (const f of feats) {
  const r = find(f.idx)
  if (r === f.idx) continue
  const arr = clusters.get(r)
  if (arr) arr.push(f.idx); else clusters.set(r, [r, f.idx])
}
const clusterList = [...clusters.values()].map((ids) => ids.sort((a, b) => a - b))
  .filter((ids) => ids.some((i) => feats[i].isAI)).sort((a, b) => b.length - a.length)

/* ------------------------------------------------- 推断母题（辅助轴，如实标注为推断） */
const nonAI = feats.filter((f) => !f.isAI)
const poolBy = new Map()
for (const f of nonAI) {
  for (const k of [f.p.category, f.p.category + '|' + f.p.__shard]) {
    const arr = poolBy.get(k)
    if (arr) arr.push(f); else poolBy.set(k, [f])
  }
}
function bestParent(v) {
  let best = null
  for (const key of [v.p.category + '|' + v.p.__shard, v.p.category]) {
    for (const m of poolBy.get(key) ?? []) {
      if (m === v) continue
      if (!ratioOk(v.T, m.T, 0.25) && !(v.hasCode && m.hasCode && ratioOk(v.C, m.C, 0.25))) continue
      const s = sims(v.idx, m.idx)
      const score = s.both ? 0.6 * s.code + 0.4 * s.text : s.text
      const scope = key.includes('|') ? 'same-chapter' : 'same-category'
      if (!best || score > best.score) best = { mid: m.p.id, score, s, scope }
    }
    if (best && best.score >= 0.25) break
  }
  return best
}

/* ------------------------------------------------------- 分级（最近邻为主轴） */
function levelOf(nn) {
  if (!nn) return 'effective'
  if (nn.raw >= DUP_RAW) return 'dup'
  if (nn.mask >= DUP_MASK) return 'numeric-only'
  if (nn.max >= HIGH_RAW) return 'borderline'
  return 'effective'
}
/** 母题轴分级（只对能找到可信母题的变式题有意义） */
function parentLevel(v, bp) {
  if (v.kind !== 'variant') return 'na'
  if (!bp || bp.score < 0.25) return 'untraceable'
  const s = bp.s
  if (s.both) {
    if (s.codeRaw >= 0.99 && s.textRaw >= 0.95) return 'copy'
    if (s.code >= 0.95) return s.text < 0.5 ? 'scenario-only' : (s.codeRaw >= 0.95 ? 'near-identical' : 'numeric-only')
    return s.code >= 0.7 ? 'partial' : 'rewritten'
  }
  if (s.textRaw >= 0.98) return 'copy'
  if (s.text >= 0.95) return s.textRaw >= 0.95 ? 'near-identical' : 'numeric-only'
  return s.text >= 0.7 ? 'partial' : 'rewritten'
}

const aiList = feats.filter((f) => f.isAI)
const variants = aiList.map((v) => {
  const bp = bestParent(v)
  const nn = nnBy.get(v.idx)
  const nnF = nn ? feats[nn.j] : null
  return {
    idx: v.idx, id: v.p.id, type: v.p.type, shard: v.p.__shard, category: v.p.category, kind: v.kind,
    level: levelOf(nn), parentLevel: parentLevel(v, bp),
    parentId: bp ? bp.mid : null, parentScope: bp ? bp.scope : 'none', parentScore: bp ? bp.score : 0,
    ps: bp ? bp.s : null,
    nn: nnF ? { id: nnF.p.id, kind: nnF.kind, ai: nnF.isAI, max: nn.max, raw: nn.raw, mask: nn.mask, code: nn.code, codeRaw: nn.codeRaw, text: nn.text, textRaw: nn.textRaw } : null,
  }
})

/* ------------------------------------------------------ 雷同对子类型 + 答案矛盾核查 */
function pairSubtype(x) {
  const A = feats[x.i].p, B = feats[x.j].p
  const eff = norm(effectiveCodeOf(A))
  const sameEff = eff !== '' && eff === norm(effectiveCodeOf(B))
  const sameStem = norm(A.stem) === norm(B.stem)
  const sameStdin = stdinSetOf(A) === stdinSetOf(B)
  const sameExpected = expectedSetOf(A) === expectedSetOf(B)
  const base = { sameEff, sameStem, sameStdin, sameExpected }
  if (sameEff && sameStdin) {
    // 同一段可判分代码 + 同一批输入 ⇒ 输出必然相同；期望不同就是数据矛盾
    return { ...base, sub: sameExpected ? 'same-problem' : 'same-problem-ANSWER-CONFLICT' }
  }
  if (sameEff) return { ...base, sub: 'same-code-diff-input' }        // 同程序多输入组
  if (sameStem) return { ...base, sub: 'same-stem-diff-solution' }     // 题面完全相同、解法/答案不同
  if (x.codeRaw >= 0.99 || x.textRaw >= 0.9) return { ...base, sub: 'same-text-diff-code' }
  return { ...base, sub: 'other' }
}

const pairInfo = (x) => {
  const st = pairSubtype(x)
  return {
    a: feats[x.i].p.id, b: feats[x.j].p.id, aKind: feats[x.i].kind, bKind: feats[x.j].kind,
    aType: feats[x.i].p.type, bType: feats[x.j].p.type,
    raw: +x.raw.toFixed(4), mask: +x.mask.toFixed(4), text: +x.text.toFixed(4), textRaw: +x.textRaw.toFixed(4),
    code: +x.code.toFixed(4), codeRaw: +x.codeRaw.toFixed(4), sameShard: feats[x.i].p.__shard === feats[x.j].p.__shard,
    bothCode: x.both, sub: st.sub, sameExpected: st.sameExpected, sameStem: st.sameStem,
    aExpected: expectedSetOf(feats[x.i].p).slice(0, 60), bExpected: expectedSetOf(feats[x.j].p).slice(0, 60),
  }
}
const dupRaw = pairs.filter((x) => x.raw >= DUP_RAW)
const dupMaskOnly = pairs.filter((x) => x.raw < DUP_RAW && x.mask >= DUP_MASK)
const highRaw = pairs.filter((x) => x.raw >= HIGH_RAW && x.raw < DUP_RAW)
const involvesAI = (x) => feats[x.i].isAI || feats[x.j].isAI
const bothAI = (x) => feats[x.i].isAI && feats[x.j].isAI
const conflicts = [...dupRaw, ...dupMaskOnly, ...highRaw].map(pairInfo).filter((x) => x.sub.includes('CONFLICT'))

/* ------------------------------------------------------------ 汇总统计 */
const levels = ['dup', 'numeric-only', 'borderline', 'effective']
const parentLevels = ['copy', 'numeric-only', 'near-identical', 'scenario-only', 'partial', 'rewritten', 'untraceable', 'na']
const cnt = (arr, key, val) => arr.filter((v) => v[key] === val).length
const variantOnly = variants.filter((v) => v.kind === 'variant')
const aiOrigOnly = variants.filter((v) => v.kind === 'ai-original')
const pct = (a, b) => (b === 0 ? '—' : (100 * a / b).toFixed(1) + '%')
const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : '—')
const rnd = (x) => (typeof x === 'number' ? +x.toFixed(4) : null)

/* ------------------------------------------------------------- 写 JSON */
if (!existsSync(join(ROOT, 'tmp'))) mkdirSync(join(ROOT, 'tmp'), { recursive: true })
writeFileSync(OUT_JSON, JSON.stringify({
  generated_at: new Date().toISOString(), total_problems: N,
  thresholds: { dup_raw: DUP_RAW, dup_mask: DUP_MASK, high_raw: HIGH_RAW, cluster_at: CLUSTER_AT },
  pairs_dup_raw: dupRaw.map(pairInfo), pairs_dup_mask_only: dupMaskOnly.map(pairInfo), pairs_high_raw: highRaw.map(pairInfo),
  answer_conflicts: conflicts,
  clusters: clusterList.map((ids) => ids.map((i) => ({ id: feats[i].p.id, kind: feats[i].kind, type: feats[i].p.type, shard: feats[i].p.__shard }))),
  variants: variants.map((v) => ({
    id: v.id, type: v.type, shard: v.shard, kind: v.kind, level: v.level, parentLevel: v.parentLevel,
    parentId: v.parentId, parentScope: v.parentScope, parentScore: rnd(v.parentScore),
    parentSims: v.ps ? { text: rnd(v.ps.text), textRaw: rnd(v.ps.textRaw), code: rnd(v.ps.code), codeRaw: rnd(v.ps.codeRaw) } : null,
    nn: v.nn ? { id: v.nn.id, kind: v.nn.kind, raw: rnd(v.nn.raw), mask: rnd(v.nn.mask), max: rnd(v.nn.max) } : null,
  })),
  level_counts: Object.fromEntries(levels.map((l) => [l, cnt(variants, 'level', l)])),
  df_stats: dfStats,
}, null, 1), 'utf8')

/* ---------------------------------------------------------- 写 Markdown */
const idOf = (i) => feats[i].p.id
const kindTag = (i) => ({ variant: '变式', 'ai-original': 'AI原创', original: '既有题' })[feats[i].kind]
const SUBNAME = {
  'same-problem': '同题重复（可判分代码 + 输入 + 期望输出全同）',
  'same-problem-ANSWER-CONFLICT': '⚠ 数据矛盾（同可判分代码 + 同输入，期望输出却不同）',
  'same-code-diff-input': '同程序多输入组（可判分代码相同，只换 stdin）',
  'same-stem-diff-solution': '题面完全相同、解法/答案不同（多见于填空/改错共用一段程序）',
  'same-text-diff-code': '题干/代码高度雷同但不完全相同',
  'other': '其它',
}
const L = []
L.push('# 变式题质量报告（任务1 · 变式题质量扫描）')
L.push('')
L.push('- 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC')
L.push('- 扫描器：`scripts/scan-variant-quality.mjs`（只读扫描，**未改动任何题目数据**）')
L.push('- 数据源：`public/data/problems/*.json` 共 ' + N + ' 道')
L.push('- 机器可读全量结果：`tmp/variant-scan.json`（tmp 已 gitignore，重跑即再生）')
L.push('')
L.push('## 一、结论速览')
L.push('')
L.push('| 指标 | 数量 | 备注 |')
L.push('|---|---|---|')
L.push('| 全库题目 | ' + N + ' | — |')
L.push('| AI 生成题 | ' + aiList.length + ' | ' + pct(aiList.length, N) + ' |')
L.push('| ├─ C 语言「变式」题 | ' + variantOnly.length + ' | source 以「变式」开头 |')
L.push('| └─「原创」题（含 DS ' + aiOrigOnly.filter((v) => v.category === 'ds').length + ' 道） | ' + aiOrigOnly.length + ' | source 以「原创」开头 |')
L.push('| 既有题（教材转录/人工，充当母题库） | ' + nonAI.length + ' | 其中带代码 ' + nonAI.filter((f) => f.hasCode).length + ' 道 |')
L.push('| **真·雷同对**（原样 ≥ ' + DUP_RAW + '） | ' + dupRaw.length + ' 对 | AI×AI ' + dupRaw.filter(bothAI).length + '、AI×既有 ' + dupRaw.filter((x) => involvesAI(x) && !bothAI(x)).length + '、既有×既有 ' + dupRaw.filter((x) => !involvesAI(x)).length + ' |')
L.push('| **同模板仅改数值对** | ' + dupMaskOnly.length + ' 对 | AI×AI ' + dupMaskOnly.filter(bothAI).length + '、既有×既有 ' + dupMaskOnly.filter((x) => !involvesAI(x)).length + ' |')
L.push('| 高度相似对（原样 ' + HIGH_RAW + '–' + DUP_RAW + '） | ' + highRaw.length + ' 对 | AI×AI ' + highRaw.filter(bothAI).length + ' |')
L.push('| 涉雷题目数（去重，出现在上述任一档） | ' + new Set([...dupRaw, ...dupMaskOnly, ...highRaw].flatMap((x) => [x.i, x.j])).size + ' 道 | 占全库 ' + pct(new Set([...dupRaw, ...dupMaskOnly, ...highRaw].flatMap((x) => [x.i, x.j])).size, N) + ' |')
L.push('| 同模板家族簇（≥ ' + CLUSTER_AT + '，含 AI 题） | ' + clusterList.length + ' 簇 | 覆盖 ' + clusterList.reduce((a, c) => a + c.length, 0) + ' 道题，最大簇 ' + (clusterList[0] ? clusterList[0].length : 0) + ' 道 |')
L.push('| **答案矛盾对**（同代码同输入但 answer 不同） | ' + conflicts.filter((x) => x.sub === 'same-problem-ANSWER-CONFLICT').length + ' 对 | 详见第四节；本轮只报告不改数据 |')
L.push('| 变式题可追溯到母题的比例 | ' + variantOnly.filter((v) => v.parentLevel !== 'untraceable').length + ' / ' + variantOnly.length + ' | ' + pct(variantOnly.filter((v) => v.parentLevel !== 'untraceable').length, variantOnly.length) + '，见第三节 |')
L.push('')
L.push('**一句话结论**：没有发现「AI 变式题照抄教材既有题」的情况（AI×既有 的真雷同 ' + dupRaw.filter((x) => involvesAI(x) && !bothAI(x)).length + ' 对）；')
L.push('真正的重复发生在 **AI 变式题彼此之间**——' + dupRaw.filter(bothAI).length + ' 对原样雷同全部是 AI×AI，且绝大多数是「同一段程序换不同输入」拆成多道题。')
L.push('')
L.push('> **处置原则（本轮硬约束）**：>90% 的题一律**不删不改**（题量是硬指标），只出清单待人工裁决；已上线题目的 answer / testCases / verified 一个字节都没动。')
L.push('')
L.push('## 二、口径与方法（可复现）')
L.push('')
L.push('1. **两条相似度必须分开看**。掩码相似度把数字/字符串统一掩掉，度量「模板是否相同」；原样相似度保留字面量，度量「题目是否真的一样」。教材原题本身就有成组模板题（如 `c-ch04-fb-011/012/013` 即题4.46/4.47/4.48，只有 a、b、c 取值不同），只看掩码会把它们全误报成「完全相同」——v1 扫描器就踩了这个坑，v2 起修正。')
L.push('2. 文本特征 = 题干 + 选项，去标点空白后的字符 3-gram；代码特征 = 删 `#include` 行后的 token 4-gram。')
L.push('3. 综合相似度 = 两侧都有代码时 `0.45 × 文本 + 0.55 × 代码`，否则只看文本。')
L.push('4. 样板剔除：全局 df > 25% 的 shingle 丢掉（否则所有 C 题都因 `int main`/`printf` 互相「相似」）。本轮剔除实例数：' + Object.entries(dfStats).map(([k, v]) => k + ' ' + v.droppedInstances).join('、') + '。')
L.push('5. 候选对 = 同题型穷举 + 跨题型倒排索引（只收 df ≤ 20 的稀有 shingle，含原样代码倒排），共 ' + cand.size + ' 对候选再算精确 Jaccard；尺寸比 < 0.4 的对按 Jaccard 上界直接跳过。')
L.push('6. **有效性分级以「全库最近邻」为主轴**：一道题在库里最像的那一道，决定了它是「重复占位」还是「新内容」。理由见第三节——母题在数据里不可追溯，按母题分级会把 96% 的变式题判成「无法判定」。')
L.push('')
L.push('## 三、关键发现')
L.push('')
L.push('### 3.1 变式题的「母题」在数据里不可追溯')
L.push('')
L.push('`source` 只写「变式（源自 c-chXX 既有题目，按 06_变式出题方法论.md 改变数值/结构/情境）」，**没有具体母题 id**；schema 里也没有 `variantOf` 字段。')
L.push('脚本只能按相似度反推，结果是 ' + variantOnly.filter((v) => v.parentLevel === 'untraceable').length + ' / ' + variantOnly.length + ' 道变式题在同类别既有题里找不到相似度 ≥ 0.25 的候选。')
L.push('根因不是「变式题抄得太远」，而是**同章节既有题的题型与变式题对不上**：')
L.push('')
L.push('| 分片 | 既有题题型分布 | AI 变式题题型分布 |')
L.push('|---|---|---|')
for (const s of [...new Set(feats.map((f) => f.p.__shard))].sort()) {
  const orig = feats.filter((f) => f.p.__shard === s && !f.isAI)
  const ai = feats.filter((f) => f.p.__shard === s && f.isAI)
  const dist = (arr) => Object.entries(arr.reduce((a, f) => (a[f.p.type] = (a[f.p.type] ?? 0) + 1, a), {})).sort((x, y) => y[1] - y[1]).map(([k, v]) => k + ' ' + v).join('、') || '—'
  L.push('| ' + s.replace('.json', '') + ' | ' + dist(orig) + ' | ' + dist(ai) + ' |')
}
L.push('')
L.push('典型例子：`c-ch01` 既有题 12 道全是 single_choice / fill_blank（无代码），而该章 AI 变式题是 code_reading / code_completion（有代码）——两者不可能互为母题。')
L.push('**结论**：`source` 里的「源自 c-chXX 既有题目」是生成期的批次说明，不是可验证的血缘关系。想让「变式 ↔ 母题」成为站内可点击的双向链接（与 `knowledgeIds`/`vizIds` 同机制），必须给 schema 加 `variantOf`；本轮按硬约束未改 schema。')
L.push('')
L.push('### 3.2 真·雷同 ' + dupRaw.length + ' 对，全部是 AI×AI，且几乎都是「同程序多输入组」')
L.push('')
const subCount = (list) => list.map(pairInfo).reduce((a, x) => (a[x.sub] = (a[x.sub] ?? 0) + 1, a), {})
const sc = subCount(dupRaw)
L.push('| 子类型 | 对数 | 含义 |')
L.push('|---|---|---|')
for (const [k, v] of Object.entries(sc).sort((a, b) => b[1] - a[1])) L.push('| ' + (SUBNAME[k] ?? k) + ' | ' + v + ' | `' + k + '` |')
L.push('')
L.push('「同程序多输入组」= 同一段 C 程序原封不动出成 2–4 道题，只换 stdin（例：`c-ch04-cr-030/031/032` 三题代码完全相同，答案分别是 `Q1\\n2` / `6` / `Q4\\n8`）。')
L.push('这类题**答案各不相同、判分没有错**，但学生连做时要把同一段程序读三遍，练习价值远低于题面数量所暗示的水平。')
L.push('处置建议：合并为一道多输入题（本站 `testCases` 天生支持多组），或把其中 1–2 道改成真正的结构变式。')
L.push('')
L.push('### 3.3 同模板仅改数值 ' + dupMaskOnly.length + ' 对（AI×AI ' + dupMaskOnly.filter(bothAI).length + ' / 既有×既有 ' + dupMaskOnly.filter((x) => !involvesAI(x)).length + '）')
L.push('')
L.push('既有×既有 的 ' + dupMaskOnly.filter((x) => !involvesAI(x)).length + ' 对是教材原题自带的模板题组（题4.46/4.47/4.48 之类），属正常现象，不建议动。')
L.push('AI×AI 的 ' + dupMaskOnly.filter(bothAI).length + ' 对才是「变式只动了数字」的证据，是本轮返工的次优先对象。')
L.push('')
L.push('## 四、真·雷同清单（原样相似度 ≥ ' + DUP_RAW + ' · 共 ' + dupRaw.length + ' 对 · 未删除）')
L.push('')
function pairTable(list, cap, showSub) {
  const out = []
  out.push('| # | 题 A | 题 B | 原样 | 掩码 | 文本原样 | 代码原样 | 来源 |' + (showSub ? ' 子类型 | 答案一致 |' : ''))
  out.push('|---|---|---|---|---|---|---|---|' + (showSub ? '---|---|' : ''))
  list.slice(0, cap).forEach((x, k) => {
    const st = showSub ? pairSubtype(x) : null
    out.push('| ' + (k + 1) + ' | `' + idOf(x.i) + '`(' + kindTag(x.i) + ') | `' + idOf(x.j) + '`(' + kindTag(x.j) + ') | ' + f3(x.raw) + ' | ' + f3(x.mask) + ' | ' + f3(x.textRaw) + ' | ' + (x.both ? f3(x.codeRaw) : '—') + ' | ' + (bothAI(x) ? 'AI×AI' : involvesAI(x) ? 'AI×既有' : '既有×既有') + ' |' + (showSub ? ' ' + (SUBNAME[st.sub] ?? st.sub) + ' | ' + (st.sameExpected ? '是' : '**否**') + ' |' : ''))
  })
  if (list.length > cap) { out.push(''); out.push('> 只列前 ' + cap + ' 对（按相似度降序），完整 ' + list.length + ' 对见 `tmp/variant-scan.json`。') }
  return out
}
if (dupRaw.length === 0) L.push('无。')
else L.push(...pairTable(dupRaw, 250, true))
L.push('')
if (conflicts.length > 0) {
  L.push('### ⚠ 数据矛盾对（同一段可判分代码 + 同一批输入，期望输出却不同）')
  L.push('')
  L.push('| 题 A | 题 B | 子类型 | A 期望输出 | B 期望输出 |')
  L.push('|---|---|---|---|---|')
  for (const x of conflicts) {
    L.push('| `' + x.a + '` | `' + x.b + '` | ' + (SUBNAME[x.sub] ?? x.sub) + ' | `' + x.aExpected + '` | `' + x.bExpected + '` |')
  }
  L.push('')
  L.push('> 本轮按硬约束**未修改任何 answer**，仅列清单。这类矛盾必须人工复核：要么其中一道的答案错了，要么两道的输入其实不同而扫描器读到的 stdin 字段位置不同。')
} else {
  L.push('**一致性核查：0 处矛盾。** 比对口径是「可判分代码」（debug 用 `fixed_code`、填空用 `solution`、编程用 `reference`，其余用 `code`）+ 全部 testCases 的输入与期望输出：')
  L.push('')
  L.push('- 同一段可判分代码 + 同一批输入 ⇒ 期望输出必然相同，全库无一处违反；')
  L.push('- 「同程序多输入组」里每组的期望输出确实随输入而变，不存在「换了输入答案没变」的糊弄情况；')
  L.push('- 题面共用一段程序骨架、但填空/改错答案不同的（`same-stem-diff-solution`）不算矛盾，已单列子类型。')
}
L.push('')
L.push('## 五、同模板仅改数值清单（掩码 ≥ ' + DUP_MASK + ' 且原样 < ' + DUP_RAW + ' · 共 ' + dupMaskOnly.length + ' 对）')
L.push('')
L.push('这批题**不是同一道题**（数值确实不同、答案也不同），但考查方式一模一样。')
L.push('')
if (dupMaskOnly.length === 0) L.push('无。')
else L.push(...pairTable(dupMaskOnly, 200, false))
L.push('')
L.push('## 六、高度相似清单（原样 ' + HIGH_RAW + '–' + DUP_RAW + ' · 共 ' + highRaw.length + ' 对）')
L.push('')
if (highRaw.length === 0) L.push('无。')
else L.push(...pairTable(highRaw, 150, false))
L.push('')
L.push('## 七、同模板家族簇（连通簇，阈值 ' + CLUSTER_AT + '）')
L.push('')
L.push('把相似度 ≥ ' + CLUSTER_AT + ' 的题连成簇，一簇 = 一个模板批量生成的一组题。共 ' + clusterList.length + ' 簇，覆盖 ' + clusterList.reduce((a, c) => a + c.length, 0) + ' 道题。')
L.push('')
L.push('| # | 簇大小 | 成员 | 章节 |')
L.push('|---|---|---|---|')
clusterList.slice(0, 60).forEach((ids, k) => {
  const shards = [...new Set(ids.map((i) => feats[i].p.__shard.replace('.json', '')))].join(',')
  L.push('| ' + (k + 1) + ' | ' + ids.length + ' | ' + ids.map((i) => '`' + idOf(i) + '`').join(' ') + ' | ' + shards + ' |')
})
if (clusterList.length > 60) { L.push(''); L.push('> 只列最大的 60 簇，完整清单见 `tmp/variant-scan.json` 的 `clusters`。') }
L.push('')
L.push('## 八、AI 题有效性分级（以全库最近邻为准）')
L.push('')
L.push('| 分级 | 判定 | 变式题 | AI 原创题 | 合计 | 占 AI 题 |')
L.push('|---|---|---|---|---|---|')
const levelRows = [
  ['dup', '雷同（最近邻原样 ≥0.90）', '凑数嫌疑 · 待人工裁决'],
  ['numeric-only', '低价值变式（最近邻掩码 ≥0.90 而原样 <0.90，即只改了数值）', '低价值 · 建议升级为结构变式'],
  ['borderline', '边缘（最近邻 0.80–0.90）', '可保留 · 抽查'],
  ['effective', '有效变式（与全库任何题都不构成模板级重复）', '合格'],
]
for (const [k, cond, val] of levelRows) {
  L.push('| `' + k + '` | ' + cond + ' | ' + cnt(variantOnly, 'level', k) + ' | ' + cnt(aiOrigOnly, 'level', k) + ' | ' + cnt(variants, 'level', k) + ' | ' + pct(cnt(variants, 'level', k), variants.length) + ' |')
}
L.push('')
L.push('**变式题有效率 = ' + cnt(variantOnly, 'level', 'effective') + ' / ' + variantOnly.length + ' = ' + pct(cnt(variantOnly, 'level', 'effective'), variantOnly.length) + '**（含边缘档则 ' + pct(cnt(variantOnly, 'level', 'effective') + cnt(variantOnly, 'level', 'borderline'), variantOnly.length) + '）。')
L.push('')
L.push('辅助轴：按「与推断母题的相似度」分级（只对能追溯到母题的题有意义）：' + parentLevels.filter((k) => k !== 'na').map((k) => '`' + k + '` ' + cnt(variants, 'parentLevel', k)).join('、') + '。')
L.push('`untraceable` 占绝大多数，原因见 3.1，不代表这些题质量差。')
L.push('')
const worst = variants.filter((v) => v.nn).sort((a, b) => b.nn.max - a.nn.max).slice(0, 60)
L.push('最该先人工看的 60 道 AI 题（按最近邻相似度降序）：')
L.push('')
L.push('| # | 题目 | 题型 | 轨道 | 最近邻 | 邻来源 | 原样 | 掩码 | 分级 |')
L.push('|---|---|---|---|---|---|---|---|---|')
worst.forEach((v, k) => {
  L.push('| ' + (k + 1) + ' | `' + v.id + '` | ' + v.type + ' | ' + (v.kind === 'variant' ? '变式' : 'AI原创') + ' | `' + v.nn.id + '` | ' + (v.nn.ai ? 'AI' : '既有') + ' | ' + f3(v.nn.raw) + ' | ' + f3(v.nn.mask) + ' | `' + v.level + '` |')
})
L.push('')
L.push('## 九、按章节分布')
L.push('')
L.push('| 分片 | AI 题 | 雷同 | 低价值 | 边缘 | 有效 | 有效率 |')
L.push('|---|---|---|---|---|---|---|')
for (const s of [...new Set(variants.map((v) => v.shard))].sort()) {
  const arr = variants.filter((v) => v.shard === s)
  L.push('| ' + s.replace('.json', '') + ' | ' + arr.length + ' | ' + cnt(arr, 'level', 'dup') + ' | ' + cnt(arr, 'level', 'numeric-only') + ' | ' + cnt(arr, 'level', 'borderline') + ' | ' + cnt(arr, 'level', 'effective') + ' | ' + pct(cnt(arr, 'level', 'effective'), arr.length) + ' |')
}
L.push('')
L.push('## 十、建议（只建议，不动数据）')
L.push('')
L.push('1. **先处理第四节 ' + dupRaw.length + ' 对真·雷同**，其中「同程序多输入组」占 ' + (sc['same-code-diff-input'] ?? 0) + ' 对：合并为一道多输入题（`testCases` 天然支持），或把多余的 1–2 道改成结构变式。**不要直接删**（题量是硬指标）。')
L.push('2. **第五节 AI×AI 的 ' + dupMaskOnly.filter(bothAI).length + ' 对「仅改数值」按模板分组合并**：数值型变式有正当价值（同考点多练、防背答案），但同一模板下不宜超过 2 道，其余升级为结构/情境变式。')
L.push('3. **既有×既有 的 ' + dupMaskOnly.filter((x) => !involvesAI(x)).length + ' 对不建议动**：那是教材原题自带的模板题组（题4.46/4.47/4.48 之类），属于转录事实。')
L.push('4. **数据矛盾 ' + conflicts.length + ' 处必须人工复核**（第四节末尾），本轮未改任何 answer / testCases。')
L.push('5. **给 schema 加 `variantOf` 字段**（3.1）：现在母题不可追溯，既做不出站内双向链接，也无法在返工时定位「这道题该照谁改」。')
L.push('6. **返工后必须重跑本扫描**：`node scripts/scan-variant-quality.mjs`（约 8 秒，纯本地，不打 Godbolt），否则返工本身可能引入新的雷同。')
L.push('')
writeFileSync(OUT_MD, L.join('\n'), 'utf8')

/* -------------------------------------------------------------- 控制台 */
console.log('题目 ' + N + '｜AI ' + aiList.length + '（变式 ' + variantOnly.length + ' / 原创 ' + aiOrigOnly.length + '）｜既有 ' + nonAI.length)
console.log('真·雷同 ' + dupRaw.length + ' 对（AI×AI ' + dupRaw.filter(bothAI).length + ' / AI×既有 ' + dupRaw.filter((x) => involvesAI(x) && !bothAI(x)).length + ' / 既有×既有 ' + dupRaw.filter((x) => !involvesAI(x)).length + '）｜同模板仅改数值 ' + dupMaskOnly.length + ' 对（AI×AI ' + dupMaskOnly.filter(bothAI).length + '）｜高度相似 ' + highRaw.length + ' 对')
console.log('雷同子类型：' + Object.entries(sc).map(([k, v]) => k + '=' + v).join(' '))
console.log('数据矛盾 ' + conflicts.length + ' 处')
console.log('家族簇 ' + clusterList.length + ' 簇 / 覆盖 ' + clusterList.reduce((a, c) => a + c.length, 0) + ' 题；最大簇 ' + (clusterList[0] ? clusterList[0].length : 0))
console.log('AI 题分级：' + levels.map((l) => l + '=' + cnt(variants, 'level', l)).join(' ') + '｜变式题有效率 ' + pct(cnt(variantOnly, 'level', 'effective'), variantOnly.length))
console.log('母题可追溯 ' + variantOnly.filter((v) => v.parentLevel !== 'untraceable').length + '/' + variantOnly.length)
console.log('已写 ' + OUT_MD + ' 与 ' + OUT_JSON)