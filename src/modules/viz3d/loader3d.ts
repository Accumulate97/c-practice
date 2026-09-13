/**
 * 3D 馆语料加载（纯静态、无后端）。
 *
 * 与 2D 馆 loader.ts 同一口径：单飞 + 失败清缓存可重试，绝不缓存 rejected promise。
 * 差别只有一个：3D 馆的语料分散在两个目录（catalog.source 决定）——
 *   source='viz'   → data/viz/{id}.json   （复用 2D 语料，同一份文件、同一份步骤语义）
 *   source='viz3d' → data/viz3d/{id}.json （3D 专属语料，scripts/gen-viz3d.ts 生成）
 * 缓存键带上目录前缀，避免两个目录同名 id 互相覆盖。
 *
 * 列表页要的 title / steps / relatedProblems 从两个索引里合并（loadMetaMap）：
 * 索引缺失只影响徽标上的数字，不该让整个列表白屏，所以这里 allSettled 而不是 all。
 */
import { dataUrl } from '../../app/config'
import type { VizDemo } from '../viz/types'
import { loadVizIndex } from '../viz/data/loader'
import { VIZ3D_BY_ID, type Viz3DSource } from './catalog'

/** catalog 里没有这个 id —— 链接打错或语料没生成，不是网络故障，不该给「重试」 */
export class Viz3DNotFound extends Error {
  constructor(id: string) {
    super(`3D 馆目录里没有 ${id}`)
    this.name = 'Viz3DNotFound'
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`数据文件加载失败：${url}（HTTP ${res.status}）`)
  return (await res.json()) as T
}

const demoCache = new Map<string, Promise<VizDemo>>()

export function sourceOf(id: string): Viz3DSource {
  return VIZ3D_BY_ID.get(id)?.source ?? 'viz'
}

/** 按 catalog 登记的 source 取完整语料（含 steps） */
export function loadDemo3D(id: string, source: Viz3DSource = sourceOf(id)): Promise<VizDemo> {
  const dir = source === 'viz3d' ? 'viz3d' : 'viz'
  const key = `${dir}/${id}`
  let pending = demoCache.get(key)
  if (!pending) {
    pending = getJson<VizDemo>(dataUrl(`${dir}/${id}.json`)).catch((error: unknown) => {
      demoCache.delete(key)
      throw error
    })
    demoCache.set(key, pending)
  }
  return pending
}

export interface Viz3DIndexEntry {
  id: string
  title: string
  chapter: string
  category: string
  renderer: string
  relatedProblems: string[]
  steps: number
  url: string
}

export interface Viz3DIndex {
  count: number
  demos: Viz3DIndexEntry[]
}

let indexPromise: Promise<Viz3DIndex> | null = null

/** 3D 专属语料的索引（只有 4 条，1.6 KB） */
export function loadViz3DIndex(): Promise<Viz3DIndex> {
  if (!indexPromise) {
    indexPromise = getJson<Viz3DIndex>(dataUrl('viz3d/index.json')).catch((error: unknown) => {
      indexPromise = null
      throw error
    })
  }
  return indexPromise
}

/** 列表页徽标数据：id → { title, steps, relatedProblems }。任一索引失败都退化成部分数据 */
export interface Viz3DMeta {
  title: string
  steps: number
  relatedProblems: string[]
  chapter: string
}

let metaPromise: Promise<Map<string, Viz3DMeta>> | null = null

export function loadMetaMap(): Promise<Map<string, Viz3DMeta>> {
  if (metaPromise) return metaPromise
  metaPromise = Promise.allSettled([loadVizIndex(), loadViz3DIndex()]).then(([a, b]) => {
    const map = new Map<string, Viz3DMeta>()
    if (a.status === 'fulfilled') {
      for (const d of a.value.demos) {
        map.set(d.id, { title: d.title, steps: d.steps, relatedProblems: d.relatedProblems ?? [], chapter: d.chapter })
      }
    }
    if (b.status === 'fulfilled') {
      // 3D 专属语料后写：同 id 时以 3D 目录为准（catalog 就是这么登记的）
      for (const d of b.value.demos) {
        map.set(d.id, { title: d.title, steps: d.steps, relatedProblems: d.relatedProblems ?? [], chapter: d.chapter })
      }
    }
    return map
  })
  return metaPromise
}
