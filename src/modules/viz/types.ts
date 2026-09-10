/**
 * 可视化演示的统一类型（阶段 7 · Viz 内核）。
 *
 * 三层解耦（07_可视化演示规范.md）：
 *   算法生成器 src/modules/viz/algorithms/（纯函数，无 React/DOM）→ 产出 VizStep[]
 *   语料 public/data/viz/{id}.json（scripts/gen-viz.ts 生成，禁止手写 JSON）
 *   渲染器 src/modules/viz/renderers/（按 snapshot.kind 分发，5 套覆盖 30+ 演示）
 *
 * 两条硬约定：
 *   1. 快照是「完整状态」而不是增量 diff —— 后退 = 数组下标回退，不做逆运算（规范三·2）；
 *   2. 语料内部结点/指针一律用 key 不用 id —— scripts/build-index.ts 的 collectIds()
 *      会把任何带 id 字段的对象收进 viz/index.json，结点带 id 会污染索引。
 */

/** 元素语义角色 → 颜色。四色语义见规范二·E，active 是内核补充的「当前处理」色。
 *  色值只在 global.css @theme 定义一份（--color-viz-*），渲染器一律引用 CSS 变量，深浅色主题自适应。 */
export type VizRole = 'idle' | 'compare' | 'swap' | 'sorted' | 'pivot' | 'active'

export const ROLE_LABELS: Record<VizRole, string> = {
  idle: '未处理',
  compare: '比较中',
  swap: '交换/移动',
  sorted: '已就位',
  pivot: '基准/在队',
  active: '当前处理',
}

/** 统计面板键 → 中文标签（规范三·必备控件）。渲染器遇到未登记的键原样显示。 */
export const COUNTER_LABELS: Record<string, string> = {
  comparisons: '比较次数',
  swaps: '交换次数',
  moves: '移动次数',
  visited: '已访问结点',
  pointerWrites: '指针修改次数',
}

export type VizCounters = Record<string, number>

/** R1 柱状图：values 与 roles 等长；pointers 是挂在柱子下方的 i/j/low/mid/high 标签 */
export interface BarPointer {
  label: string
  index: number
}
export interface BarSnapshot {
  kind: 'bar'
  values: number[]
  roles: VizRole[]
  pointers?: BarPointer[]
  counters?: VizCounters
}

/** R2 节点链：链表 / 栈 / 队列 / 循环链表。edge.to === null 表示悬空的 ∧（NULL） */
export interface ChainNode {
  key: string
  label: string
  role?: VizRole
  fields?: Record<string, string>
}
export interface ChainEdge {
  from: string
  to: string | null
  label?: string
  role?: VizRole
}
export interface NodeChainSnapshot {
  kind: 'nodechain'
  nodes: ChainNode[]
  edges: ChainEdge[]
  pointers?: { label: string; node: string | null }[]
  counters?: VizCounters
}

/** R3 树：children 允许 null 占位以保持二叉树形态（左右子树不并拢） */
export interface TreeNodeViz {
  key: string
  label: string
  role?: VizRole
  children: (TreeNodeViz | null)[]
}
export interface TreeSnapshot {
  kind: 'tree'
  root: TreeNodeViz | null
  counters?: VizCounters
}

/** R4 图：坐标是 0–100 归一化值，渲染器映射到 viewBox */
export interface GraphNodeViz {
  key: string
  label: string
  x: number
  y: number
  role?: VizRole
}
export interface GraphEdgeViz {
  from: string
  to: string
  weight?: number
  directed?: boolean
  role?: VizRole
}
export interface GraphSnapshot {
  kind: 'graph'
  nodes: GraphNodeViz[]
  edges: GraphEdgeViz[]
  counters?: VizCounters
}

/** R5 内存格：address 是展示字符串（如 0x7ffc00）；指针单元格的 value 可写成「→ x」 */
export interface MemoryCell {
  key: string
  address: string
  value: string
  role?: VizRole
  note?: string
}
export interface MemoryRegion {
  key: string
  title: string
  note?: string
  cells: MemoryCell[]
}
export interface MemorySnapshot {
  kind: 'memory'
  regions: MemoryRegion[]
  counters?: VizCounters
}

export type VizSnapshot = BarSnapshot | NodeChainSnapshot | TreeSnapshot | GraphSnapshot | MemorySnapshot
export type VizRendererKind = VizSnapshot['kind']

export interface VizStep {
  /** 本步解说文字（规范三·6：每步必须有解说） */
  description: string
  /** 高亮 demo.code 的行号（1-based，省略 = 本步不移动高亮线） */
  codeLine?: number
  snapshot: VizSnapshot
}

export interface VizDemoMeta {
  /** 算法标识（与生成器函数同名），如 bubbleSort */
  algorithm?: string
  /** 数据规模。规范五红线 n ≤ 50，gen-viz.ts 落盘前强制校验 */
  n?: number
  /** 输入数据（同 category 的演示共用同一组，对比模式才公平） */
  input?: number[]
  /** 本演示记录的统计口径（COUNTER_LABELS 的键） */
  counterKeys?: string[]
  /** 生成器口径：同版本 + 同输入 = 字节相同的语料（可复现，禁手改） */
  generatedBy?: string
}

export interface VizDemo {
  id: string
  title: string
  renderer: VizRendererKind
  /** 分类 slug：sort / linear / tree / graph / memory …，列表页按此分组 */
  category: string
  /** 与题目、知识卡片同口径的章节名，用于跨板块关联 */
  chapter: string
  relatedProblems: string[]
  /** 演示对照的源代码（标准 C，仅上屏展示不编译）；steps[].codeLine 指向这里 */
  code?: string
  meta: VizDemoMeta
  steps: VizStep[]
}

/** 5 套渲染器的统一 props（registry.ts 的 RENDERERS 按此登记） */
export interface VizRendererProps {
  demo: VizDemo
  step: VizStep
  /** 对比模式的小面板用：隐藏下标行、压缩高度 */
  compact?: boolean
}
