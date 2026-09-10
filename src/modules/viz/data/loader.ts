/**
 * 演示语料懒加载（纯静态、无后端）。口径完全对齐 problems/data/loader.ts：
 *   viz/index.json（唯一索引入口，scripts/build-index.ts 生成）→ 单演示 viz/{id}.json。
 *
 * 单飞 + 失败可重试：并发调用只发一次请求；catch 后清缓存，下次点击能重试。
 * 语料由 scripts/gen-viz.ts 生成，禁止手写（AGENTS.md / 07 规范五）。
 */
import { dataUrl } from '../../../app/config'
import type { VizDemo, VizRendererKind } from '../types'

/** index.json 的演示条目：只放列表页需要的字段，完整 steps 仍在 {id}.json 里 */
export interface VizIndexEntry {
  id: string
  chapter: string
  title: string
  relatedProblems: string[]
  renderer: VizRendererKind
  category: string
  steps: number
  url: string
}

export interface VizIndex {
  count: number
  demos: VizIndexEntry[]
  content_sha?: string
}

/** 索引里没有该演示 —— 数据不一致，不是网络故障，不该重试 */
export class VizNotFound extends Error {
  constructor(id: string) {
    super(`演示索引里没有 ${id}`)
    this.name = 'VizNotFound'
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`数据文件加载失败：${url}（HTTP ${res.status}）`)
  return (await res.json()) as T
}

let indexPromise: Promise<VizIndex> | null = null
const demoCache = new Map<string, Promise<VizDemo>>()

/** 单飞：并发调用只发一次请求；失败后清掉缓存，下次点击可以重试 */
export function loadVizIndex(): Promise<VizIndex> {
  if (!indexPromise) {
    indexPromise = getJson<VizIndex>(dataUrl('viz/index.json')).catch((error: unknown) => {
      indexPromise = null
      throw error
    })
  }
  return indexPromise
}

/** 取单个演示的完整语料（含 steps）。语料文件名 = {id}.json，直接 fetch，不必先读索引 */
export function loadDemo(id: string): Promise<VizDemo> {
  let pending = demoCache.get(id)
  if (!pending) {
    pending = getJson<VizDemo>(dataUrl(`viz/${id}.json`)).catch((error: unknown) => {
      demoCache.delete(id)
      throw error
    })
    demoCache.set(id, pending)
  }
  return pending
}

/** 列表页用：按 category 聚合，保持索引里的出现顺序 */
export function groupByCategory(index: VizIndex): { category: string; items: VizIndexEntry[] }[] {
  const order: string[] = []
  const map = new Map<string, VizIndexEntry[]>()
  for (const item of index.demos) {
    let bucket = map.get(item.category)
    if (!bucket) {
      bucket = []
      map.set(item.category, bucket)
      order.push(item.category)
    }
    bucket.push(item)
  }
  return order.map((category) => ({ category, items: map.get(category) ?? [] }))
}
