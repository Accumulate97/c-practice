/**
 * 全站规模计数（任务 4-1）。public/data/search/totals.json —— <1 KB。
 *
 * 为什么单独一个文件：首页要报「2074 题 / 345 卡片 / 38 个 3D 演示」这类规模数字，
 * 但绝不能为了几个数字把 727 KB 的搜索语料拖进首屏。计数与语料同源
 * （都由 scripts/build-search-index.mjs 一次算出），所以不会两份真相打架。
 *
 * 单独成模块（不放在 corpus.ts 里）：corpus.ts 还带着打分与高亮代码，
 * 首页只要计数，把它拆出来首页 chunk 才不为搜索算法付体积。
 */
import { dataUrl } from '../../app/config'

export interface SearchTotals {
  schema?: number
  all?: number
  problem?: number
  knowledge?: number
  viz?: number
  viz3d?: number
  bug?: number
  ref?: number
  page?: number
}

let totalsPromise: Promise<SearchTotals> | null = null

/** 单飞 + 失败可重试：与其它 loader 同一口径。失败返回 null，调用方必须如实不显示数字 */
export function loadTotals(): Promise<SearchTotals> {
  if (!totalsPromise) {
    totalsPromise = fetch(dataUrl('search/totals.json'), { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`计数文件加载失败：HTTP ${res.status}`)
        return (await res.json()) as SearchTotals
      })
      .catch((error: unknown) => {
        totalsPromise = null
        throw error
      })
  }
  return totalsPromise
}
