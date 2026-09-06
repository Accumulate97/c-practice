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
 *   public/data/viz/index.json         演示索引（阶段 6 同上）
 *
 * 用法：node scripts/build-index.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const PROBLEM_DIR = join(DATA, 'problems')
const NON_SHARD = new Set(['index.json', 'verification-report.json'])
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
    if (!name.endsWith('.json') || NON_SHARD.has(name)) continue
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
    if (!name.endsWith('.json') || NON_SHARD.has(name)) continue
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

function knowledgeIndexShaped(): Record<string, unknown> {
  const nodes = collectIds(join(DATA, 'knowledge'), 'cards')
  return {
    _generated: GENERATED,
    content_sha: CONTENT_SHA,
    count: nodes.length,
    cards: nodes.map((n) => ({
      id: n.id,
      chapter: n.chapter,
      section: n.section,
      title: n.title ?? firstClause(String(n.summary ?? '')),
      relatedProblems: Array.isArray(n.relatedProblems) ? n.relatedProblems : [],
      relatedViz: Array.isArray(n.relatedViz) ? n.relatedViz : [],
    })),
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
emit(join('knowledge', 'index.json'), knowledgeIndexShaped())
emit(join('viz', 'index.json'), vizIndexShaped())
console.log('题目 ' + cards.length + ' 道 / 分片 ' + shards.length + ' 个；知识卡片与演示当前为 0，属预期（阶段 5、6 交付）')
