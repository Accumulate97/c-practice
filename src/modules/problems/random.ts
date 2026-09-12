/**
 * 每日一题 / 随机练习选题（阶段 D2）。纯函数、不联网：
 *   · 每日一题按「本地日期」做种子 —— 同一天里怎么刷新都是同一道，全站在同一天给同一道题；
 *   · 随机练习用 Math.random，每次点击都换。
 * 两者都只从 index.problems 里挑（列表页/首页已缓存该索引，不多发请求）。
 * 空索引（0 题）返回 null，由调用方如实提示，绝不编造 id。
 */
import type { ProblemIndex, ProblemIndexEntry } from './data/loader'

/** mulberry32：32 位种子的确定性 PRNG，够用且短 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 本地日期 → YYYYMMDD 整数种子（用本地时区，学生感知的是自己那天） */
export function dailySeed(date: Date = new Date()): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

export function pickDaily(index: ProblemIndex, date: Date = new Date()): ProblemIndexEntry | null {
  const list = index.problems
  if (list.length === 0) return null
  return list[Math.floor(mulberry32(dailySeed(date))() * list.length)] ?? null
}

export function pickRandom(index: ProblemIndex, rand: () => number = Math.random): ProblemIndexEntry | null {
  const list = index.problems
  if (list.length === 0) return null
  return list[Math.floor(rand() * list.length)] ?? null
}
