/**
 * 阶段 3 · 索引与搜索源生成。
 *
 * 为什么要生成文件而不是运行时现算：纯静态站没有后端，首页/列表页只读小索引，
 * 点开某一章才 fetch 对应分片（任务书第二节第 4 条「按章节分片 + 索引文件，前端懒加载」）。
 *
 * 产出（全部带 GENERATED 头，禁止手工编辑，改了也会被下次生成覆盖）：
 *   public/data/problems/index.json    分片清单 + 题目卡片（列表页与 verify-data 的一致性核对对象）
 *   public/data/search/problems.json   搜索索引源（MiniSearch 在浏览器里拿这份建内存索引）
 *   public/data/knowledge/index.json   知识卡片索引（阶段 5 之前是空壳，但路径先定死）
 *   public/data/viz/index.json         演示索引（阶段 7：由 npm run gen:viz 产出的语料汇总）
 *
 * 用法：node scripts/build-index.ts
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const PROBLEM_DIR = join(DATA, 'problems')
const NON_SHARD = new Set(['index.json', 'verification-report.json'])
/** 下划线前缀 = 转换期 sidecar（_index.json 总账 / _judge-evidence.json 实机证据），不是题目分片。
 *  当分片扫会误报 SHARD-UNKNOWN，还会被 build:index 当成 0 题分片写进索引清单；
 *  仍留在 public/ 下，是为降级模式能 fetch 构建期预存 stdout（AGENTS.md 二·5）。 */
const isShardName = (name: string): boolean =>
  name.endsWith('.json') && !name.startsWith('_') && !NON_SHARD.has(name)
const GENERATED = 'GENERATED — 由 npm run build:index 生成，禁止手工编辑（手改会被覆盖）'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

interface ProblemLike { id: string; type: string; [key: string]: unknown }
interface Shard { file: string; category: unknown; chapter: unknown; problems: ProblemLike[] }

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function loadProblemShards(): Shard[] {
  const out: Shard[] = []
  for (const name of readdirSync(PROBLEM_DIR).sort()) {
    if (!isShardName(name)) continue
    const parsed = readJson(join(PROBLEM_DIR, name)) as Record<string, unknown>
    out.push({
      file: name,
      category: parsed.category,
      chapter: parsed.chapter,
      problems: Array.isArray(parsed.problems) ? (parsed.problems as ProblemLike[]) : [],
    })
  }
  return out
}

/**
 * 构建期实测的数据缺口计数，写进 index.json 的 defects 字段供前端文案读取。
 *
 * 为什么要落进数据而不是写在前端注释里：阶段 4 的 CodeReadingRenderer 与 grading/exact.ts
 * 都硬编码了「19 道 answer 为空」，而 4dac8d1 那轮补参考实现之后实测已经是 21 道 ——
 * 数字写在文案里就一定会烂，写在生成物里才会跟着数据一起变。
 *
 * 口径与 grading/exact.ts 的 readingTarget() 完全一致：type=code_reading、code 非空、
 * answer 去空白后为空 → 该题必然走「无法判分（数据缺陷）」分支，不进判分。
 */
interface DefectTally {
  codeReadingNoAnswer: number
}

function computeDefects(list: Shard[]): DefectTally {
  let codeReadingNoAnswer = 0
  for (const s of list) {
    for (const p of s.problems) {
      if (p.type !== 'code_reading') continue
      const code = typeof p.code === 'string' ? p.code : ''
      const answer = typeof p.answer === 'string' ? p.answer : ''
      if (code.trim().length === 0) continue
      if (answer.trim().length === 0) codeReadingNoAnswer += 1
    }
  }
  return { codeReadingNoAnswer }
}

/** 卡片摘要：列表页只认这些字段，正文与代码留在分片里按需加载 */
function cardOf(p: ProblemLike, file: string): Record<string, unknown> {
  const tags = Array.isArray(p.tags) ? p.tags : []
  return {
    id: p.id,
    type: p.type,
    category: p.category,
    chapter: p.chapter,
    section: p.section,
    difficulty: p.difficulty,
    bloom: p.bloom,
    verified: p.verified === true,
    tags,
    /** 列表页展示用的短标题：取题干第一个标点前的部分，避免把整段代码提示铺满屏幕 */
    title: firstClause(String(p.stem ?? '')),
    file,
  }
}

function firstClause(stem: string): string {
  const flat = stem.replace(/\s+/g, ' ').trim()
  const m = flat.match(/^[^。；：:;，,（(]{1,60}/)
  return m ? m[0] : flat.slice(0, 40)
}

/** 某目录下所有带 id 的对象（知识卡片/演示都按这个宽松口径收，缺失即空） */
function collectIds(dir: string, key: string): ProblemLike[] {
  if (!existsSync(dir)) return []
  const out: ProblemLike[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!isShardName(name)) continue
    walk(readJson(join(dir, name)))
  }
  return out

  function walk(value: unknown): void {
    if (Array.isArray(value)) { for (const v of value) walk(v); return }
    if (!value || typeof value !== 'object') return
    const o = value as Record<string, unknown>
    if (typeof o.id === 'string') out.push(o as unknown as ProblemLike)
    for (const k of Object.keys(o)) if (k !== 'id') walk(o[k])
  }
  // key 参数只用于日志，收集口径见上
  void key
}

/** 生成物用「内容指纹」而不是时间戳：同样的输入必须产出字节相同的文件，
 *  否则每跑一次 build:index 就有 4 个文件在 git status 里假变更，
 *  也没法用 `build:index && git diff --exit-code` 检测有人手工编辑过 index。 */
const CONTENT_SHA = '__CONTENT_SHA__'
const shards = loadProblemShards()
const cards = shards.flatMap((s) => s.problems.map((p) => cardOf(p, s.file)))

const problemIndex = {
  _generated: GENERATED,
  content_sha: CONTENT_SHA,
  schema_version: 1,
  data_version: pkg.version,
  count: cards.length,
  shard_count: shards.length,
  shards: shards.map((s) => ({
    file: s.file,
    category: s.category,
    chapter: s.chapter,
    count: s.problems.length,
    /** 前端懒加载用的相对路径，配合 src/app/config.ts 的 dataUrl() */
    url: 'data/problems/' + s.file,
  })),
  problems: cards,
  defects: computeDefects(shards),
}

const searchDocs = cards.map((c) => ({
  id: c.id,
  file: c.file,
  title: c.title,
  tags: c.tags,
  chapter: c.chapter,
  section: c.section,
  type: c.type,
  category: c.category,
}))

const searchIndex = {
  _generated: GENERATED,
  content_sha: CONTENT_SHA,
  /** 前端 MiniSearch 的字段配置，写进数据以免两边口径不一致 */
  fields: ['title', 'tags', 'chapter', 'section'],
  enrichStrategies: ['minisearch-stemmer:en'],
  count: searchDocs.length,
  docs: searchDocs,
}

/**
 * 知识卡片索引（阶段 10-1 起承载列表页）。
 *
 * 分片口径与题目侧完全一致：扫目录 + isShardName() 过滤，新增分片重跑本脚本即自动收录，
 * 前端不需要改路由表或写死章数（AGENTS.md 通用化要求：禁止硬编码数量）。
 *
 * summary / keyPoints 进索引是有体积代价的，但列表页要显示「标题 + 要点摘要」；
 * 不进索引就得为一行摘要把 20 个分片（≈1.2 MB）全拉下来，那个代价大得多。
 * 正文 content、示例代码、易错点仍留在分片里，由详情页按 file 懒加载。
 */
interface KnowledgeShard { file: string; category: unknown; chapter: unknown; cards: Record<string, unknown>[] }

function loadKnowledgeShards(): KnowledgeShard[] {
  const dir = join(DATA, 'knowledge')
  if (!existsSync(dir)) return []
  const out: KnowledgeShard[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!isShardName(name)) continue
    const parsed = readJson(join(dir, name)) as Record<string, unknown>
    out.push({
      file: name,
      category: parsed.category,
      chapter: parsed.chapter,
      cards: Array.isArray(parsed.cards) ? (parsed.cards as Record<string, unknown>[]) : [],
    })
  }
  return out
}

function knowledgeIndexShaped(): Record<string, unknown> {
  const kShards = loadKnowledgeShards()
  const kCards = kShards.flatMap((s) =>
    s.cards.map((c) => ({
      id: String(c.id),
      /** 详情页据此定位分片，不再靠 id 前缀猜文件名 */
      file: s.file,
      category: typeof c.category === 'string' ? c.category : s.category,
      chapter: typeof c.chapter === 'string' ? c.chapter : s.chapter,
      section: typeof c.section === 'string' ? c.section : '',
      order: typeof c.order === 'number' ? c.order : 0,
      title: (c.title as string | undefined) ?? firstClause(String(c.summary ?? '')),
      summary: typeof c.summary === 'string' ? c.summary : '',
      keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints.filter((k): k is string => typeof k === 'string') : [],
      relatedProblems: Array.isArray(c.relatedProblems) ? c.relatedProblems : [],
      relatedViz: Array.isArray(c.relatedViz) ? c.relatedViz : [],
    })),
  )
  return {
    _generated: GENERATED,
    content_sha: CONTENT_SHA,
    count: kCards.length,
    shard_count: kShards.length,
    cards: kCards,
  }
}

function vizIndexShaped(): Record<string, unknown> {
  const nodes = collectIds(join(DATA, 'viz'), 'demos')
  return {
    _generated: GENERATED,
    content_sha: CONTENT_SHA,
    count: nodes.length,
    demos: nodes.map((n) => ({
      id: n.id,
      chapter: n.chapter,
      title: n.title ?? n.id,
      relatedProblems: Array.isArray(n.relatedProblems) ? n.relatedProblems : [],
      // 阶段 7 起索引带上列表页必需的展示字段：渲染器种类、分类、步数、语料相对地址。
      // steps 只存条数不存内容 —— 完整快照留在 {id}.json，列表页不为它付流量。
      renderer: n.renderer,
      category: n.category,
      steps: Array.isArray(n.steps) ? n.steps.length : 0,
      url: 'data/viz/' + n.id + '.json',
    })),
  }
}

function emit(rel: string, value: unknown): void {
  const path = join(DATA, rel)
  /** 目录可能还不存在（search/ 与阶段 5、6 的 knowledge/ viz/），先生成再写 */
  mkdirSync(dirname(path), { recursive: true })
  // 指纹覆盖「除自身以外的全部字节」：把占位符写进序列化结果再算，最后回填
  const body = JSON.stringify({ ...(value as Record<string, unknown>), content_sha: CONTENT_SHA }, null, 2)
  const sha = createHash('sha256').update(body).digest('hex').slice(0, 16)
  writeFileSync(path, body.replace(CONTENT_SHA, sha) + '\n', 'utf8')
  console.log('生成 ' + rel + '  (' + readFileSync(path, 'utf8').length + ' 字符  内容指纹=' + sha + ')')
}

emit(join('problems', 'index.json'), problemIndex)
emit(join('search', 'problems.json'), searchIndex)
const knowledgeIndex = knowledgeIndexShaped()
const vizIndex = vizIndexShaped()
emit(join('knowledge', 'index.json'), knowledgeIndex)
emit(join('viz', 'index.json'), vizIndex)
console.log('题目 ' + cards.length + ' 道 / 分片 ' + shards.length + ' 个；知识卡片 ' + Number(knowledgeIndex.count) + ' 张 / 演示 ' + Number(vizIndex.count) + ' 个')
console.log('数据缺口：code_reading 缺 answer ' + problemIndex.defects.codeReadingNoAnswer + ' 道（不进判分，前端文案从这里读）')

/**
 * 勘误表同步（阶段 10-3）。真源是 docs/errata.md，站内 #/errata 渲染的是它的副本 ——
 * 顺手在生成索引时拷一份，杜绝「文档改了站点没改」的漂移；文档缺失只提示、不阻断索引生成。
 */
const ERRATA_SRC = join(ROOT, 'docs', 'errata.md')
if (existsSync(ERRATA_SRC)) {
  const errataDest = join(DATA, 'errata.md')
  copyFileSync(ERRATA_SRC, errataDest)
  console.log('同步 docs/errata.md → data/errata.md  (' + readFileSync(errataDest, 'utf8').length + ' 字符)')
} else {
  console.log('! 未找到 docs/errata.md，跳过勘误表同步（站内 #/errata 会走空状态）')
}
