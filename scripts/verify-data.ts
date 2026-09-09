/**
 * 阶段 3 · 数据校验：把「规范里写着的纪律」变成可执行的闸门。
 *
 * 校验项（对应用户 2026-09-06 裁决一/二与任务书第 6 节阶段 3）：
 *   A. 用完整 Ajv（2020-12 + 根节点 unevaluatedProperties:false）逐题校验，不是只跑 id 正则
 *   B. id 全局唯一，且「id 前缀 ↔ chapter 字符串 ↔ 分片文件名 ↔ 分片 category」四向一致
 *   C. problems/index.json 与分片双向一致（多一个少一个都不行）
 *   D. 三向引用不悬空：problem.knowledgeIds / problem.vizIds / knowledge.relatedProblems
 *      等字段，正反两个方向都要能落到真实存在的 id 上
 *   E. 04 第〇节的两条文本纪律：expected 与 answer 不得带末尾换行或 CRLF
 *   F. verified 的可信度：代码类 verified:true 必须有 verification-report.json 的 ok:true 背书；
 *      非代码类按 Schema 说明「固定 true」，缺了就报错
 *   F2. 非代码题的「可判分性」：verified:true 却缺判分内容 = 「已验证」语义被架空，不得静默通过。
 *      自动判分型（单选/判断/概念填空/复杂度/匹配）缺 answer 或 blanks[].answer 为空 → error；
 *      简答型设计上不自动判分（自评），缺 reference_answer 与 grading_points → warn（可见但不拦闸门）。
 *      背景：2026-09 补答案轮之前，89 道 fill_blank verified:true 但答案全空，统计与验收被污染
 *   G. source 字段必填（版权纪律：原题只作风格参考，出处要如实注明）
 *
 * 用法：
 *   node scripts/verify-data.ts            校验 public/data 全量
 *   node scripts/verify-data.ts --strict   只把「代码题未实机验证」升级为 error（阶段 3 的硬闸门）。
 *                                      知识卡片/演示语料为空是阶段 5、6 的正常状态，不参与升级
 *   node scripts/verify-data.ts --doc04    连 04 的 11 个样例一起过 Schema
 *   node scripts/verify-data.ts --self-test 造 13 个已知坏样本，证明每条闸门都真会拦
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractJsonFences, isCodeType, readDocSamples } from './lib/problem-code.ts'
import type { ProblemLike } from './lib/problem-code.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const PROBLEM_DIR = join(DATA, 'problems')
/** 这两个不是题目分片，别当分片读 */
const NON_SHARD = new Set(['index.json', 'verification-report.json'])
/** 下划线前缀 = 转换期 sidecar（_index.json 总账 / _judge-evidence.json 实机证据），不是题目分片。
 *  当分片扫会误报 SHARD-UNKNOWN，还会被 build:index 当成 0 题分片写进索引清单；
 *  仍留在 public/ 下，是为降级模式能 fetch 构建期预存 stdout（AGENTS.md 二·5）。 */
const isShardName = (name: string): boolean =>
  name.endsWith('.json') && !name.startsWith('_') && !NON_SHARD.has(name)

interface AjvError { instancePath?: string; message?: string; keyword?: string }
interface Validator { (data: unknown): boolean; errors: null | AjvError[] }
interface AjvCtor { compile(schema: unknown): Validator }

/** ajv 是 CJS 包，用 createRequire 取，避免 ESM 默认导出互操作踩坑（实测必须 require('ajv/dist/2020')） */
function buildValidator(): Validator {
  const req = createRequire(import.meta.url)
  const ajvMod = req('ajv/dist/2020') as { default?: unknown }
  const raw = typeof ajvMod.default === 'function' ? ajvMod.default : ajvMod
  const formatsMod = req('ajv-formats') as { default?: unknown }
  const addFormats = typeof formatsMod.default === 'function' ? formatsMod.default : formatsMod
  const Ctor = raw as new (opts: Record<string, unknown>) => AjvCtor & Record<string, unknown>
  const ajv = new Ctor({ strict: false, allErrors: true })
  ;(addFormats as (a: unknown) => unknown)(ajv)
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'Problem.schema.json'), 'utf8')) as unknown
  return ajv.compile(schema)
}

interface ChapterEntry { no: string; id_prefix: string; chapter: string; file: string }
interface ChapterCategoryBlock { prefix: string; chapters: ChapterEntry[] }
interface ChapterMap { version: number; categories: Record<string, ChapterCategoryBlock> }

/** 章节编号唯一真源：docs/chapter-map.md 末尾的机器可读 json 块 */
function loadChapterMap(): ChapterMap {
  const md = readFileSync(join(ROOT, 'docs', 'chapter-map.md'), 'utf8')
  for (const block of extractJsonFences(md)) {
    if (!block.includes('"categories"')) continue
    return JSON.parse(block) as ChapterMap
  }
  throw new Error('docs/chapter-map.md 里找不到带 "categories" 的 ```json 机器可读块')
}

interface ShardFile { file: string; category: string; chapter: string; problems: ProblemLike[] }

function loadShards(): ShardFile[] {
  const out: ShardFile[] = []
  if (!existsSync(PROBLEM_DIR)) throw new Error('缺 public/data/problems 目录')
  for (const name of readdirSync(PROBLEM_DIR).sort()) {
    if (!isShardName(name)) continue
    const parsed = JSON.parse(readFileSync(join(PROBLEM_DIR, name), 'utf8')) as Record<string, unknown>
    const problems = Array.isArray(parsed.problems) ? (parsed.problems as ProblemLike[]) : []
    out.push({
      file: name,
      category: typeof parsed.category === 'string' ? parsed.category : '',
      chapter: typeof parsed.chapter === 'string' ? parsed.chapter : '',
      problems,
    })
  }
  return out
}

/** 递归收集任意目录下的 {id: string} 对象，供引用完整性检查用（知识卡片、演示都走这条） */
interface RefNode { id: string; file: string; problems: string[]; knowledge: string[]; viz: string[] }
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function collectRefs(dir: string, fields: string[]): RefNode[] {
  const nodes: RefNode[] = []
  if (!existsSync(dir)) return nodes
  const walk = (value: unknown, file: string): void => {
    if (Array.isArray(value)) { for (const v of value) walk(v, file); return }
    if (!value || typeof value !== 'object') return
    const o = value as Record<string, unknown>
    if (typeof o.id === 'string') {
      nodes.push({
        id: o.id,
        file,
        problems: fields.flatMap((f) => strArr(o[f])),
        knowledge: strArr(o.relatedKnowledge),
        viz: strArr(o.relatedViz),
      })
    }
    for (const k of Object.keys(o)) if (k !== 'id') walk(o[k], file)
  }
  for (const name of readdirSync(dir).sort()) {
    if (!isShardName(name)) continue
    walk(JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown, name)
  }
  return nodes
}

interface ReportResult { id: string; ok: boolean }
interface Report { results?: ReportResult[] }
function loadReport(): Map<string, ReportResult> {
  const map = new Map<string, ReportResult>()
  const p = join(PROBLEM_DIR, 'verification-report.json')
  if (!existsSync(p)) return map
  const r = JSON.parse(readFileSync(p, 'utf8')) as Report
  for (const item of r.results ?? []) map.set(item.id, item)
  return map
}

type Level = 'error' | 'warn'
/** --strict 只升级这一条：语料为空在阶段 3 属预期，不能让它一直把闸门顶成红色 */
const STRICT_PROMOTES = new Set(['NOT-VERIFIED'])
interface Issue { level: Level; code: string; where: string; msg: string }

/** 末尾换行/CRLF 判定：04 第〇节规定 expected 一律不写末尾换行 */
function hasBadLineEnd(text: string): boolean {
  return text.endsWith('\n') || text.endsWith('\r')
}

/** F2 闸门：返回非代码题的判分内容缺口；answerIsDescription:true（描述性答案，退出自动判分）豁免 */
function nonCodeAnswerGap(p: ProblemLike): { level: Level; msg: string } | null {
  if (p.answerIsDescription === true) return null
  const isBlank = (v: unknown): boolean =>
    v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim() === '')
  if (p.type === 'short_answer') {
    const hasRef = !isBlank(p.reference_answer)
    const gp = Array.isArray(p.grading_points) ? (p.grading_points as unknown[]).filter((g) => !isBlank(g)) : []
    if (!hasRef && gp.length === 0) {
      return { level: 'warn', msg: 'short_answer 缺 reference_answer 且 grading_points 为空，自评无内容可显示（不自动判分，记 warn）' }
    }
    return null
  }
  if (p.type === 'fill_blank') {
    const blanks = Array.isArray(p.blanks) ? (p.blanks as Array<Record<string, unknown>>) : []
    if (blanks.length === 0) return { level: 'error', msg: 'fill_blank 无 blanks，verified:true 却无法判分' }
    const empty = blanks.map((b, i) => ({ b, i })).filter(({ b }) => isBlank(b.answer))
    if (empty.length > 0) {
      return { level: 'error', msg: 'fill_blank 的 blanks[].answer 为空：' + empty.map(({ i }) => 'blanks[' + i + ']').join('、') + '，verified:true 却无法判分' }
    }
    return null
  }
  if (p.type === 'single_choice') {
    if (isBlank(p.answer)) return { level: 'error', msg: 'single_choice 缺 answer，verified:true 却无法判分' }
    if (typeof p.answer === 'number') {
      const n = Array.isArray(p.options) ? (p.options as unknown[]).length : 0
      if (p.answer < 0 || p.answer >= n) {
        return { level: 'error', msg: 'single_choice answer=' + String(p.answer) + ' 超出 options 索引范围 0..' + String(n - 1) }
      }
    }
    return null
  }
  // true_false / complexity / matching 等其余非代码型：answer 必须有内容（布尔 false 是合法答案）
  if (isBlank(p.answer)) return { level: 'error', msg: String(p.type) + ' 缺 answer，verified:true 却无法判分' }
  return null
}

function checkAll(shards: ShardFile[], strict: boolean): Issue[] {
  const issues: Issue[] = []
  const add = (level: Level, code: string, where: string, msg: string): void => {
    issues.push({ level, code, where, msg })
  }
  const validate = buildValidator()
  const cmap = loadChapterMap()

  /** 文件名 → 章；id 前缀 → 章；chapter 字符串 → 章 */
  const byFile = new Map<string, { category: string; entry: ChapterEntry }>()
  const byPrefix = new Map<string, { category: string; entry: ChapterEntry }>()
  const byChapter = new Map<string, { category: string; entry: ChapterEntry }>()
  for (const [category, block] of Object.entries(cmap.categories)) {
    for (const entry of block.chapters) {
      const wantFile = entry.id_prefix + '.json'
      if (entry.file !== wantFile) {
        add('error', 'MAP-FILE', 'chapter-map', entry.id_prefix + ' 的 file 应为 ' + wantFile + '，实为 ' + entry.file)
      }
      if (entry.id_prefix !== block.prefix + entry.no) {
        add('error', 'MAP-PREFIX', 'chapter-map', entry.id_prefix + ' 与 ' + block.prefix + entry.no + ' 不一致')
      }
      const chapterNo = entry.chapter.match(/^第([0-9]+)章/)?.[1] ?? ''
      if (chapterNo !== entry.no.replace('ch', '').replace(/^0+(?=.)/, '')) {
        add('error', 'MAP-CHAPTER', 'chapter-map', entry.id_prefix + ' 的章号 ' + entry.no + ' 与 chapter「' + entry.chapter + '」对不上')
      }
      for (const [map, key, what] of [[byFile, entry.file, 'file'], [byPrefix, entry.id_prefix, 'id_prefix'], [byChapter, entry.chapter, 'chapter']] as const) {
        if (map.has(key)) add('error', 'MAP-DUP', 'chapter-map', what + ' 重复：' + String(key))
        map.set(key, { category, entry })
      }
    }
  }

  const seenId = new Map<string, string>()
  const report = loadReport()
  const knowledgeIds = new Set(collectRefs(join(DATA, 'knowledge'), ['relatedProblems']).map((n) => n.id))
  const vizIds = new Set(collectRefs(join(DATA, 'viz'), ['relatedProblems']).map((n) => n.id))
  const problemIds = new Set<string>()
  let problemCount = 0

  for (const shard of shards) {
    const mapped = byFile.get(shard.file)
    if (!mapped) {
      add('error', 'SHARD-UNKNOWN', shard.file, '分片文件名不在 chapter-map 里，章节编号以 docs/chapter-map.md 为唯一真源')
    } else {
      if (shard.category !== mapped.category) {
        add('error', 'SHARD-CATEGORY', shard.file, '分片 category="' + shard.category + '" 与文件名所属 ' + mapped.category + ' 不符')
      }
      if (shard.chapter !== mapped.entry.chapter) {
        add('error', 'SHARD-CHAPTER', shard.file, '分片 chapter="' + shard.chapter + '" 与 chapter-map 的「' + mapped.entry.chapter + '」不符')
      }
    }

    if (shard.problems.length === 0) add('warn', 'SHARD-EMPTY', shard.file, '分片里没有题目')

    for (const p of shard.problems) {
      problemCount += 1
      const where = shard.file + ' ' + p.id
      if (!validate(p)) {
        for (const e of validate.errors ?? []) {
          add('error', 'SCHEMA', where, (e.instancePath || '(根)') + ' ' + (e.message ?? '校验失败'))
        }
      }
      const prefix = p.id.match(/^(?:c|ds)-ch[0-9]{2}/)?.[0] ?? ''
      const entry = byPrefix.get(prefix)
      if (!entry) {
        add('error', 'ID-PREFIX', where, 'id 前缀 ' + prefix + ' 不在 chapter-map 中')
      } else {
        if (p.chapter !== entry.entry.chapter) {
          add('error', 'ID-CHAPTER', where, 'chapter="' + String(p.chapter) + '" 与 id 前缀 ' + prefix + ' 的「' + entry.entry.chapter + '」不符')
        }
        if (shard.file !== entry.entry.file) {
          add('error', 'ID-FILE', where, '题目在 ' + shard.file + ' 里，但 id 前缀 ' + prefix + ' 要求放 ' + entry.entry.file)
        }
        if (p.category !== entry.category) {
          add('error', 'ID-CATEGORY', where, 'category=' + String(p.category) + ' 与 id 前缀所属 ' + entry.category + ' 不符')
        }
        const secNo = String(p.section ?? '').match(/^([0-9]+)/)?.[1] ?? ''
        const wantNo = entry.entry.chapter.match(/^第([0-9]+)章/)?.[1] ?? ''
        if (secNo !== wantNo) {
          add('error', 'SECTION-CHAPTER', where, 'section="' + String(p.section) + '" 的节号不属于' + entry.entry.chapter)
        }
      }
      const dup = seenId.get(p.id)
      if (dup) add('error', 'ID-DUP', where, 'id 重复，先出现在 ' + dup)
      else seenId.set(p.id, shard.file)
      problemIds.add(p.id)

      if (typeof p.source !== 'string' || p.source.trim() === '') {
        add('error', 'SOURCE', where, 'source 必填（版权纪律：注明出处）')
      }

      const tcs = Array.isArray(p.testCases) ? (p.testCases as Array<Record<string, unknown>>) : []
      for (const [i, tc] of tcs.entries()) {
        if (typeof tc.expected === 'string' && hasBadLineEnd(tc.expected)) {
          add('error', 'LINE-ENDING', where, 'testCases[' + i + '].expected 带末尾换行，04 第〇节规定不得写')
        }
      }
      if (typeof p.answer === 'string' && hasBadLineEnd(p.answer)) {
        add('error', 'LINE-ENDING', where, 'answer 带末尾换行，判分侧虽会归一化但数据里不该写')
      }

      if (isCodeType(p.type)) {
        if (p.verified === true) {
          const r = report.get(p.id)
          if (!r) add('error', 'VERIFIED-NO-PROOF', where, 'verified:true 但 verification-report.json 里没有实机记录')
          else if (r.ok !== true) add('error', 'VERIFIED-FAILED', where, 'verified:true 但实机记录 ok=false')
        } else {
          add('warn', 'NOT-VERIFIED', where, '代码题尚未实机验证（跑 npm run judge:verify）')
        }
      } else {
        if (p.verified !== true) {
          add('error', 'NONCODE-VERIFIED', where, '非代码题按 Schema 说明 verified 固定 true')
        }
        const gap = nonCodeAnswerGap(p)
        if (gap) add(gap.level, 'NONCODE-ANSWER-MISSING', where, gap.msg)
      }
    }
  }

  /* ---- C. index.json 与分片双向一致 ---- */
  const indexPath = join(PROBLEM_DIR, 'index.json')
  if (!existsSync(indexPath)) {
    add('error', 'INDEX-MISSING', 'problems/index.json', '不存在，跑 npm run build:index 生成')
  } else {
    const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>
    const items = Array.isArray(idx.problems) ? (idx.problems as Array<Record<string, unknown>>) : []
    const idxIds = new Set<string>()
    for (const it of items) {
      const id = typeof it.id === 'string' ? it.id : ''
      if (idxIds.has(id)) add('error', 'INDEX-DUP', 'index.json', 'id 重复：' + id)
      idxIds.add(id)
      if (!problemIds.has(id)) add('error', 'INDEX-EXTRA', 'index.json', '索引里有分片里没有的题：' + id)
      const owner = seenId.get(id)
      if (owner && it.file !== owner) {
        add('error', 'INDEX-FILE', 'index.json', id + ' 索引指向 ' + String(it.file) + '，实际在 ' + owner)
      }
    }
    for (const id of problemIds) if (!idxIds.has(id)) add('error', 'INDEX-MISSING-ID', 'index.json', '分片里有但索引没有：' + id)
    if (idx.count !== items.length) add('error', 'INDEX-COUNT', 'index.json', 'count=' + String(idx.count) + ' 与 problems 长度 ' + items.length + ' 不符')
  }

  /* ---- D. 三向引用不悬空 ---- */
  const knowledgeNodes = collectRefs(join(DATA, 'knowledge'), ['relatedProblems'])
  const vizNodes = collectRefs(join(DATA, 'viz'), ['relatedProblems'])
  if (knowledgeNodes.length === 0) add('warn', 'CORPUS-EMPTY', 'data/knowledge', '知识卡片语料为空（阶段 5 交付），引用检查此刻只能验「题目侧不外链」')
  if (vizNodes.length === 0) add('warn', 'CORPUS-EMPTY', 'data/viz', '演示语料为空（阶段 6 交付），同上')

  for (const shard of shards) {
    for (const p of shard.problems) {
      for (const k of strArr(p.knowledgeIds)) {
        if (!knowledgeIds.has(k)) add('error', 'REF-DANGLING', shard.file + ' ' + p.id, 'knowledgeIds 指向不存在的卡片 ' + k)
      }
      for (const v of strArr(p.vizIds)) {
        if (!vizIds.has(v)) add('error', 'REF-DANGLING', shard.file + ' ' + p.id, 'vizIds 指向不存在的演示 ' + v)
      }
    }
  }
  for (const n of knowledgeNodes) {
    for (const rp of n.problems) if (!problemIds.has(rp)) add('error', 'REF-DANGLING-REV', n.file + ' ' + n.id, 'relatedProblems 指向不存在的题 ' + rp)
    for (const rk of n.knowledge) if (!knowledgeIds.has(rk)) add('error', 'REF-DANGLING-REV', n.file + ' ' + n.id, 'relatedKnowledge 指向不存在的卡片 ' + rk)
    for (const rv of n.viz) if (!vizIds.has(rv)) add('error', 'REF-DANGLING-REV', n.file + ' ' + n.id, 'relatedViz 指向不存在的演示 ' + rv)
  }
  for (const n of vizNodes) {
    for (const rp of n.problems) if (!problemIds.has(rp)) add('error', 'REF-DANGLING-REV', n.file + ' ' + n.id, 'relatedProblems 指向不存在的题 ' + rp)
  }

  if (problemCount === 0) add('error', 'NO-DATA', 'data/problems', '一道题都没有')
  if (strict) return issues.map((i) => (i.level === 'warn' && STRICT_PROMOTES.has(i.code) ? { ...i, level: 'error' as Level } : i))
  return issues
}

/* ========================= 自检：证明闸门真的会拦 ========================= */

function selfTest(): number {
  const cmap = loadChapterMap()
  const good: ProblemLike = {
    id: 'c-ch05-tf-900',
    type: 'true_false',
    category: 'c',
    chapter: cmap.categories.c.chapters[4].chapter,
    section: '5.9 自测',
    source: '自测样本',
    difficulty: 1,
    bloom: 'remember',
    stem: '自测题干',
    explanation: '自测解析',
    answer: true,
    verified: true,
  }
  const base = (): ShardFile[] => [{
    file: 'c-ch05.json',
    category: 'c',
    chapter: cmap.categories.c.chapters[4].chapter,
    problems: [JSON.parse(JSON.stringify(good)) as ProblemLike],
  }]
  const codesOf = (shards: ShardFile[]): Set<string> => new Set(checkAll(shards, false).map((i) => i.code))

  interface Case { name: string; mutate: (s: ShardFile[]) => void; expect: string }
  const cases: Case[] = [
    { name: '多塞一个 Schema 里没有的 score', mutate: (s) => { s[0].problems[0].score = 10 }, expect: 'SCHEMA' },
    { name: 'id 重复', mutate: (s) => { s[0].problems.push(JSON.parse(JSON.stringify(good)) as ProblemLike) }, expect: 'ID-DUP' },
    { name: 'knowledgeIds 指向不存在的卡片', mutate: (s) => { s[0].problems[0].knowledgeIds = ['ds-ch09-nope'] }, expect: 'REF-DANGLING' },
    { name: 'expected 末尾多写换行', mutate: (s) => { const p = s[0].problems[0]; p.type = 'programming'; p.testCases = [{ stdin: '1', expected: '1\n' }] }, expect: 'LINE-ENDING' },
    { name: '文件名不在章节表里', mutate: (s) => { s[0].file = 'c-ch99.json' }, expect: 'SHARD-UNKNOWN' },
    { name: '题放错分片（同 category 换一章）', mutate: (s) => { s[0].file = 'c-ch06.json' }, expect: 'ID-FILE' },
    { name: 'chapter 字符串与 id 前缀不符', mutate: (s) => { s[0].problems[0].chapter = '第7章 造一个不匹配的章名' }, expect: 'ID-CHAPTER' },
    { name: 'section 节号不属于该章', mutate: (s) => { s[0].problems[0].section = '9.1 造一个不匹配的节号' }, expect: 'SECTION-CHAPTER' },
    { name: '缺 source', mutate: (s) => { delete s[0].problems[0].source }, expect: 'SOURCE' },
    { name: '非代码题 verified 不为 true', mutate: (s) => { s[0].problems[0].verified = false }, expect: 'NONCODE-VERIFIED' },
    { name: '代码题 verified:true 但报告里没有实机记录', mutate: (s) => { const p = s[0].problems[0]; p.type = 'code_reading'; p.code = String.fromCharCode(35) + 'include <stdio.h>'; p.answer = 'x' }, expect: 'VERIFIED-NO-PROOF' },
    { name: '非代码题 verified:true 但 answer 为空', mutate: (s) => { s[0].problems[0].answer = '' }, expect: 'NONCODE-ANSWER-MISSING' },
    { name: 'fill_blank verified:true 但 blanks[].answer 为空', mutate: (s) => { const p = s[0].problems[0]; p.type = 'fill_blank'; delete p.answer; p.blanks = [{ index: 1, answer: '  ' }] }, expect: 'NONCODE-ANSWER-MISSING' },
  ]

  const baseline = codesOf(base())
  const caseCodes = cases.map((c) => c.expect)
  const polluted = [...baseline].filter((code) => caseCodes.includes(code))
  let failures = 0
  console.log('[self-test] 基线触发的码（合成数据未破坏时就有的）：' + ([...baseline].join(', ') || '（无）'))
  console.log('[self-test] 基线里的 INDEX-* 与 CORPUS-EMPTY 属环境噪声：合成题不在真实 index.json 里，知识/演示语料也还空着')
  console.log('[self-test] 正例：基线不得包含 ' + caseCodes.length + ' 个受检错误码中的任何一个 → ' + (polluted.length === 0 ? 'PASS' : 'FAIL ' + polluted.join(',')))
  if (polluted.length !== 0) failures += 1
  for (const c of cases) {
    const shards = base()
    c.mutate(shards)
    const codes = codesOf(shards)
    const hit = codes.has(c.expect) && !baseline.has(c.expect)
    if (!hit) failures += 1
    console.log('[self-test] ' + (hit ? 'PASS' : 'FAIL') + '  ' + c.name + ' → 期望被 ' + c.expect + ' 拦下' + (hit ? '' : '，实得 ' + [...codes].join(',')))
  }
  console.log(failures === 0 ? '[self-test] ' + cases.length + '/' + cases.length + ' 负例全部被拦下，闸门有效' : '[self-test] ' + failures + ' 项失效')
  return failures
}

/* ============================== 主流程 ============================== */

const args = process.argv.slice(2)
if (args.includes('--self-test')) {
  process.exit(selfTest() === 0 ? 0 : 1)
}

const strict = args.includes('--strict')
const shards = loadShards()
const issues = checkAll(shards, strict)

for (const shard of shards) {
  console.log('分片 ' + shard.file.padEnd(14) + ' category=' + shard.category.padEnd(3) + ' 题数=' + shard.problems.length + '  chapter=' + shard.chapter)
}
console.log('')
if (issues.length === 0) console.log('无告警')
for (const i of issues) console.log((i.level === 'error' ? '✗ ERROR ' : '! WARN  ') + '[' + i.code + '] ' + i.where + ' —— ' + i.msg)

let doc04Errors = 0
if (args.includes('--doc04')) {
  const validate = buildValidator()
  const doc = readFileSync(join(ROOT, '04_题型规范与样例.md'), 'utf8')
  const samples = readDocSamples(doc)
  let pass = 0
  for (const s of samples) {
    if (validate(s)) pass += 1
    else {
      doc04Errors += 1
      console.log('✗ ERROR [DOC04-SCHEMA] ' + s.id + ' —— ' + (validate.errors ?? []).map((e) => (e.instancePath || '(根)') + ' ' + e.message).join('; '))
    }
  }
  console.log('04 样例 Schema 校验：' + pass + '/' + samples.length + ' 通过（04 的 chapter 是示例文本，不参与 chapter-map 一致性核对）')
}

const issueErrs = issues.filter((i) => i.level === 'error').length
const warns = issues.length - issueErrs
const errs = issueErrs + doc04Errors
console.log('')
console.log('题目总数 ' + shards.reduce((n, s) => n + s.problems.length, 0) + ' · error ' + errs + ' · warn ' + warns + (strict ? '（--strict：未实机验证的代码题计为 error）' : ''))
process.exit(errs === 0 ? 0 : 1)
