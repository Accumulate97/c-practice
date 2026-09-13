/**
 * 学习路径（任务 3-2）：把「学卡片 → 做例题 → 解锁下一关」编成两条闯关轨道。
 *
 * ── 为什么全部现算、不新增数据文件 ────────────────────────────────────
 * 关卡内容（每关的卡片 / 题目 / 演示）完全由三份既有索引派生：
 * problems/index.json + knowledge/index.json + viz/index.json，都带 chapter 字段。
 * 再存一份 path/index.json 就有两份真相，改一章就得记得同步两处 —— 现算零维护、永不过期。
 *
 * ── 通关口径（只用已有的进度字段，不动 progress schema）─────────────────
 * passed = record.everPassed（做对过一次就算，重做翻车不收回关卡）
 * target = clamp(ceil(本章题数 * 15%), 3, 12)：12 章 C + 8 章数据结构，
 *        全通关约需通过 160 题，占 2074 题的 8% —— 闯关要的是「走过一遍主线」，不是刷完题库。
 *
 * ── 解锁 ───────────────────────────────────────────────────────────
 * 两条轨道（C 语言 / 数据结构）各自独立解锁：数据结构第 1 关不该被 C 语言第 12 关卡住。
 * 轨道内严格顺序解锁，另留一个「自由模式」开关（localStorage cpractice:path:v1）：
 * 老手可以直接跳关，开关状态如实显示在页面上，不做隐性放行。
 */
import type { KnowledgeIndex, KnowledgeIndexEntry } from '../knowledge/data/loader'
import type { ProblemIndex, ProblemIndexEntry } from '../problems/data/loader'
import type { ProgressMap } from '../problems/progress/schema'
import type { VizIndexEntry } from '../viz/data/loader'

export type Track = 'c' | 'ds'
export const TRACKS: readonly Track[] = ['c', 'ds']
export const TRACK_LABEL: Record<Track, string> = { c: 'C 语言', ds: '数据结构' }

export interface PathLevel {
  /** `${category}|${chapter}`，与知识板块的 chapterKey 同构 */
  key: string
  track: Track
  chapter: string
  /** 轨道内 1-based 序号，UI 显示「第 N 关」 */
  order: number
  sections: string[]
  cards: KnowledgeIndexEntry[]
  problems: ProblemIndexEntry[]
  demos: VizIndexEntry[]
  /** 通关需要「通过」的题数 */
  target: number
}

export type LevelState = 'locked' | 'current' | 'open' | 'cleared'

export interface LevelProgress {
  attempted: number
  passed: number
  target: number
  percent: number
  cleared: boolean
}

export function targetFor(problemCount: number): number {
  return Math.min(12, Math.max(3, Math.ceil(problemCount * 0.15)))
}

/** 关卡按「索引里章节首次出现的顺序」编排：C 语言 1→12 章，数据结构 1→8 章 */
export function buildPath(problems: ProblemIndex, knowledge: KnowledgeIndex, demos: VizIndexEntry[]): PathLevel[] {
  const buckets = new Map<string, { track: Track; chapter: string; sections: Set<string>; problems: ProblemIndexEntry[] }>()
  for (const p of problems.problems) {
    const track: Track = p.category === 'ds' ? 'ds' : 'c'
    const key = `${track}|${p.chapter}`
    let b = buckets.get(key)
    if (!b) {
      b = { track, chapter: p.chapter, sections: new Set<string>(), problems: [] }
      buckets.set(key, b)
    }
    b.sections.add(p.section)
    b.problems.push(p)
  }
  const cardsByChapter = new Map<string, KnowledgeIndexEntry[]>()
  for (const c of knowledge.cards) {
    const track: Track = c.category === 'ds' ? 'ds' : 'c'
    const key = `${track}|${c.chapter}`
    const list = cardsByChapter.get(key)
    if (list) list.push(c)
    else cardsByChapter.set(key, [c])
  }
  const demosByChapter = new Map<string, VizIndexEntry[]>()
  for (const d of demos) {
    // 演示的 chapter 不带 category 前缀，两条轨道都可能引用同名章节（如「第6章 图」只在数据结构里）
    for (const key of [d.chapter, `c|${d.chapter}`, `ds|${d.chapter}`]) {
      if (!buckets.has(key)) continue
      const list = demosByChapter.get(key)
      if (list) { if (!list.includes(d)) list.push(d) } else demosByChapter.set(key, [d])
    }
  }

  const out: PathLevel[] = []
  const orderIn = new Map<Track, number>()
  for (const [key, b] of buckets) {
    const track = b.track
    const order = (orderIn.get(track) ?? 0) + 1
    orderIn.set(track, order)
    const cards = (cardsByChapter.get(key) ?? []).slice().sort((x, y) => x.order - y.order || (x.id < y.id ? -1 : 1))
    const levelDemos = (demosByChapter.get(key) ?? []).slice().sort((x, y) => (x.id < y.id ? -1 : 1))
    out.push({
      key,
      track,
      chapter: b.chapter,
      order,
      sections: [...b.sections].sort(),
      cards,
      problems: b.problems,
      demos: levelDemos,
      target: targetFor(b.problems.length),
    })
  }
  return out.sort((a, b) => (a.track === b.track ? a.order - b.order : a.track === 'c' ? -1 : 1))
}

export function levelProgress(level: PathLevel, records: ProgressMap): LevelProgress {
  let attempted = 0
  let passed = 0
  for (const p of level.problems) {
    const r = records[p.id]
    if (!r) continue
    if (r.attempts > 0 || r.selfAssessed) attempted += 1
    if (r.everPassed) passed += 1
  }
  return {
    attempted,
    passed,
    target: level.target,
    percent: level.target > 0 ? Math.min(100, Math.round((passed / level.target) * 100)) : 0,
    cleared: passed >= level.target,
  }
}

/**
 * 逐关判定状态。返回与 levels 等长的数组。
 * 轨道内第一关永远开放；此后「上一关通关」才解锁；自由模式下全部解锁。
 * current = 每条轨道里第一个已解锁但尚未通关的关卡（用来自动展开与「继续闯关」按钮）。
 */
export function levelStates(levels: PathLevel[], records: ProgressMap, freeMode: boolean): LevelState[] {
  const states: LevelState[] = new Array<LevelState>(levels.length).fill('locked')
  const progress = levels.map((l) => levelProgress(l, records))
  const currentSet = new Set<number>()
  for (const track of TRACKS) {
    const idx = levels.map((l, i) => ({ l, i })).filter((x) => x.l.track === track).map((x) => x.i)
    let currentPicked = false
    for (let n = 0; n < idx.length; n += 1) {
      const i = idx[n]
      if (i === undefined) continue
      const unlocked = freeMode || n === 0 || progress[idx[n - 1] ?? i]?.cleared === true
      if (!unlocked) { states[i] = 'locked'; continue }
      if (progress[i]?.cleared) { states[i] = 'cleared'; continue }
      if (!currentPicked) { states[i] = 'current'; currentSet.add(i); currentPicked = true } else states[i] = 'open'
    }
  }
  return states
}

export interface PathSummary {
  levels: number
  cleared: number
  currentKeys: string[]
  cards: number
  problems: number
  demos: number
  passed: number
}

export function pathSummary(levels: PathLevel[], states: LevelState[], records: ProgressMap): PathSummary {
  let passed = 0
  const seen = new Set<string>()
  for (const l of levels) for (const p of l.problems) { if (seen.has(p.id)) continue; seen.add(p.id); if (records[p.id]?.everPassed) passed += 1 }
  return {
    levels: levels.length,
    cleared: states.filter((s) => s === 'cleared').length,
    currentKeys: levels.filter((_, i) => states[i] === 'current').map((l) => l.key),
    cards: levels.reduce((a, l) => a + l.cards.length, 0),
    problems: seen.size,
    demos: new Set(levels.flatMap((l) => l.demos.map((d) => d.id))).size,
    passed,
  }
}

/**
 * 本关推荐练的题：还没做对过的优先，其次「做过但没对」（趁热改），最后才是没碰过的难题。
 * 同一档内按难度升序 —— 闯关要先易后难，一上来给 5 星题只会劝退。
 */
export function recommendProblems(level: PathLevel, records: ProgressMap, limit = 6): ProblemIndexEntry[] {
  const rank = (p: ProblemIndexEntry): number => {
    const r = records[p.id]
    if (r?.everPassed) return 3
    if (r && (r.attempts > 0 || r.selfAssessed)) return 0
    return 1
  }
  return level.problems
    .filter((p) => rank(p) < 3)
    .sort((a, b) => rank(a) - rank(b) || a.difficulty - b.difficulty || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
}
