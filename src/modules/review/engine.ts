/**
 * 复习引擎：把「判分事实」翻译成「复习计划」（任务 3-5 核心逻辑，纯函数）。
 *
 * ── 单一事实来源 ────────────────────────────────────────────────────────
 * 移箱只认两个证据，且都带时刻锚点（card.lastEventAt）：
 *   · record.lastWrongAt 比锚点新  → 确证失败，回 1 号箱（机器判过的事实优先于一切自评）
 *   · record.result==='passed' 且 record.lastAt 比锚点新 → 做对了，升一箱
 * 锚点存的正是记录里的那个时刻而不是 Date.now()，所以 sync 跑一百遍结果一样（幂等），
 * 同一事实绝不会被消费两次。手动按钮用 now 做锚点，之后的机器事件天然更新，照样生效。
 *
 * ── 收录口径 ────────────────────────────────────────────────────────────
 * 与错题本完全同源（inWrongBook）：在册且没有卡 → 收进 1 号箱、立即到期。
 * 错题本判「出册」（做对了 / 点了已掌握）不删卡 —— 间隔重复的意义恰恰是
 * 「现在对了不等于记住了」，卡片继续按箱号排期，直到 5 号箱毕业。
 * 毕业后再进错题本会重新收录，闭环。
 */
import type { ProblemIndex } from '../problems/data/loader'
import type { ProgressMap } from '../problems/progress/schema'
import { inWrongBook } from '../problems/progress/wrongbook'
import { MAX_BOX, dueAtFor, type ReviewCard, type ReviewState } from './schema'

export type ReviewChangeKind = 'added' | 'machine-passed' | 'machine-failed' | 'graduated' | 'manual-promote' | 'manual-demote'

export interface ReviewChange {
  id: string
  kind: ReviewChangeKind
  /** 变化后的箱号；graduated 时为 MAX_BOX */
  box: number
}

export interface SyncResult {
  state: ReviewState
  changes: ReviewChange[]
  changed: boolean
}

/** 进度事实 → 复习计划的同步。纯函数：不改入参，返回新对象；changed=false 时调用方不必写盘 */
export function syncWithProgress(prev: ReviewState, index: ProblemIndex, records: ProgressMap, now: number): SyncResult {
  const cards: Record<string, ReviewCard> = { ...prev.cards }
  const graduations: Record<string, number> = { ...prev.graduations }
  const changes: ReviewChange[] = []

  // ① 收录：错题本在册且没有卡
  for (const entry of index.problems) {
    const record = records[entry.id]
    if (!inWrongBook(record) || cards[entry.id]) continue
    // 毕业墓碑：毕业时刻不早于最近一次确证失败 → 不重新收录（又做错后墓碑自动失效）
    const grad = graduations[entry.id]
    if (grad !== undefined && (record?.lastWrongAt ?? 0) <= grad) continue
    cards[entry.id] = { box: 1, addedAt: now, dueAt: now, lastEventAt: now, lastEvent: 'added' }
    changes.push({ id: entry.id, kind: 'added', box: 1 })
  }

  // ② 移箱：只消费比锚点新的机器事实
  for (const [id, card] of Object.entries(cards)) {
    const record = records[id]
    if (!record) continue // 题目已不在索引（孤儿卡）：不动，UI 用 id 兜底显示
    const failedAt = record.lastWrongAt ?? 0
    if (failedAt > card.lastEventAt) {
      cards[id] = { ...card, box: 1, dueAt: now, lastEventAt: failedAt, lastEvent: 'machine-failed' }
      changes.push({ id, kind: 'machine-failed', box: 1 })
      continue
    }
    if (record.result === 'passed' && record.lastAt > card.lastEventAt) {
      if (card.box >= MAX_BOX) {
        delete cards[id]
        graduations[id] = record.lastAt
        changes.push({ id, kind: 'graduated', box: MAX_BOX })
      } else {
        const box = card.box + 1
        cards[id] = { ...card, box, dueAt: dueAtFor(box, record.lastAt), lastEventAt: record.lastAt, lastEvent: 'machine-passed' }
        changes.push({ id, kind: 'machine-passed', box })
      }
    }
  }

  return { state: { version: 1, savedAt: now, cards, graduations }, changes, changed: changes.length > 0 }
}

export interface ManualResult {
  state: ReviewState
  /** promote 到顶箱再答对 = 毕业（卡已移除） */
  graduated: boolean
  card: ReviewCard | null
}

/** 手动「这次做对了」：升一箱并按新箱号排期；5 号箱做对 = 毕业移除 */
export function manualPromote(prev: ReviewState, id: string, now: number): ManualResult {
  const card = prev.cards[id]
  if (!card) return { state: prev, graduated: false, card: null }
  if (card.box >= MAX_BOX) {
    const cards = { ...prev.cards }
    delete cards[id]
    return {
      state: { ...prev, savedAt: now, cards, graduations: { ...prev.graduations, [id]: now } },
      graduated: true,
      card: null,
    }
  }
  const box = card.box + 1
  const next: ReviewCard = { ...card, box, dueAt: dueAtFor(box, now), lastEventAt: now, lastEvent: 'manual-promote' }
  return { state: { ...prev, savedAt: now, cards: { ...prev.cards, [id]: next } }, graduated: false, card: next }
}

/** 手动「还是错了」：回 1 号箱。dueAt=now —— 留在今天队列里立刻重做，不假装「明天再说」 */
export function manualDemote(prev: ReviewState, id: string, now: number): ManualResult {
  const card = prev.cards[id]
  if (!card) return { state: prev, graduated: false, card: null }
  const next: ReviewCard = { ...card, box: 1, dueAt: now, lastEventAt: now, lastEvent: 'manual-demote' }
  return { state: { ...prev, savedAt: now, cards: { ...prev.cards, [id]: next } }, graduated: false, card: next }
}

/** 到期卡（含逾期），按到期时刻升序：欠得最久的排最前 */
export function dueCards(state: ReviewState, now: number): { id: string; card: ReviewCard }[] {
  return Object.entries(state.cards)
    .filter(([, c]) => c.dueAt <= now)
    .map(([id, card]) => ({ id, card }))
    .sort((a, b) => a.card.dueAt - b.card.dueAt || (a.id < b.id ? -1 : 1))
}

/** 未到期卡，按到期时刻升序（队列预览用） */
export function upcomingCards(state: ReviewState, now: number): { id: string; card: ReviewCard }[] {
  return Object.entries(state.cards)
    .filter(([, c]) => c.dueAt > now)
    .map(([id, card]) => ({ id, card }))
    .sort((a, b) => a.card.dueAt - b.card.dueAt || (a.id < b.id ? -1 : 1))
}

/** 每个箱的在册数量（统计条用） */
export function boxStats(state: ReviewState): { box: number; count: number }[] {
  const out = Array.from({ length: MAX_BOX }, (_, i) => ({ box: i + 1, count: 0 }))
  for (const c of Object.values(state.cards)) {
    const b = Math.min(MAX_BOX, Math.max(1, c.box))
    const slot = out[b - 1]
    if (slot) slot.count += 1
  }
  return out
}
