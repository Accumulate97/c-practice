/**
 * 8 种排序的步骤生成器（纯函数，无 React/DOM —— 规范四·关键）。
 * 每个函数：输入 number[]，输出 VizStep[]（每步是完整状态快照，后退=下标回退）。
 *
 * 统一口径：
 *   · 计数 comparisons / swaps / moves，按算法性质只暴露相关键（keys）；
 *   · roles 由「已就位集合 sorted + 本步标记 marks」合成，marks 覆盖 sorted；
 *   · 冒泡用「固定 n-1 趟」写法，比较次数恒为 n(n-1)/2（n=8 → 28），与理论复杂度吻合，
 *     验收据此校验；带 swapped 标志的提前退出会少于 28，故这里不用（注释里说明）。
 *   · 每步 values/roles 都 .slice() 深拷贝，快照之间互不影响。
 */
import type { BarSnapshot, VizCounters, VizRole, VizStep } from '../types'

interface Ptr { label: string; index: number }
type Mark = Record<number, VizRole>
interface Ctx {
  a: number[]
  comparisons: number
  swaps: number
  moves: number
  steps: VizStep[]
  keys: string[]
}

function mkCtx(input: number[], keys: string[]): Ctx {
  return { a: input.slice(), comparisons: 0, swaps: 0, moves: 0, steps: [], keys }
}

function counters(c: Ctx): VizCounters {
  const o: VizCounters = {}
  for (const k of c.keys) {
    if (k === 'comparisons') o.comparisons = c.comparisons
    else if (k === 'swaps') o.swaps = c.swaps
    else if (k === 'moves') o.moves = c.moves
  }
  return o
}

function roles(n: number, sorted: ReadonlySet<number>, marks: Mark): VizRole[] {
  const r: VizRole[] = new Array<VizRole>(n).fill('idle')
  for (const i of sorted) if (i >= 0 && i < n) r[i] = 'sorted'
  for (const k of Object.keys(marks)) {
    const i = Number(k)
    if (i >= 0 && i < n) r[i] = marks[i]!
  }
  return r
}

function push(c: Ctx, sorted: ReadonlySet<number>, marks: Mark, description: string, pointers?: Ptr[]): void {
  const snap: BarSnapshot = {
    kind: 'bar',
    values: c.a.slice(),
    roles: roles(c.a.length, sorted, marks),
    counters: counters(c),
  }
  if (pointers && pointers.length > 0) snap.pointers = pointers.map((p) => ({ label: p.label, index: p.index }))
  c.steps.push({ description, snapshot: snap })
}

const arr = (a: number[]): string => '[' + a.join(', ') + ']'

export function bubbleSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'swaps'])
  const sorted = new Set<number>()
  push(c, sorted, {}, `初始数组 ${arr(c.a)}，共做 ${n - 1} 趟冒泡（每趟把未排序区最大值沉到末尾）`)
  for (let pass = 0; pass < n - 1; pass++) {
    for (let j = 0; j < n - 1 - pass; j++) {
      c.comparisons++
      push(c, sorted, { [j]: 'compare', [j + 1]: 'compare' },
        `第 ${pass + 1} 趟：比较 a[${j}]=${c.a[j]!} 与 a[${j + 1}]=${c.a[j + 1]!}`, [{ label: 'j', index: j }])
      if (c.a[j]! > c.a[j + 1]!) {
        const t = c.a[j]!; c.a[j] = c.a[j + 1]!; c.a[j + 1] = t; c.swaps++
        push(c, sorted, { [j]: 'swap', [j + 1]: 'swap' }, `a[${j}] > a[${j + 1}]，交换两者`, [{ label: 'j', index: j }])
      }
    }
    sorted.add(n - 1 - pass)
    push(c, sorted, {}, `第 ${pass + 1} 趟结束：最大值 a[${n - 1 - pass}]=${c.a[n - 1 - pass]!} 已就位`)
  }
  sorted.add(0)
  push(c, sorted, {}, `排序完成：共 ${c.comparisons} 次比较、${c.swaps} 次交换`)
  return c.steps
}

export function selectionSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'swaps'])
  const sorted = new Set<number>()
  push(c, sorted, {}, `初始数组 ${arr(c.a)}，每趟从未排序区选出最小值放到前端`)
  for (let i = 0; i < n - 1; i++) {
    let min = i
    push(c, sorted, { [i]: 'active' }, `第 ${i + 1} 趟：设 a[${i}]=${c.a[i]!} 为当前最小`, [{ label: 'min', index: min }])
    for (let j = i + 1; j < n; j++) {
      c.comparisons++
      push(c, sorted, { [min]: 'pivot', [j]: 'compare' },
        `比较 a[${j}]=${c.a[j]!} 与当前最小 a[${min}]=${c.a[min]!}`, [{ label: 'j', index: j }, { label: 'min', index: min }])
      if (c.a[j]! < c.a[min]!) {
        min = j
        push(c, sorted, { [min]: 'active' }, `a[${j}] 更小，更新最小值下标为 ${min}`, [{ label: 'min', index: min }])
      }
    }
    if (min !== i) {
      const t = c.a[i]!; c.a[i] = c.a[min]!; c.a[min] = t; c.swaps++
      push(c, sorted, { [i]: 'swap', [min]: 'swap' }, `交换 a[${i}] 与 a[${min}]，把最小值 ${c.a[i]!} 放到 a[${i}]`)
    }
    sorted.add(i)
    push(c, sorted, {}, `第 ${i + 1} 趟结束：a[${i}]=${c.a[i]!} 就位`)
  }
  sorted.add(n - 1)
  push(c, sorted, {}, `排序完成：共 ${c.comparisons} 次比较、${c.swaps} 次交换`)
  return c.steps
}

export function insertionSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'moves'])
  const sorted = new Set<number>([0])
  push(c, sorted, {}, `初始：a[0]=${c.a[0]!} 视为已排序；从 a[1] 起逐个插入前方有序区`)
  for (let i = 1; i < n; i++) {
    const key = c.a[i]!
    let j = i - 1
    push(c, sorted, { [i]: 'active' }, `取 a[${i}]=${key} 作为待插入元素`, [{ label: 'key', index: i }])
    while (j >= 0) {
      c.comparisons++
      if (c.a[j]! > key) {
        c.a[j + 1] = c.a[j]!; c.moves++
        push(c, sorted, { [j]: 'swap', [j + 1]: 'swap' }, `a[${j}]=${c.a[j]!} > ${key}，右移到 a[${j + 1}]`, [{ label: 'j', index: j }])
        j--
      } else {
        push(c, sorted, { [j]: 'compare' }, `a[${j}]=${c.a[j]!} ≤ ${key}，插入点定在 a[${j + 1}]`, [{ label: 'j', index: j }])
        break
      }
    }
    c.a[j + 1] = key
    for (let k = 0; k <= i; k++) sorted.add(k)
    push(c, sorted, { [j + 1]: 'active' }, `把 ${key} 放到 a[${j + 1}]，有序区扩展为 [0..${i}]`)
  }
  for (let k = 0; k < n; k++) sorted.add(k)
  push(c, sorted, {}, `排序完成：共 ${c.comparisons} 次比较、${c.moves} 次移动`)
  return c.steps
}

export function shellSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'moves'])
  const sorted = new Set<number>()
  const gaps: number[] = []
  for (let g = Math.floor(n / 2); g >= 1; g = Math.floor(g / 2)) gaps.push(g)
  push(c, sorted, {}, `初始数组 ${arr(c.a)}；希尔排序增量序列：${gaps.join(' → ')}`)
  for (const gap of gaps) {
    push(c, sorted, {}, `gap = ${gap}：对间隔为 ${gap} 的各子序列做插入排序`)
    for (let i = gap; i < n; i++) {
      const key = c.a[i]!
      let j = i
      push(c, sorted, { [i]: 'active' }, `取 a[${i}]=${key}，在 gap=${gap} 的子序列内向前插入`, [{ label: 'i', index: i }])
      while (j >= gap) {
        c.comparisons++
        if (c.a[j - gap]! > key) {
          c.a[j] = c.a[j - gap]!; c.moves++
          push(c, sorted, { [j - gap]: 'swap', [j]: 'swap' }, `a[${j - gap}]=${c.a[j - gap]!} > ${key}，右移到 a[${j}]`, [{ label: 'j', index: j }])
          j -= gap
        } else {
          push(c, sorted, { [j - gap]: 'compare' }, `a[${j - gap}]=${c.a[j - gap]!} ≤ ${key}，停止后移`, [{ label: 'j', index: j }])
          break
        }
      }
      c.a[j] = key
      push(c, sorted, { [j]: 'active' }, `把 ${key} 放到 a[${j}]`)
    }
  }
  for (let k = 0; k < n; k++) sorted.add(k)
  push(c, sorted, {}, `排序完成（最后一趟 gap=1 即普通插入排序）：共 ${c.comparisons} 次比较、${c.moves} 次移动`)
  return c.steps
}

export function mergeSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'moves'])
  const sorted = new Set<number>()
  const aux = new Array<number>(n).fill(0)
  push(c, sorted, {}, `初始数组 ${arr(c.a)}；归并排序：自顶向下二分，再两两有序归并`)
  const merge = (lo: number, mid: number, hi: number): void => {
    let i = lo, j = mid, k = lo
    push(c, sorted, {}, `归并有序段 [${lo}..${mid - 1}] 与 [${mid}..${hi - 1}]`)
    while (i < mid && j < hi) {
      c.comparisons++
      if (c.a[i]! <= c.a[j]!) {
        aux[k] = c.a[i]!; c.moves++
        push(c, sorted, { [i]: 'compare', [j]: 'compare' }, `a[${i}]=${c.a[i]!} ≤ a[${j}]=${c.a[j]!}，取 a[${i}] 入临时数组`, [{ label: 'i', index: i }, { label: 'j', index: j }])
        i++
      } else {
        aux[k] = c.a[j]!; c.moves++
        push(c, sorted, { [i]: 'compare', [j]: 'compare' }, `a[${j}]=${c.a[j]!} < a[${i}]=${c.a[i]!}，取 a[${j}] 入临时数组`, [{ label: 'i', index: i }, { label: 'j', index: j }])
        j++
      }
      k++
    }
    while (i < mid) { aux[k] = c.a[i]!; c.moves++; push(c, sorted, { [i]: 'active' }, `左段剩余 a[${i}]=${c.a[i]!}，直接并入`); i++; k++ }
    while (j < hi) { aux[k] = c.a[j]!; c.moves++; push(c, sorted, { [j]: 'active' }, `右段剩余 a[${j}]=${c.a[j]!}，直接并入`); j++; k++ }
    const m: Mark = {}
    for (let t = lo; t < hi; t++) { c.a[t] = aux[t]!; c.moves++; m[t] = 'sorted' }
    push(c, sorted, m, `归并完成：a[${lo}..${hi - 1}] = ${c.a.slice(lo, hi).join(', ')} 已有序`)
  }
  const sortRange = (lo: number, hi: number): void => {
    if (hi - lo <= 1) return
    const mid = (lo + hi) >> 1
    sortRange(lo, mid)
    sortRange(mid, hi)
    merge(lo, mid, hi)
  }
  sortRange(0, n)
  for (let k = 0; k < n; k++) sorted.add(k)
  push(c, sorted, {}, `排序完成：共 ${c.comparisons} 次比较、${c.moves} 次移动`)
  return c.steps
}

export function quickSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'swaps'])
  const sorted = new Set<number>()
  push(c, sorted, {}, `初始数组 ${arr(c.a)}；快速排序：选基准 → 分区 → 递归左右（Lomuto 分区）`)
  const qs = (lo: number, hi: number): void => {
    if (lo > hi) return
    if (lo === hi) { sorted.add(lo); push(c, sorted, { [lo]: 'sorted' }, `区间只剩 a[${lo}]=${c.a[lo]!}，天然就位`); return }
    const pivot = c.a[hi]!
    push(c, sorted, { [hi]: 'pivot' }, `选基准 a[${hi}]=${pivot}，对区间 [${lo}..${hi}] 分区`, [{ label: 'pivot', index: hi }])
    let i = lo - 1
    for (let j = lo; j < hi; j++) {
      c.comparisons++
      push(c, sorted, { [j]: 'compare', [hi]: 'pivot' }, `比较 a[${j}]=${c.a[j]!} 与基准 ${pivot}`, [{ label: 'j', index: j }])
      if (c.a[j]! < pivot) {
        i++
        if (i !== j) {
          const t = c.a[i]!; c.a[i] = c.a[j]!; c.a[j] = t; c.swaps++
          push(c, sorted, { [i]: 'swap', [j]: 'swap', [hi]: 'pivot' }, `a[${j}] < 基准，交换到左区 a[${i}]`)
        } else {
          push(c, sorted, { [i]: 'active', [hi]: 'pivot' }, `a[${j}] < 基准，边界 i 前进到 ${i}`)
        }
      }
    }
    const p = i + 1
    if (p !== hi) { const t = c.a[p]!; c.a[p] = c.a[hi]!; c.a[hi] = t; c.swaps++ }
    sorted.add(p)
    push(c, sorted, { [p]: 'sorted' }, `基准归位到 a[${p}]=${c.a[p]!}：左侧都 ≤ 它，右侧都 > 它`)
    qs(lo, p - 1)
    qs(p + 1, hi)
  }
  qs(0, n - 1)
  for (let k = 0; k < n; k++) sorted.add(k)
  push(c, sorted, {}, `排序完成：共 ${c.comparisons} 次比较、${c.swaps} 次交换`)
  return c.steps
}

export function heapSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['comparisons', 'swaps'])
  const sorted = new Set<number>()
  push(c, sorted, {}, `初始数组 ${arr(c.a)}；堆排序：先建大顶堆，再反复把堆顶换到末尾并下沉`)
  const sift = (start: number, end: number): void => {
    let root = start
    for (;;) {
      const l = 2 * root + 1
      if (l >= end) break
      let big = l
      c.comparisons++
      if (l + 1 < end) { c.comparisons++; if (c.a[l + 1]! > c.a[l]!) big = l + 1 }
      push(c, sorted, { [root]: 'active', [big]: 'compare' }, `比较较大子结点 a[${big}]=${c.a[big]!} 与父结点 a[${root}]=${c.a[root]!}`)
      if (c.a[big]! > c.a[root]!) {
        const t = c.a[big]!; c.a[big] = c.a[root]!; c.a[root] = t; c.swaps++
        push(c, sorted, { [root]: 'swap', [big]: 'swap' }, `a[${big}] > a[${root}]，交换并继续下沉`)
        root = big
      } else break
    }
  }
  for (let start = Math.floor(n / 2) - 1; start >= 0; start--) {
    push(c, sorted, { [start]: 'active' }, `建堆：从最后一个非叶结点 a[${start}]=${c.a[start]!} 开始下沉`)
    sift(start, n)
  }
  push(c, sorted, {}, `大顶堆建成：堆顶 a[0]=${c.a[0]!} 是当前最大值`)
  for (let end = n - 1; end > 0; end--) {
    const t = c.a[0]!; c.a[0] = c.a[end]!; c.a[end] = t; c.swaps++
    sorted.add(end)
    push(c, sorted, { [end]: 'sorted' }, `交换堆顶 a[0] 与 a[${end}]，最大值 ${c.a[end]!} 就位；对 [0..${end - 1}] 重新下沉`)
    sift(0, end)
  }
  sorted.add(0)
  push(c, sorted, {}, `排序完成：共 ${c.comparisons} 次比较、${c.swaps} 次交换`)
  return c.steps
}

export function radixSort(input: number[]): VizStep[] {
  const n = input.length
  const c = mkCtx(input, ['moves'])
  const sorted = new Set<number>()
  const max = c.a.reduce((m, v) => (v > m ? v : m), 0)
  push(c, sorted, {}, `初始数组 ${arr(c.a)}；基数排序（LSD）：从个位到最高位，逐位「分配—收集」，不靠比较（最大值 ${max}）`)
  const digitName = (exp: number): string => (exp === 1 ? '个' : exp === 10 ? '十' : exp === 100 ? '百' : exp === 1000 ? '千' : String(exp))
  for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
    push(c, sorted, {}, `按${digitName(exp)}位（exp=${exp}）分配收集`)
    const out = new Array<number>(n).fill(0)
    const count = new Array<number>(10).fill(0)
    for (let i = 0; i < n; i++) {
      const d = Math.floor(c.a[i]! / exp) % 10
      count[d] = count[d]! + 1
      push(c, sorted, { [i]: 'active' }, `a[${i}]=${c.a[i]!} 的${digitName(exp)}位是 ${d}，count[${d}]++`)
    }
    for (let d = 1; d < 10; d++) count[d] = count[d]! + count[d - 1]!
    for (let i = n - 1; i >= 0; i--) {
      const d = Math.floor(c.a[i]! / exp) % 10
      const p = count[d]! - 1
      out[p] = c.a[i]!
      count[d] = count[d]! - 1
      c.moves++
      push(c, sorted, { [i]: 'compare' }, `倒序收集：a[${i}]=${c.a[i]!}（${digitName(exp)}位 ${d}）放到临时数组第 ${p} 位`)
    }
    for (let i = 0; i < n; i++) { c.a[i] = out[i]!; c.moves++ }
    push(c, sorted, {}, `本趟收集后：${arr(c.a)}（按${digitName(exp)}位有序）`)
  }
  for (let k = 0; k < n; k++) sorted.add(k)
  push(c, sorted, {}, `排序完成：共 ${c.moves} 次移动（基数排序不做元素比较）`)
  return c.steps
}