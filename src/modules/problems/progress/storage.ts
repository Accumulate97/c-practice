/**
 * 进度数据的**落盘层**：把 schema.ts 的版本裁决接到 zustand persist 上。
 *
 * ── 为什么要自己写一层 storage，而不是直接用 persist 的 migrate 选项 ──────
 * persist 的 migrate(persisted, version) 只给你「解析后的 state」，拿不到原始字节。
 * 而本项目的硬要求是：版本不认识时**先备份原文再重置**。备份必须备份原始字符串 ——
 * 一旦解析失败（JSON 被截断 / 被别的扩展写坏），解析后的 state 根本不存在，
 * 只有原文能救。所以版本裁决放在 getItem 里做，那里手里正是原文。
 *
 * ── 三条不会破例的规矩 ────────────────────────────────────────────────
 *   1. 任何情况下都不返回 null 来「当作没有进度」以外的语义：读不出来 = 空进度 + 一条 issue，
 *      原文一定先落到备份键，绝不静默丢弃；
 *   2. 写失败（QuotaExceeded / 隐私模式）不抛给调用方 —— 抛出去会让学生以为判分失败，
 *      实际判分早就成功了；改为记 issue + 降级重写（先丢掉可再生的 lastAnswer 重试一次）；
 *   3. 备份只保留最近 3 份，避免反复异常把 5 MB 配额吃光。
 */
import type { StateStorage } from 'zustand/middleware'
import { PROGRESS_KEY } from '../../../app/config'
import { PROGRESS_SCHEMA_VERSION, migrateRecords } from './schema'
import type { ProgressMap } from './schema'

/** 备份键前缀。键名带时间戳，多次异常各自留一份，不互相覆盖 */
export const PROGRESS_BACKUP_PREFIX = `${PROGRESS_KEY}:backup:`
const MAX_BACKUPS = 3

/**
 * 落盘层的异常台账。UI（ProgressPage）读它如实告诉学生「你的进度发生过什么」，
 * 而不是让迁移/备份/配额这些事悄悄发生。
 */
export type ProgressIssue =
  | { kind: 'migrated'; from: number; steps: number[]; dropped: number }
  | { kind: 'reset-after-backup'; reason: 'newer-version' | 'unknown-version'; from: number | null; backupKey: string | null }
  | { kind: 'parse-error'; backupKey: string | null }
  | { kind: 'read-failed'; message: string }
  | { kind: 'write-failed'; message: string; recovered: boolean }

let issues: ProgressIssue[] = []

/** 只读快照（不消费）：ProgressPage 挂载时取一次即可 */
export function progressIssues(): readonly ProgressIssue[] {
  return issues
}

/** 学生在 UI 上点「知道了」后清空台账（不影响已落盘的备份文件） */
export function dismissProgressIssues(): void {
  issues = []
}

function push(issue: ProgressIssue): void {
  // 台账自身也要有上限：反复写失败时不要把内存吃满
  if (issues.length >= 20) issues = issues.slice(-19)
  issues.push(issue)
}

function envelope(records: ProgressMap): string {
  return JSON.stringify({ state: { records }, version: PROGRESS_SCHEMA_VERSION })
}

function safeLocalStorage(): Storage | null {
  try {
    const probe = '__cpractice_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    // Safari 隐私模式 / 禁用站点数据：localStorage 访问直接抛
    return null
  }
}

/** 把原文备份到旁路键，返回备份键名；备份本身失败则返回 null（并如实记进台账） */
function backupRaw(raw: string, tag: string): string | null {
  const store = safeLocalStorage()
  if (store === null) return null
  const key = `${PROGRESS_BACKUP_PREFIX}${Date.now()}-${tag}`
  try {
    store.setItem(key, raw)
  } catch {
    push({ kind: 'write-failed', message: `进度备份写入失败（${key}），原文未能保留`, recovered: false })
    return null
  }
  pruneBackups(store)
  return key
}

function pruneBackups(store: Storage): void {
  const keys: string[] = []
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i)
    if (k !== null && k.startsWith(PROGRESS_BACKUP_PREFIX)) keys.push(k)
  }
  if (keys.length <= MAX_BACKUPS) return
  keys.sort()
  for (const k of keys.slice(0, keys.length - MAX_BACKUPS)) {
    try {
      store.removeItem(k)
    } catch {
      /* 删不掉就算了，下一次备份再试 */
    }
  }
}

/** 备份键清单（ProgressPage 的「数据急救」区展示，让学生知道原文还在） */
export function listBackups(): { key: string; bytes: number }[] {
  const store = safeLocalStorage()
  if (store === null) return []
  const out: { key: string; bytes: number }[] = []
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i)
    if (k === null || !k.startsWith(PROGRESS_BACKUP_PREFIX)) continue
    let bytes = 0
    try {
      bytes = (store.getItem(k) ?? '').length
    } catch {
      bytes = 0
    }
    out.push({ key: k, bytes })
  }
  return out.sort((a, b) => (a.key < b.key ? 1 : -1))
}

function readItem(name: string): string | null {
  const store = safeLocalStorage()
  if (store === null) {
    push({ kind: 'read-failed', message: '浏览器拒绝访问 localStorage（隐私模式或站点数据被禁用），本次进度只在内存里，刷新即丢' })
    return null
  }
  let raw: string | null
  try {
    raw = store.getItem(name)
  } catch (error) {
    push({ kind: 'read-failed', message: error instanceof Error ? error.message : String(error) })
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const backupKey = backupRaw(raw, 'parse-error')
    push({ kind: 'parse-error', backupKey })
    return envelope({})
  }

  const shape = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const state = typeof shape.state === 'object' && shape.state !== null ? (shape.state as Record<string, unknown>) : {}
  const outcome = migrateRecords(state.records, shape.version)

  if (outcome.kind === 'ok') {
    if (outcome.steps.length > 0 || outcome.dropped > 0) {
      push({ kind: 'migrated', from: typeof shape.version === 'number' ? shape.version : PROGRESS_SCHEMA_VERSION, steps: outcome.steps, dropped: outcome.dropped })
    }
    return envelope(outcome.records)
  }

  // 版本比程序新 / 链上缺环：不猜含义，备份原文后从空进度开始
  const backupKey = backupRaw(raw, outcome.kind)
  push({ kind: 'reset-after-backup', reason: outcome.kind, from: outcome.from, backupKey })
  return envelope({})
}

function writeItem(name: string, value: string): void {
  const store = safeLocalStorage()
  if (store === null) {
    push({ kind: 'write-failed', message: 'localStorage 不可用，进度无法保存', recovered: false })
    return
  }
  try {
    store.setItem(name, value)
    return
  } catch {
    /* 落到下面的降级重写 */
  }
  // 降级：lastAnswer 是唯一「可再生」的大字段（重新提交一次就有），先丢它换配额
  let slim = value
  try {
    const parsed = JSON.parse(value) as { state?: { records?: ProgressMap } }
    const records = parsed.state?.records ?? {}
    for (const r of Object.values(records)) {
      r.lastAnswer = null
      r.lastAnswerKind = null
      r.lastAnswerTruncated = false
    }
    slim = JSON.stringify(parsed)
    store.setItem(name, slim)
    push({ kind: 'write-failed', message: 'localStorage 配额不足，已丢弃「最后一次提交内容」后保存成功（其余进度完好）', recovered: true })
  } catch (error) {
    push({
      kind: 'write-failed',
      message: `进度保存失败：${error instanceof Error ? error.message : String(error)}。判分结论已生效，但刷新后会丢`,
      recovered: false,
    })
  }
}

/**
 * 交给 persist 的 storage。getItem 出来的信封永远是当前版本，
 * 所以 persist 自己的 migrate 不会被触发（version 恒等于 PROGRESS_SCHEMA_VERSION）。
 */
export const progressStorage: StateStorage = {
  getItem: readItem,
  setItem: writeItem,
  removeItem: (name: string) => {
    const store = safeLocalStorage()
    if (store === null) return
    try {
      store.removeItem(name)
    } catch {
      /* 删不掉不影响正确性 */
    }
  },
}