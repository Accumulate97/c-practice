/**
 * 3D 可视化馆目录（任务 2）。
 *
 * 本文件是「列表页与演示页共享的唯一入口表」，**绝不 import three / fiber / drei** ——
 * 列表页只读这张表就能渲染，路由级 lazy 的意义（首页与列表页零 3D 体积）全靠这一点。
 *
 * 语料来源两条腿：
 *   source='viz'   → 复用 2D 馆已有语料 public/data/viz/{id}.json（scripts/gen-viz.ts 生成）
 *   source='viz3d' → 3D 馆专属语料 public/data/viz3d/{id}.json（scripts/gen-viz3d.ts 生成）
 * 两边都是脚本生成、禁止手写 JSON（AGENTS.md 二·4 / 07 规范五）。
 *
 * 为什么复用而不另造一套：3D 馆的价值是「换个视角看同一个算法」，
 * 快照模型一致才能让学生把 2D 学到的步骤语义直接迁移过来，也才不会
 * 出现「2D 与 3D 步数不同、结论不同」这种最伤信任的分裂。
 */
import type { Scene3DKind } from './types'

export type Viz3DSource = 'viz' | 'viz3d'

export interface Viz3DCatalogEntry {
  /** 语料 id，同时是路由参数与 JSON 文件名 */
  id: string
  source: Viz3DSource
  scene: Scene3DKind
  group: string
  /** 3D 馆展示名。留空则用「3D + 语料标题」 */
  title?: string
  /** 一句话说明「这个 3D 演示让你看见什么」 */
  blurb: string
  /** 是否是本站差异化重点（列表页置顶徽标） */
  highlight?: boolean
}

export const VIZ3D_GROUPS: { key: string; emoji: string; label: string; note: string }[] = [
  { key: 'tree', emoji: '🌳', label: '3D 二叉树', note: '插入/删除/四种遍历，立体看子树展开' },
  { key: 'chain', emoji: '🔗', label: '3D 链表', note: '结点与指针连线，插入删除在空间里发生' },
  { key: 'stackqueue', emoji: '📚', label: '3D 栈与队列', note: '入栈出栈沿竖直方向堆叠，进出端一目了然' },
  { key: 'memory', emoji: '🧠', label: '3D 内存沙盘', note: '本站差异化：栈区/堆区/全局区分区 + 指针 3D 连线' },
  { key: 'callstack', emoji: '🪜', label: '3D 函数调用栈', note: '递归层层堆叠与回退，栈帧压入弹出' },
  { key: 'matrix', emoji: '🧊', label: '3D 数组内存立方体', note: '二维下标 (i,j) 如何映射到一维地址' },
  { key: 'graph', emoji: '🕸️', label: '3D 图', note: '力导向立体布局，DFS/BFS 扩散' },
  { key: 'sort', emoji: '📊', label: '3D 排序', note: '柱状体 + 可旋转视角，比较与交换在立体空间里' },
]

/**
 * 目录顺序 = 列表页展示顺序（按价值排序，AGENTS.md 任务 2 的清单次序）。
 * 只收录「3D 比 2D 确实多给了信息」的演示：例如排序柱状图 3D 化收益有限，
 * 但仍保留，因为旋转视角能让学生看清「比较的是哪两根柱子」这一层空间关系。
 */
export const VIZ3D_CATALOG: Viz3DCatalogEntry[] = [
  /* ---- 🌳 3D 二叉树 ---- */
  { id: 'tree-bst-insert', source: 'viz', scene: 'tree3d', group: 'tree', blurb: 'BST 逐个插入：新结点沿比较路径下沉，立体看清左右子树的分野' },
  { id: 'tree-bst-delete', source: 'viz', scene: 'tree3d', group: 'tree', blurb: 'BST 删除三种情形：叶 / 单孩子 / 双孩子（前驱接替）在空间里重排' },
  { id: 'tree-preorder', source: 'viz', scene: 'tree3d', group: 'tree', blurb: '先序遍历路径：根→左→右，高亮顺序沿立体树游走' },
  { id: 'tree-inorder', source: 'viz', scene: 'tree3d', group: 'tree', blurb: '中序遍历路径：BST 中序即升序，旋转视角验证这一结论' },
  { id: 'tree-postorder', source: 'viz', scene: 'tree3d', group: 'tree', blurb: '后序遍历路径：孩子先于双亲被访问，回溯顺序立体可见' },
  { id: 'tree-avl-rotate', source: 'viz', scene: 'tree3d', group: 'tree', blurb: 'AVL 四种失衡与旋转：LL/RR/LR/RL 的旋转轴在 3D 里更好认' },
  { id: 'tree-heap-build', source: 'viz', scene: 'tree3d', group: 'tree', blurb: '堆的自底向上筛选：完全二叉树的层序结构立体展开' },
  { id: 'tree-huffman', source: 'viz', scene: 'tree3d', group: 'tree', blurb: '哈夫曼树构造：每次合并两棵最小权重的树' },

  /* ---- 🔗 3D 链表 ---- */
  { id: 'linear-singly-insert', source: 'viz', scene: 'chain3d', group: 'chain', blurb: '单链表插入：新结点先接后断，指针改向的先后次序是考点' },
  { id: 'linear-singly-delete', source: 'viz', scene: 'chain3d', group: 'chain', blurb: '单链表删除：前驱绕过被删结点，被删块随后释放' },
  { id: 'linear-doubly-insert-delete', source: 'viz', scene: 'chain3d', group: 'chain', blurb: '双链表插入删除：prior 与 next 双向连线的四步改向' },
  { id: 'linear-circular-list', source: 'viz', scene: 'chain3d', group: 'chain', blurb: '循环链表：尾结点指回头结点，环形连线在 3D 里闭合' },

  /* ---- 📚 3D 栈与队列 ---- */
  { id: 'linear-stack-push-pop', source: 'viz', scene: 'chain3d', group: 'stackqueue', blurb: '栈的压入弹出：竖直堆叠，只在栈顶（顶端）操作 —— LIFO 的空间直觉' },
  { id: 'linear-queue-enqueue-dequeue', source: 'viz', scene: 'chain3d', group: 'stackqueue', blurb: '队列的入队出队：队尾进、队头出 —— FIFO 沿一个方向流动' },

  /* ---- 🧠 3D 内存沙盘（本站差异化重点） ---- */
  { id: 'mem3d-wild-pointer', source: 'viz3d', scene: 'memory3d', group: 'memory', highlight: true, blurb: '野指针是怎么形成的：free 之后指针仍存旧地址，再写就是未定义行为' },
  { id: 'mem3d-leak', source: 'viz3d', scene: 'memory3d', group: 'memory', highlight: true, blurb: '内存泄漏是怎么形成的：循环里 malloc 却丢了唯一入口，堆块再也找不回' },
  { id: 'memory-malloc-free', source: 'viz', scene: 'memory3d', group: 'memory', blurb: 'malloc / free 全流程：栈区指针与堆区块的 3D 连线随分配与释放变化' },
  { id: 'memory-pointer-address', source: 'viz', scene: 'memory3d', group: 'memory', blurb: '指针与地址：& 取址、* 解引用，在分区沙盘上看清「存的是地址」' },
  { id: 'memory-multi-pointer', source: 'viz', scene: 'memory3d', group: 'memory', blurb: '多个指针指向同一块内存：改一处，处处可见（别名效应）' },

  /* ---- 🪜 3D 函数调用栈 ---- */
  { id: 'mem3d-recursion', source: 'viz3d', scene: 'callstack3d', group: 'callstack', highlight: true, blurb: '递归的层层堆叠与回退：factorial(5) 五层栈帧压入，再逐层弹出返回' },
  { id: 'memory-call-stack', source: 'viz', scene: 'callstack3d', group: 'callstack', blurb: 'main 调用 f：形参、局部变量、返回地址组成一个栈帧' },
  { id: 'memory-swap-call', source: 'viz', scene: 'callstack3d', group: 'callstack', blurb: 'swap(a,b) 值传递：为什么交换不了 —— 栈帧里只是副本' },

  /* ---- 🧊 3D 数组/矩阵内存立方体 ---- */
  { id: 'mem3d-matrix-cube', source: 'viz3d', scene: 'matrixcube3d', group: 'matrix', highlight: true, blurb: '3×3 矩阵：逻辑二维网格与物理一维内存的对照，看清 a[i][j] 的地址公式' },
  { id: 'memory-array-layout', source: 'viz', scene: 'memory3d', group: 'matrix', blurb: '一维数组连续布局：基址 + 下标 × sizeof，指针 p 指向 a[0]' },

  /* ---- 🕸️ 3D 图 ---- */
  { id: 'graph-dfs', source: 'viz', scene: 'graph3d', group: 'graph', blurb: 'DFS 深度优先：沿一条路走到底再回溯，立体看递归展开方向' },
  { id: 'graph-bfs', source: 'viz', scene: 'graph3d', group: 'graph', blurb: 'BFS 广度优先：一圈一圈向外扩散，队列在队尾生长' },
  { id: 'graph-dijkstra', source: 'viz', scene: 'graph3d', group: 'graph', blurb: 'Dijkstra 最短路：已确定集合逐点扩张，边权在连线上标注' },
  { id: 'graph-prim', source: 'viz', scene: 'graph3d', group: 'graph', blurb: 'Prim 最小生成树：从一点出发，每次接入最便宜的边' },
  { id: 'graph-kruskal', source: 'viz', scene: 'graph3d', group: 'graph', blurb: 'Kruskal 最小生成树：按权排序选边，并查集挡住成环的那条' },
  { id: 'graph-toposort', source: 'viz', scene: 'graph3d', group: 'graph', blurb: '拓扑排序：入度为 0 的先出，AOV 网的先后约束立体可见' },

  /* ---- 📊 3D 排序 ---- */
  { id: 'sort-bubble', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '冒泡排序：相邻比较交换，最大值像气泡一样浮到末端' },
  { id: 'sort-selection', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '简单选择排序：每趟选出最小的放到已排序段末尾' },
  { id: 'sort-insertion', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '直接插入排序：待插元素在有序段里从后往前找位置' },
  { id: 'sort-shell', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '希尔排序：按增量分组插入，增量逐趟缩小到 1' },
  { id: 'sort-merge', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '归并排序：两两合并有序段，趟数 = ⌈log₂n⌉' },
  { id: 'sort-quick', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '快速排序：基准一趟划分，左右子区间递归处理' },
  { id: 'sort-heapsort', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '堆排序：建大顶堆，反复把堆顶换到末尾再下沉' },
  { id: 'sort-radix', source: 'viz', scene: 'bars3d', group: 'sort', blurb: '基数排序：按位分配到桶里再收集， LSD 从低位开始' },
]

/** id → 目录项。演示页用它决定加载哪个语料目录、用哪个 3D 场景 */
export const VIZ3D_BY_ID = new Map<string, Viz3DCatalogEntry>(
  VIZ3D_CATALOG.map((e) => [e.id, e]),
)

export function groupOf(key: string): { key: string; emoji: string; label: string; note: string } {
  return VIZ3D_GROUPS.find((g) => g.key === key) ?? { key, emoji: '🧊', label: key, note: '' }
}

/** 列表页分组：保持 VIZ3D_GROUPS 的声明顺序，空组不出现 */
export function groupedCatalog(): { group: (typeof VIZ3D_GROUPS)[number]; items: Viz3DCatalogEntry[] }[] {
  return VIZ3D_GROUPS.map((group) => ({
    group,
    items: VIZ3D_CATALOG.filter((e) => e.group === group.key),
  })).filter((g) => g.items.length > 0)
}

export const VIZ3D_COUNT = VIZ3D_CATALOG.length
