/**
 * 错题重练的数据模型（Leitner 间隔重复，任务 3-5）。
 *
 * ── 为什么不塞进 progress schema ────────────────────────────────────────
 * 进度（cpractice:progress:v1）记录的是「机器判分 / 自评的既成事实」，带迁移链，动一次全链升版本；
 * 复习状态记录的是「学习计划」，本质是能从 进度 + 错题本 重算出来的派生数据。
 * 混进一个 schema 会让复习策略的每次调整都惊动进化的迁移链，所以独立存储槽
 * cpractice:review:v1：读坏了先备份原文再重建，进度毫发无损。
 *
 * ── Leitner 五箱 ────────────────────────────────────────────────────────
 * 卡片收录进 1 号箱；每「做对」一次升一箱，下次复习间隔按箱号取 1/2/4/7/15 天；
 * 「又做错」（机器判分确证失败，或学生自评）无条件回 1 号箱重新计时。
 * 5 号箱再做对 = 毕业，卡片移除（之后若再进错题本会重新收录）。
 * 遗忘曲线的要义是「记忆越稳，下次确认越晚」，箱号就是记忆稳定度的离散化。
 *
 * ── 诚实性红线（与 AGENTS.md 二·5 同源）─────────────────────────────────
 * 本模块只读判分事实、只写复习计划：不改 wrongCount、不碰正确率、不伪造「已掌握」。
 */
import { STORAGE_PREFIX } from '../../app/config'

/** 存储槽代号。与 progress 同理：槽名永不改动，结构升级走 version 字段 */
export const REVIEW_KEY = `${STORAGE_PREFIX}:review:v1`
/** 读坏时把原文备份到这里（键名带时间戳，多次异常各留一份） */
export const REVIEW_BACKUP_PREFIX = `${REVIEW_KEY}:backup:`

export const MAX_BOX = 5
/** 箱号 → 下次复习间隔（天）。index 0 = 1 号箱 */
export const BOX_INTERVALS_DAYS: readonly number[] = [1, 2, 4, 7, 15]

export type ReviewEventKind =
  | 'added'            // 首次收录（进错题本）
  | 'machine-passed'   // 机器判分/自评通过 → 自动升箱
  | 'machine-failed'   // 机器判分确证失败 → 自动回 1 号箱
  | 'manual-promote'   // 学生在复习页点「这次做对了」
  | 'manual-demote'    // 学生在复习页点「还是错了」

export interface ReviewCard {
  /** 1..5 */
  box: number
  /** 首次收录时刻 */
  addedAt: number
  /** 下次到期时刻；≤ now 即「该复习了」 */
  dueAt: number
  /** 最近一次移箱事件的锚点时刻。机器事件用记录里的 lastWrongAt / lastAt 原值，
   *  保证 syncWithProgress 幂等（同一事实不会被消费两次） */
  lastEventAt: number
  lastEvent: ReviewEventKind
}

export interface ReviewState {
  version: 1
  savedAt: number
  cards: Record<string, ReviewCard>
  /**
   * 毕业墓碑：id → 毕业时刻。手动毕业时进度记录往往还停留在「错题本在册」
   * （学生是在纸上重做的，机器记录没变），没有墓碑 sync 会立刻把它重新收录，
   * 毕业永远粘不住。收录前先查墓碑：最近一次确证失败不比墓碑新就不收；
   * 之后真又做错（lastWrongAt 更新）墓碑自动失效，重新进 1 号箱。
   */
  graduations: Record<string, number>
}

export function emptyReviewState(now: number): ReviewState {
  return { version: 1, savedAt: now, cards: {}, graduations: {} }
}

/** 箱号 → 间隔毫秒。越界箱号按边界钳制，防脏数据算出 NaN */
export function intervalMs(box: number): number {
  const b = Math.min(MAX_BOX, Math.max(1, Math.round(box)))
  return (BOX_INTERVALS_DAYS[b - 1] ?? 1) * 24 * 60 * 60 * 1000 // b 已钳到 1..5，?? 只为过 noUncheckedIndexedAccess
}

export function dueAtFor(box: number, from: number): number {
  return from + intervalMs(box)
}

function sanitizeCard(raw: unknown, now: number): ReviewCard | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const box = Math.min(MAX_BOX, Math.max(1, Math.round(num(c.box, 1))))
  const kinds: ReviewEventKind[] = ['added', 'machine-passed', 'machine-failed', 'manual-promote', 'manual-demote']
  const lastEvent = kinds.includes(c.lastEvent as ReviewEventKind) ? (c.lastEvent as ReviewEventKind) : 'added'
  return {
    box,
    addedAt: num(c.addedAt, now),
    dueAt: num(c.dueAt, now),
    lastEventAt: num(c.lastEventAt, now),
    lastEvent,
  }
}

export interface ReviewLoadResult {
  state: ReviewState
  /** 非 null = 读盘发生过异常（已备份重建 / 结构不认识），UI 必须如实告知 */
  issue: string | null
}

/**
 * 读盘。任何读不出来 / 解析失败 / 版本不认识，都先把原文备份再返回空状态 ——
 * 复习计划是可重算的派生数据，丢计划不丢事实，但绝不静默丢原文。
 */
export function loadReviewState(now: number): ReviewLoadResult {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(REVIEW_KEY)
  } catch {
    return { state: emptyReviewState(now), issue: '无法读取本地存储（可能是隐私模式），本次复习计划只存在于内存中。' }
  }
  if (raw === null) return { state: emptyReviewState(now), issue: null }
  const backup = (): string | null => {
    try {
      const key = `${REVIEW_BACKUP_PREFIX}${now}`
      localStorage.setItem(key, raw as string)
      return key
    } catch {
      return null
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const key = backup()
    return { state: emptyReviewState(now), issue: `复习计划解析失败，原文已备份到 ${key ?? '（备份也失败了）'}，已从空白重建。` }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    const key = backup()
    return { state: emptyReviewState(now), issue: `复习计划结构不认识，原文已备份到 ${key ?? '（备份也失败了）'}，已从空白重建。` }
  }
  const env = parsed as Record<string, unknown>
  if (env.version !== 1) {
    const key = backup()
    return { state: emptyReviewState(now), issue: `复习计划版本 ${String(env.version)} 不认识（当前只支持 1），原文已备份到 ${key ?? '（备份也失败了）'}，已从空白重建。` }
  }
  const cards: Record<string, ReviewCard> = {}
  const rawCards = typeof env.cards === 'object' && env.cards !== null ? (env.cards as Record<string, unknown>) : {}
  for (const [id, c] of Object.entries(rawCards)) {
    const card = sanitizeCard(c, now)
    if (card) cards[id] = card
  }
  const graduations: Record<string, number> = {}
  const rawGrad = typeof env.graduations === 'object' && env.graduations !== null ? (env.graduations as Record<string, unknown>) : {}
  for (const [id, t] of Object.entries(rawGrad)) {
    if (typeof t === 'number' && Number.isFinite(t) && t >= 0) graduations[id] = t
  }
  return { state: { version: 1, savedAt: num(env.savedAt, now), cards, graduations }, issue: null }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 写盘。失败返回人话错误信息（UI 如实展示），成功返回 null。绝不 throw。 */
export function saveReviewState(state: ReviewState): string | null {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(state))
    return null
  } catch (e) {
    return `复习计划保存失败（${e instanceof Error ? e.message : String(e)}）。本次改动只在内存里，刷新会丢。`
  }
}
