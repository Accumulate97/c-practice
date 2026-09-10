/**
 * 演示规格表（阶段 7 · 任务 2）：生成函数 + 元数据的唯一登记处。
 *
 * scripts/gen-viz.ts 只认这张表 —— 新增一个演示 = 写一个纯函数生成器 + 在这里加一行，
 * 生成脚本与页面代码都不用改；语料一律由 `npm run gen:viz` 产出，禁止手写 JSON。
 *
 * 两条纪律：
 *   · generate 必须是纯函数（同输入 → 同 steps），语料才「可复现、可 diff」；
 *   · snapshot.kind 必须与 spec.renderer 一致，gen-viz.ts 落盘前逐步校验，不一致直接失败退出。
 */
import type { VizRendererKind, VizStep } from '../types'
import {
  bubbleSort,
  heapSort,
  insertionSort,
  mergeSort,
  quickSort,
  radixSort,
  selectionSort,
  shellSort,
} from './sort'
import { SORT_CODE } from './sortCode'
import { bstInsert, graphBfs, linearSinglyInsert, memorySwapCall, SAMPLE_CODE } from './samples'

/**
 * 8 种排序共用同一组输入（n = 8）。
 * 对比模式要把 2–4 个算法并排同步步进，只有「同数据、同规模」比出来的次数才有意义；
 * 数据刻意取乱序且含重复间隔（5 2 8 1 9 3 7 4），冒泡恰好 28 次比较 = n(n-1)/2，
 * 与理论复杂度对齐，便于验收脚本直接断言。
 */
export const SORT_INPUT: number[] = [5, 2, 8, 1, 9, 3, 7, 4]

export interface VizGenSpec {
  /** 演示 id：同时是语料文件名 public/data/viz/{id}.json 与路由 /#/viz/{id} */
  id: string
  title: string
  /** 列表页分组 slug（registry.ts CATEGORY_LABELS 的键） */
  category: string
  /** 与题目、知识卡片同口径的章节名，用于跨板块关联 */
  chapter: string
  /** 由哪套渲染器画 */
  renderer: VizRendererKind
  /** meta.algorithm：算法标识，与生成器函数同名 */
  algorithm: string
  /** 本演示记录的统计口径（types.ts COUNTER_LABELS 的键） */
  counterKeys: string[]
  /** 数据规模；省略 = 与输入数组无关（链表 / 树 / 图 / 内存类演示） */
  n?: number
  /** 输入数据；省略则用 SORT_INPUT */
  defaultInput?: number[]
  /** 上屏对照代码（标准 C，仅展示不编译）；省略 = 无代码面板 */
  code?: string
  /** 纯函数生成器 */
  generate: (input: number[]) => VizStep[]
}

/** 排序类演示的公共骨架：分类 / 章节 / 渲染器 / 输入全都一样，只差生成函数与统计口径 */
function sortSpec(
  id: string,
  title: string,
  algorithm: string,
  counterKeys: string[],
  generate: (input: number[]) => VizStep[],
): VizGenSpec {
  return {
    id,
    title,
    category: 'sort',
    chapter: '第8章 排序',
    renderer: 'bar',
    algorithm,
    counterKeys,
    n: SORT_INPUT.length,
    defaultInput: SORT_INPUT,
    code: SORT_CODE[id],
    generate,
  }
}

export const VIZ_SPECS: VizGenSpec[] = [
  // ── 任务 3：R1 柱状图 + 8 种排序（本批完整验证）──────────────────────────
  sortSpec('sort-bubble', '冒泡排序', 'bubbleSort', ['comparisons', 'swaps'], bubbleSort),
  sortSpec('sort-selection', '选择排序', 'selectionSort', ['comparisons', 'swaps'], selectionSort),
  sortSpec('sort-insertion', '插入排序', 'insertionSort', ['comparisons', 'moves'], insertionSort),
  sortSpec('sort-shell', '希尔排序', 'shellSort', ['comparisons', 'moves'], shellSort),
  sortSpec('sort-merge', '归并排序', 'mergeSort', ['comparisons', 'moves'], mergeSort),
  sortSpec('sort-quick', '快速排序', 'quickSort', ['comparisons', 'swaps'], quickSort),
  sortSpec('sort-heapsort', '堆排序', 'heapSort', ['comparisons', 'swaps'], heapSort),
  sortSpec('sort-radix', '基数排序', 'radixSort', ['moves'], radixSort),

  // ── R2–R5：本批只搭骨架，每套一个最简样例打通「生成器 → 语料 → 渲染器」链路 ──
  // 详细算法语料（双向链表、循环队列、AVL 旋转、最短路径、多级指针…）留到会话 2 批量产出。
  {
    id: 'linear-singly-insert',
    title: '单链表插入：指针修改顺序',
    category: 'linear',
    chapter: '第2章 线性表',
    renderer: 'nodechain',
    algorithm: 'linearSinglyInsert',
    counterKeys: ['pointerWrites'],
    code: SAMPLE_CODE['linear-singly-insert'],
    generate: () => linearSinglyInsert(),
  },
  {
    id: 'tree-bst-insert',
    title: '二叉排序树插入：查找路径',
    category: 'tree',
    chapter: '第5章 树和二叉树',
    renderer: 'tree',
    algorithm: 'bstInsert',
    counterKeys: ['comparisons', 'pointerWrites'],
    code: SAMPLE_CODE['tree-bst-insert'],
    generate: () => bstInsert(),
  },
  {
    id: 'graph-bfs',
    title: '图的广度优先遍历（BFS）',
    category: 'graph',
    chapter: '第6章 图',
    renderer: 'graph',
    algorithm: 'graphBfs',
    counterKeys: ['visited'],
    code: SAMPLE_CODE['graph-bfs'],
    generate: () => graphBfs(),
  },
  {
    id: 'memory-swap-call',
    title: '值传递 vs 地址传递（内存格对比）',
    category: 'memory',
    chapter: '第9章 指针',
    renderer: 'memory',
    algorithm: 'memorySwapCall',
    counterKeys: [],
    code: SAMPLE_CODE['memory-swap-call'],
    generate: () => memorySwapCall(),
  },
]

/** 按 id 查规格（gen-viz.ts 支持只重生成指定演示：npm run gen:viz -- sort-bubble） */
export function specById(id: string): VizGenSpec | undefined {
  return VIZ_SPECS.find((s) => s.id === id)
}