/**
 * 掌握度热力图数据（阶段 D2）：章节 × 题型 的掌握程度矩阵。
 *
 * 口径与 stats.ts 完全同源（passed=everPassed、正确率只算机器判分），
 * 纯函数、不联网；页面只渲染，不自己算。
 * 空格子（该章该题型 0 题）与「有题但全未做」必须区分：
 * 前者 level='none'（不该存在努力），后者 level=0（还没开始）。
 */
import type { ProblemIndex, ProblemIndexEntry } from '../data/loader'
import { TYPE_ORDER, shardKey, typeLabel } from '../type-meta'
import { statusOf } from './store'
import type { ProgressMap } from './schema'

export interface HeatCell {
  total: number
  passed: number
  attempted: number
  todo: number
  /** 机器判分提交次数 / 其中失败次数 */
  attempts: number
  wrongCount: number
  /** 通过率 passed/total；total=0 时为 null */
  passRate: number | null
  /** 机器判分正确率；attempts=0 时为 null */
  accuracy: number | null
  /** 'none'=该章无此题型；0=全未做；1=做过但 0 通过；2=通过<50%；3=通过≥50%；4=全通过 */
  level: 'none' | 0 | 1 | 2 | 3 | 4
}

export interface HeatRow {
  /** 分片键（c-ch01 / ds-ch06…），全局唯一 */
  key: string
  label: string
  category: 'c' | 'ds'
  cells: Map<string, HeatCell>
}

export interface HeatmapData {
  rows: HeatRow[]
  /** 全库题量>0 的题型列，TYPE_ORDER 顺序 */
  types: string[]
}

function emptyCell(): HeatCell {
  return { total: 0, passed: 0, attempted: 0, todo: 0, attempts: 0, wrongCount: 0, passRate: null, accuracy: null, level: 'none' }
}

function levelOf(c: { total: number; passed: number; attempted: number }): HeatCell['level'] {
  if (c.total === 0) return 'none'
  if (c.passed === c.total) return 4
  if (c.passed === 0) return c.attempted > 0 || c.passed > 0 ? 1 : 0
  const r = c.passed / c.total
  if (r >= 0.5) return 3
  return 2
}

function finishCell(c: HeatCell): HeatCell {
  c.passRate = c.total > 0 ? c.passed / c.total : null
  c.accuracy = c.attempts > 0 ? Math.min(1, Math.max(0, (c.attempts - c.wrongCount) / c.attempts)) : null
  c.level = levelOf(c)
  return c
}

export function computeHeatmap(index: ProblemIndex, records: ProgressMap): HeatmapData {
  const rowMap = new Map<string, HeatRow>()
  const typeTotals = new Map<string, number>()

  for (const entry of index.problems as ProblemIndexEntry[]) {
    const key = shardKey(entry.file)
    let row = rowMap.get(key)
    if (!row) {
      row = { key, label: `${entry.category === 'ds' ? 'DS' : 'C'} · ${entry.chapter}`, category: entry.category === 'ds' ? 'ds' : 'c', cells: new Map() }
      rowMap.set(key, row)
    }
    let cell = row.cells.get(entry.type)
    if (!cell) { cell = emptyCell(); row.cells.set(entry.type, cell) }
    cell.total += 1
    typeTotals.set(entry.type, (typeTotals.get(entry.type) || 0) + 1)
    const record = records[entry.id]
    if (record) {
      const status = statusOf(record)
      if (status === 'passed') cell.passed += 1
      else if (status === 'attempted') cell.attempted += 1
      else cell.todo += 1
      cell.attempts += record.attempts
      cell.wrongCount += record.wrongCount
    } else {
      cell.todo += 1
    }
  }

  const types = [...typeTotals.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0]); const ib = TYPE_ORDER.indexOf(b[0])
      if (ia === -1 && ib === -1) return b[1] - a[1] || (a[0] < b[0] ? -1 : 1)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
    .map(([t]) => t)

  // 行序 = 分片在 index.problems 里的首次出现顺序（与列表页章节排序同源）；空格子补 'none'
  const rows = [...rowMap.values()]
  for (const row of rows) {
    for (const t of types) {
      if (!row.cells.has(t)) row.cells.set(t, emptyCell())
    }
    for (const cell of row.cells.values()) finishCell(cell)
  }
  return { rows, types }
}

/** 单元格 title 提示文案：绝不把 null 显示成 0% 或 100% */
export function cellTitle(rowLabel: string, type: string, c: HeatCell): string {
  if (c.level === 'none') return `${rowLabel} · ${typeLabel(type)}：本章无此题型`
  const acc = c.accuracy === null ? '正确率暂无（未做过机器判分）' : `正确率 ${Math.round(c.accuracy * 100)}%`
  return `${rowLabel} · ${typeLabel(type)}：已通过 ${c.passed}/${c.total}（${acc}）`
}
