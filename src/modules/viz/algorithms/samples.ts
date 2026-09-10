/**
 * R2–R5 渲染器的最简样例生成器（本批只搭骨架 + 1 个样例，详细语料留会话 2）。
 * 全部纯函数、产出 VizStep[]，快照深拷贝互不影响。
 *   linearSinglyInsert → nodechain（头插，突出「先连后改头」的指针顺序）
 *   bstInsert          → tree（BST 逐个插入，展示查找路径）
 *   graphBfs           → graph（BFS，展示 visited / 队列）
 *   memorySwapCall     → memory（值传递 vs 地址传递并排对比，本站差异化重点）
 */
import type {
  ChainEdge, ChainNode, GraphEdgeViz, GraphNodeViz, MemoryCell, MemoryRegion,
  TreeNodeViz, VizRole, VizStep,
} from '../types'

/* ───────────────────────── R2 单链表头插 ───────────────────────── */
export function linearSinglyInsert(): VizStep[] {
  const A: ChainNode = { key: 'A', label: 'A' }
  const B: ChainNode = { key: 'B', label: 'B' }
  const C: ChainNode = { key: 'C', label: 'C' }
  const baseEdges: ChainEdge[] = [
    { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: null },
  ]
  const steps: VizStep[] = []
  steps.push({
    description: '初始单链表：head → A → B → C → ∧（每个结点的 next 指向后继，尾结点 next 为 NULL）',
    snapshot: { kind: 'nodechain', nodes: [A, B, C], edges: baseEdges, pointers: [{ label: 'head', node: 'A' }], counters: { pointerWrites: 0 } },
  })
  const X: ChainNode = { key: 'X', label: 'X', role: 'active' }
  steps.push({
    description: '新建结点 X（new 指向它），此时它还没接入链表',
    snapshot: { kind: 'nodechain', nodes: [X, A, B, C], edges: baseEdges, pointers: [{ label: 'head', node: 'A' }, { label: 'new', node: 'X' }], counters: { pointerWrites: 0 } },
  })
  const xEdge: ChainEdge[] = [{ from: 'X', to: 'A', role: 'active' }, ...baseEdges]
  steps.push({
    description: '先连：new->next = head，让 X 指向 A —— 这一步必须最先做，否则后面改 head 就再也找不到 A，链表断裂',
    snapshot: { kind: 'nodechain', nodes: [X, A, B, C], edges: xEdge, pointers: [{ label: 'head', node: 'A' }, { label: 'new', node: 'X' }], counters: { pointerWrites: 1 } },
  })
  steps.push({
    description: '后改头：head = new，头指针指向 X，头插完成',
    snapshot: { kind: 'nodechain', nodes: [X, A, B, C], edges: xEdge, pointers: [{ label: 'head', node: 'X' }, { label: 'new', node: 'X' }], counters: { pointerWrites: 2 } },
  })
  const done: ChainNode[] = [
    { key: 'X', label: 'X', role: 'sorted' }, { key: 'A', label: 'A', role: 'sorted' },
    { key: 'B', label: 'B', role: 'sorted' }, { key: 'C', label: 'C', role: 'sorted' },
  ]
  steps.push({
    description: '结果：head → X → A → B → C → ∧；全程只改 2 次指针，顺序是「先连后改头」',
    snapshot: { kind: 'nodechain', nodes: done, edges: [{ from: 'X', to: 'A' }, ...baseEdges], pointers: [{ label: 'head', node: 'X' }], counters: { pointerWrites: 2 } },
  })
  return steps
}

/* ───────────────────────── R3 BST 插入 ───────────────────────── */
interface BNode { key: string; label: string; left: BNode | null; right: BNode | null }
function toViz(n: BNode | null, mark: Map<string, VizRole>): TreeNodeViz | null {
  if (!n) return null
  const role = mark.get(n.key)
  const node: TreeNodeViz = { key: n.key, label: n.label, children: [toViz(n.left, mark), toViz(n.right, mark)] }
  if (role) node.role = role
  return node
}
export function bstInsert(): VizStep[] {
  const values = [5, 3, 8, 1, 4, 7, 9]
  const steps: VizStep[] = []
  let root: BNode | null = null
  let comparisons = 0
  let writes = 0
  const emit = (mark: Map<string, VizRole>, description: string): void => {
    steps.push({ description, snapshot: { kind: 'tree', root: toViz(root, mark), counters: { comparisons, pointerWrites: writes } } })
  }
  emit(new Map(), `二叉排序树插入演示：依次插入 ${values.join(', ')}（左小右大）`)
  for (const v of values) {
    const key = 'n' + v
    if (!root) {
      root = { key, label: String(v), left: null, right: null }
      writes++
      emit(new Map([[key, 'active']]), `树为空，${v} 作为根结点插入`)
      continue
    }
    let cur: BNode = root
    const path: string[] = []
    for (;;) {
      path.push(cur.key)
      comparisons++
      emit(new Map(path.map((k) => [k, 'compare'] as [string, VizRole])), `比较 ${v} 与 ${cur.label}：${v < Number(cur.label) ? '更小，往左子树走' : '更大，往右子树走'}`)
      if (v < Number(cur.label)) {
        if (!cur.left) { cur.left = { key, label: String(v), left: null, right: null }; writes++; emit(new Map([[key, 'active']]), `左孩子为空，${v} 作为 ${cur.label} 的左孩子插入`); break }
        cur = cur.left
      } else {
        if (!cur.right) { cur.right = { key, label: String(v), left: null, right: null }; writes++; emit(new Map([[key, 'active']]), `右孩子为空，${v} 作为 ${cur.label} 的右孩子插入`); break }
        cur = cur.right
      }
    }
  }
  emit(new Map(), `插入完成，得到二叉排序树；中序遍历即升序：1, 3, 4, 5, 7, 8, 9（共 ${comparisons} 次比较、${writes} 次插入）`)
  return steps
}

/* ───────────────────────── R4 图 BFS ───────────────────────── */
const BASE_NODES: GraphNodeViz[] = [
  { key: 'A', label: 'A', x: 15, y: 20 }, { key: 'B', label: 'B', x: 50, y: 10 },
  { key: 'C', label: 'C', x: 85, y: 20 }, { key: 'D', label: 'D', x: 28, y: 58 },
  { key: 'E', label: 'E', x: 72, y: 58 }, { key: 'F', label: 'F', x: 50, y: 90 },
]
const BASE_EDGES: GraphEdgeViz[] = [
  { from: 'A', to: 'B' }, { from: 'A', to: 'D' }, { from: 'B', to: 'C' }, { from: 'B', to: 'E' },
  { from: 'C', to: 'E' }, { from: 'D', to: 'E' }, { from: 'D', to: 'F' }, { from: 'E', to: 'F' },
]
const ADJ: Record<string, string[]> = {
  A: ['B', 'D'], B: ['A', 'C', 'E'], C: ['B', 'E'], D: ['A', 'E', 'F'], E: ['B', 'C', 'D', 'F'], F: ['D', 'E'],
}
export function graphBfs(): VizStep[] {
  const steps: VizStep[] = []
  const visited = new Set<string>()
  const inQueue = new Set<string>()
  const queue: string[] = []
  let cur: string | null = null
  const emit = (description: string): void => {
    const nodes = BASE_NODES.map((nd) => {
      const role: VizRole | undefined = nd.key === cur ? 'active' : visited.has(nd.key) ? 'sorted' : inQueue.has(nd.key) ? 'pivot' : undefined
      const g: GraphNodeViz = { key: nd.key, label: nd.label, x: nd.x, y: nd.y }
      if (role) g.role = role
      return g
    })
    steps.push({ description, snapshot: { kind: 'graph', nodes, edges: BASE_EDGES, counters: { visited: visited.size } } })
  }
  emit('无向图共 6 个结点，从 A 开始广度优先遍历（BFS）：蓝=在队列，绿=已访问，紫=当前出队')
  queue.push('A'); inQueue.add('A')
  emit('起点 A 入队')
  while (queue.length > 0) {
    cur = queue.shift()!
    inQueue.delete(cur)
    visited.add(cur)
    emit(`出队 ${cur} 并访问它；依次检查它的邻接点`)
    for (const nb of ADJ[cur] ?? []) {
      if (!visited.has(nb) && !inQueue.has(nb)) {
        queue.push(nb); inQueue.add(nb)
        emit(`${nb} 未访问，入队（${cur} → ${nb}）`)
      }
    }
    cur = null
  }
  emit(`BFS 完成，访问顺序：A → B → D → C → E → F（visited=${visited.size}）`)
  return steps
}

/* ───────────────────────── R5 值传递 vs 地址传递 ───────────────────────── */
function cell(key: string, address: string, value: string, role?: VizRole, note?: string): MemoryCell {
  const c: MemoryCell = { key, address, value }
  if (role) c.role = role
  if (note) c.note = note
  return c
}
export function memorySwapCall(): VizStep[] {
  const steps: VizStep[] = []
  let left: MemoryCell[] = [cell('x', '0x1000', '1'), cell('y', '0x1004', '2')]
  let right: MemoryCell[] = [cell('x', '0x1000', '1'), cell('y', '0x1004', '2')]
  const emit = (description: string): void => {
    const regions: MemoryRegion[] = [
      { key: 'byvalue', title: '值传递 swap(int a, int b)', note: '形参是副本', cells: left.map((c) => ({ ...c })) },
      { key: 'byaddr', title: '地址传递 swap(int *pa, int *pb)', note: '形参是指针', cells: right.map((c) => ({ ...c })) },
    ]
    steps.push({ description, snapshot: { kind: 'memory', regions } })
  }
  emit('main 中 x=1、y=2，目标是把它们交换。左：值传递；右：地址传递。两侧内存格并排对照')
  left = [cell('x', '0x1000', '1'), cell('y', '0x1004', '2'), cell('a', '0x2000', '1', 'active', 'x 的副本'), cell('b', '0x2004', '2', 'active', 'y 的副本')]
  emit('值传递：调用 swap(x, y)，把 x、y 的值【复制】一份给形参 a、b（a、b 与 x、y 是不同的内存单元）')
  left = [cell('x', '0x1000', '1'), cell('y', '0x1004', '2'), cell('a', '0x2000', '2', 'swap', '副本被改'), cell('b', '0x2004', '1', 'swap', '副本被改')]
  emit('函数内交换 a、b：a=2、b=1 —— 但 0x1000/0x1004 上的 x、y 纹丝不动')
  left = [cell('x', '0x1000', '1'), cell('y', '0x1004', '2')]
  emit('函数返回，形参 a、b 的内存被释放；x=1、y=2，交换失败')
  right = [cell('x', '0x1000', '1'), cell('y', '0x1004', '2'), cell('pa', '0x3000', '→ x', 'active', '存 x 的地址 0x1000'), cell('pb', '0x3004', '→ y', 'active', '存 y 的地址 0x1004')]
  emit('地址传递：调用 swap(&x, &y)，形参 pa、pb 是指针，分别保存 x、y 的地址')
  right = [cell('x', '0x1000', '2', 'swap'), cell('y', '0x1004', '1', 'swap'), cell('pa', '0x3000', '→ x', 'active'), cell('pb', '0x3004', '→ y', 'active')]
  emit('交换 *pa 与 *pb：直接改写 pa/pb 所指内存，即 x、y 本体 → x=2、y=1')
  right = [cell('x', '0x1000', '2', 'sorted'), cell('y', '0x1004', '1', 'sorted')]
  emit('函数返回，指针 pa、pb 释放；x=2、y=1，交换成功 —— 这就是 swap 必须传地址的原因')
  return steps
}

/* 样例演示的对照 C 源码（标准 C，仅上屏展示，不编译） */
export const SAMPLE_CODE: Record<string, string> = {
  'linear-singly-insert': `struct Node { int data; struct Node *next; };

/* 头插法：先连（new->next = head），后改头（head = new） */
struct Node *insertFront(struct Node *head, int v) {
    struct Node *nw = malloc(sizeof(struct Node));
    nw->data = v;
    nw->next = head;   /* 先连：新结点接住原链表 */
    head = nw;         /* 后改头：头指针指向新结点 */
    return head;
}`,
  'tree-bst-insert': `struct TNode { int key; struct TNode *left, *right; };

struct TNode *bstInsert(struct TNode *root, int v) {
    if (root == NULL) {                 /* 找到空位，落新结点 */
        struct TNode *nw = malloc(sizeof(struct TNode));
        nw->key = v; nw->left = nw->right = NULL;
        return nw;
    }
    if (v < root->key) root->left  = bstInsert(root->left,  v);
    else               root->right = bstInsert(root->right, v);
    return root;
}`,
  'graph-bfs': `void bfs(int start, int n, const int adj[][n], int visited[]) {
    int queue[n], front = 0, rear = 0;
    visited[start] = 1;
    queue[rear++] = start;              /* 起点入队 */
    while (front < rear) {
        int u = queue[front++];         /* 出队 */
        for (int v = 0; v < n; v++)
            if (adj[u][v] && !visited[v]) {
                visited[v] = 1;
                queue[rear++] = v;      /* 未访问邻居入队 */
            }
    }
}`,
  'memory-swap-call': `/* 值传递：形参是实参的副本，改副本动不了 x、y */
void swapByValue(int a, int b) {
    int t = a; a = b; b = t;
}

/* 地址传递：形参是指针，*pa、*pb 就是 x、y 本身 */
void swapByAddr(int *pa, int *pb) {
    int t = *pa; *pa = *pb; *pb = t;
}

int main(void) {
    int x = 1, y = 2;
    swapByValue(x, y);    /* 返回后 x=1, y=2（没变） */
    swapByAddr(&x, &y);   /* 返回后 x=2, y=1（成功） */
    return 0;
}`,
}