/**
 * R3 树演示生成器（阶段 7 · 会话 2）。
 *
 * 覆盖：三种递归遍历、BST 删除（双孩子情形）、建堆（自底向上筛选）、
 *      AVL 四种旋转、哈夫曼树构造。全部纯函数产出 VizStep[]，每步是完整快照。
 *
 * 两条实现口径：
 *   1. TreeSnapshot 只有一个 root，哈夫曼构造期是「森林」，于是挂一个虚根 F 把
 *      各棵树并排展示；合并到只剩一棵时换成真根，虚根随之消失（解说里讲清楚）。
 *   2. children 里的 null 占位不能省 —— 渲染器的 tidy tree 靠它保持二叉树左右形态。
 */
import type { TreeNodeViz, VizRole, VizStep } from '../types'

interface BNode { key: string; label: string; left: BNode | null; right: BNode | null }

function toViz(n: BNode | null, mark: Map<string, VizRole>): TreeNodeViz | null {
  if (!n) return null
  const node: TreeNodeViz = { key: n.key, label: n.label, children: [toViz(n.left, mark), toViz(n.right, mark)] }
  const role = mark.get(n.key)
  if (role) node.role = role
  return node
}
function tree(root: BNode | null, counters: Record<string, number>, mark = new Map<string, VizRole>()) {
  return { kind: 'tree' as const, root: toViz(root, mark), counters }
}
function bn(key: string, label: string, left: BNode | null = null, right: BNode | null = null): BNode {
  return { key, label, left, right }
}

/** 六种遍历共用的样例树：
 *          A
 *        /   \
 *       B     C
 *      / \   /
 *     D   E F
 */
function sampleTree(): BNode {
  return bn('A', 'A', bn('B', 'B', bn('D', 'D'), bn('E', 'E')), bn('C', 'C', bn('F', 'F'), null))
}

const ORDER_NAME: Record<string, string> = { pre: '先序（根→左→右）', in: '中序（左→根→右）', post: '后序（左→右→根）' }
/** 访问语句在 VIZ_CODE 里的行号：先序 printf 在第 6 行，中序第 7 行，后序第 8 行 */
const VISIT_LINE: Record<string, number> = { pre: 6, in: 7, post: 8 }

function walk(n: BNode | null, order: 'pre' | 'in' | 'post', out: BNode[]): void {
  if (!n) return
  if (order === 'pre') out.push(n)
  walk(n.left, order, out)
  if (order === 'in') out.push(n)
  walk(n.right, order, out)
  if (order === 'post') out.push(n)
}

export function treeTraversal(order: 'pre' | 'in' | 'post'): () => VizStep[] {
  return () => {
    const root = sampleTree()
    const seq: BNode[] = []
    walk(root, order, seq)
    const steps: VizStep[] = []
    let visited = 0
    steps.push({
      description: `样例二叉树，做${ORDER_NAME[order]}遍历。递归的三个动作顺序决定了访问顺序：${order === 'pre' ? '先访问根，再递归左子树、右子树' : order === 'in' ? '先递归左子树，再访问根，最后递归右子树' : '先递归左子树、右子树，最后才访问根'}`,
      codeLine: 4,
      snapshot: tree(root, { visited }),
    })
    for (const n of seq) {
      visited += 1
      const done = new Set(seq.slice(0, visited - 1).map((x) => x.key))
      const mark = new Map<string, VizRole>()
      for (const k of done) mark.set(k, 'sorted')
      mark.set(n.key, 'active')
      steps.push({
        description: `第 ${visited} 个访问 ${n.label}。已访问序列：${seq.slice(0, visited).map((x) => x.label).join(' → ')}（绿色是已经访问完的，橙色是本次访问）`,
        codeLine: VISIT_LINE[order],
        snapshot: tree(root, { visited }, mark),
      })
    }
    const all = new Map<string, VizRole>(seq.map((n) => [n.key, 'sorted' as VizRole]))
    const others: Record<string, string> = {
      pre: '先序序列的第 1 个一定是根；已知先序 + 中序可以唯一还原一棵二叉树',
      in: '中序序列里根一定把序列切成「左子树 | 根 | 右子树」三段；对二叉排序树做中序遍历得到的必然是递增序列',
      post: '后序序列的最后 1 个一定是根；销毁整棵树、求树高都要用后序 —— 必须先把孩子处理完才轮到自己',
    }
    steps.push({
      description: `${ORDER_NAME[order]}遍历结束：${seq.map((x) => x.label).join(' ')}，共访问 ${visited} 个结点 = 树的结点数。${others[order]}`,
      snapshot: tree(root, { visited }, all),
    })
    return steps
  }
}

/* ───────────────────────── BST 删除（双孩子） ───────────────────────── */

export function bstDelete(): VizStep[] {
  /** 由 8 3 10 1 6 14 4 7 13 依次插入得到的二叉排序树 */
  const root: BNode = bn('n8', '8',
    bn('n3', '3', bn('n1', '1'), bn('n6', '6', bn('n4', '4'), bn('n7', '7'))),
    bn('n10', '10', null, bn('n14', '14', bn('n13', '13'), null)))
  const steps: VizStep[] = []
  let comparisons = 0
  let writes = 0
  const emit = (description: string, mark: Map<string, VizRole>, r: BNode = root, codeLine?: number): void => {
    const s: VizStep = { description, snapshot: tree(r, { comparisons, pointerWrites: writes }, mark) }
    if (codeLine !== undefined) s.codeLine = codeLine
    steps.push(s)
  }

  emit('二叉排序树（左小右大），要删除结点 3。它有左右两个孩子，是三种删除情形里最麻烦的一种', new Map(), root, 4)
  comparisons += 2
  emit('查找 3：3 < 8 往左走（比较 1 次），到结点 3 命中（比较 2 次）', new Map([['n8', 'compare'], ['n3', 'pivot']]), root, 5)
  emit('情形判定：3 的左孩子是 1、右孩子是 6，两个孩子都非空。直接 free(3) 会让 1 和 6 两棵子树同时失联，所以不能直接删', new Map([['n3', 'pivot'], ['n1', 'compare'], ['n6', 'compare']]), root, 8)
  comparisons += 2
  emit('找中序后继：到右子树 6，再一路沿 left 往下 —— 6 的左孩子是 4，4 没有左孩子，所以 4 就是 3 的中序后继（比较 2 次）。后继一定是右子树里最小的那个，它至多有右孩子、不会有左孩子', new Map([['n6', 'compare'], ['n4', 'active']]), root, 9)
  writes += 1
  const swapped: BNode = bn('n8', '8', bn('n3', '4', bn('n1', '1'), bn('n6', '6', bn('n4', '4'), bn('n7', '7'))), bn('n10', '10', null, bn('n14', '14', bn('n13', '13'), null)))
  emit('t->key = s->key：把后继的值 4 抄到结点 3 的位置上（树形一动不动，只换了值）。现在树里出现两个 4：一个是刚抄上来的替身，一个是原来的后继结点', new Map([['n3', 'active'], ['n4', 'swap']]), swapped, 11)
  comparisons += 2
  writes += 1
  const after: BNode = bn('n8', '8', bn('n3', '4', bn('n1', '1'), bn('n6', '6', null, bn('n7', '7'))), bn('n10', '10', null, bn('n14', '14', bn('n13', '13'), null)))
  emit('递归到右子树删除原来的 4：4 > ... 沿路径找到它，它是叶子结点，属于「0 个孩子」情形 —— 直接 free，并让 6 的 left = NULL（比较 2 次、指针修改 1 次）', new Map([['n6', 'compare']]), after, 15)
  writes += 1
  emit('递归返回值写回 t->right（指针修改 1 次）。删除完成：4 顶替了 3 的位置，6 的左孩子为空', new Map([['n3', 'sorted'], ['n6', 'sorted']]), after, 12)
  const flat: string[] = []
  const flatKeys: string[] = []
  const collect = (n: BNode | null): void => { if (!n) return; collect(n.left); flat.push(n.label); flatKeys.push(n.key); collect(n.right) }
  collect(after)
  emit(`校验：中序遍历结果是 ${flat.join(' ')}，仍然严格递增 —— BST 的有序性没被破坏。这就是「用中序后继替身」的意义（共 ${comparisons} 次比较、${writes} 次指针修改）`, new Map(flatKeys.map((k) => [k, 'sorted' as VizRole])), after, 4)
  return steps
}

/* ───────────────────────── 建堆（自底向上筛选） ───────────────────────── */

export function heapBuild(): VizStep[] {
  const src = [4, 7, 2, 9, 1, 6]
  const a = [...src]
  const steps: VizStep[] = []
  let comparisons = 0
  let swaps = 0

  const toTree = (mark: Map<number, VizRole>): TreeNodeViz | null => {
    const build = (i: number): TreeNodeViz | null => {
      if (i >= a.length) return null
      const node: TreeNodeViz = { key: 'i' + i, label: String(a[i]), children: [build(2 * i + 1), build(2 * i + 2)] }
      const role = mark.get(i)
      if (role) node.role = role
      return node
    }
    return build(0)
  }
  const emit = (description: string, mark: Map<number, VizRole>, codeLine?: number): void => {
    const s: VizStep = { description, snapshot: { kind: 'tree', root: toTree(mark), counters: { comparisons, swaps } } }
    if (codeLine !== undefined) s.codeLine = codeLine
    steps.push(s)
  }

  emit(`数组 [${a.join(', ')}] 按下标层序摆成完全二叉树：i 的左右孩子是 2i+1 和 2i+2。目标建成大根堆（每个父结点都不小于它的孩子）`, new Map(), 12)
  emit(`建堆从最后一个非叶结点 n/2-1 = ${Math.floor(a.length / 2) - 1} 开始，倒着往前逐个 siftDown。叶子结点天然就是合法的堆，不必处理 —— 这就是建堆总代价只有 O(n) 而不是 O(n log n) 的原因`, new Map([2, 1, 0].map((i) => [i, 'compare'] as [number, VizRole])), 13)

  const sift = (start: number): void => {
    let i = start
    for (let c = 2 * i + 1; c < a.length; i = c, c = 2 * i + 1) {
      const twoKids = c + 1 < a.length
      const bigger = twoKids && a[c + 1]! > a[c]! ? c + 1 : c
      if (twoKids) comparisons += 1
      emit(`siftDown(${i})：a[${i}]=${a[i]}，先取较大的孩子 —— ${twoKids ? `比较 a[${c}]=${a[c]} 与 a[${c + 1}]=${a[c + 1]}，` : `只有一个孩子 a[${c}]=${a[c]}，`}选 a[${bigger}]=${a[bigger]}`, new Map([[i, 'active'], [bigger, 'compare']]), 7)
      comparisons += 1
      if (a[i]! >= a[bigger]!) {
        emit(`a[${i}]=${a[i]} ≥ 较大孩子 a[${bigger}]=${a[bigger]}，堆序已满足，停止下沉`, new Map([[i, 'sorted']]), 8)
        return
      }
      const t = a[i]!
      a[i] = a[bigger]!
      a[bigger] = t
      swaps += 1
      emit(`a[${i}]=${t} < a[${bigger}]=${a[i]}，交换两者 —— ${a[i]} 上浮、${t} 下沉到下标 ${bigger}，继续检查`, new Map([[i, 'swap'], [bigger, 'swap']]), 9)
    }
    emit(`siftDown(${i})：下标 ${i} 已经没有孩子，下沉结束。此时以 ${start} 为根的子树是大根堆`, new Map([[i, 'sorted']]), 6)
  }

  for (let i = Math.floor(a.length / 2) - 1; i >= 0; i -= 1) {
    emit(`轮到 siftDown(${i})：a[${i}]=${a[i]}，它的孩子是 ${2 * i + 1 < a.length ? `a[${2 * i + 1}]=${a[2 * i + 1]}` : '无'}${2 * i + 2 < a.length ? ` 和 a[${2 * i + 2}]=${a[2 * i + 2]}` : ''}`, new Map([[i, 'pivot']]), 13)
    sift(i)
  }
  emit(`建堆完成：[${a.join(', ')}]，源数组是 [${src.join(', ')}]。堆顶 a[0]=${a[0]} 就是最大值，堆排序正是反复把堆顶与末尾交换再 siftDown(0)`, new Map(a.map((_, i) => [i, 'sorted' as VizRole])), 12)
  return steps
}

/* ───────────────────────── AVL 四种旋转 ───────────────────────── */

export function avlRotate(): VizStep[] {
  const steps: VizStep[] = []
  let writes = 0
  const emit = (description: string, root: BNode | null, mark: Map<string, VizRole>, codeLine?: number): void => {
    const s: VizStep = { description, snapshot: tree(root, { pointerWrites: writes }, mark) }
    if (codeLine !== undefined) s.codeLine = codeLine
    steps.push(s)
  }
  const mk = (k: string, l: BNode | null, r: BNode | null): BNode => bn(k, k.replace('n', ''), l, r)

  emit('AVL 树要求任意结点的平衡因子 |左高 - 右高| ≤ 1。插入后一旦某结点失衡，就按「失衡点 + 插入位置」分成 LL / RR / LR / RL 四种情形旋转。下面每种各演示一次，统计的是全程指针修改次数', null, new Map(), 2)

  /* LL：在 3 的左孩子 2 的左子树上插入 1 */
  const ll: BNode = mk('n3', mk('n2', mk('n1', null, null), null), null)
  emit('【LL 情形】结点 3 的平衡因子 = 2 - 0 = +2 失衡，新结点 1 插在「左孩子的左子树」上 → 右单旋', ll, new Map([['n3', 'compare'], ['n2', 'pivot'], ['n1', 'active']]), 5)
  writes += 2
  const ll2: BNode = mk('n2', mk('n1', null, null), mk('n3', null, null))
  emit('rotateR(3)：x = y->left = 2；y->left = x->right（2 的右子树是空，挂给 3 的左）；x->right = y（3 降为 2 的右孩子）。2 次指针修改', ll2, new Map([['n2', 'active']]), 7)
  emit('LL 旋转结果：2 成为新根，1 在左、3 在右，三个结点平衡因子全为 0 或 ±1，恢复平衡', ll2, new Map([['n1', 'sorted'], ['n2', 'sorted'], ['n3', 'sorted']]), 12)

  /* RR：在 1 的右孩子 2 的右子树上插入 3 */
  const rr: BNode = mk('n1', null, mk('n2', null, mk('n3', null, null)))
  emit('【RR 情形】结点 1 的平衡因子 = 0 - 2 = -2 失衡，新结点 3 插在「右孩子的右子树」上 → 左单旋，与 LL 完全对称', rr, new Map([['n1', 'compare'], ['n2', 'pivot'], ['n3', 'active']]), 14)
  writes += 2
  const rr2: BNode = mk('n2', mk('n1', null, null), mk('n3', null, null))
  emit('rotateL(1)：y = x->right = 2；x->right = y->left；y->left = x。2 次指针修改，1 降为 2 的左孩子', rr2, new Map([['n2', 'active']]), 16)
  emit('RR 旋转结果：同样得到 2(1, 3)。注意 LL 和 RR 的最终形态一样，只是旋转方向相反', rr2, new Map([['n1', 'sorted'], ['n2', 'sorted'], ['n3', 'sorted']]), 21)

  /* LR：3 的左孩子 1，1 的右孩子 2 */
  const lr: BNode = mk('n3', mk('n1', null, mk('n2', null, null)), null)
  emit('【LR 情形】结点 3 的平衡因子 = +2 失衡，但新结点 2 插在「左孩子的右子树」上 —— 单旋解决不了，必须先左旋再右旋', lr, new Map([['n3', 'compare'], ['n1', 'pivot'], ['n2', 'active']]), 22)
  writes += 2
  const lr1: BNode = mk('n3', mk('n2', mk('n1', null, null), null), null)
  emit('第一步 rotateL(1)：把 LR 掰成 LL。2 上升到 3 的左孩子位置，1 降为 2 的左孩子。2 次指针修改', lr1, new Map([['n2', 'active'], ['n1', 'swap']]), 16)
  writes += 2
  const lr2: BNode = mk('n2', mk('n1', null, null), mk('n3', null, null))
  emit('第二步 rotateR(3)：现在就是标准 LL 了，右单旋把 2 提为根。又 2 次指针修改，双旋共 4 次', lr2, new Map([['n2', 'active']]), 7)
  emit('LR 旋转结果：2(1, 3)。口诀「先扳成同向、再单旋」', lr2, new Map([['n1', 'sorted'], ['n2', 'sorted'], ['n3', 'sorted']]), 22)

  /* RL：1 的右孩子 3，3 的左孩子 2 */
  const rl: BNode = mk('n1', null, mk('n3', mk('n2', null, null), null))
  emit('【RL 情形】结点 1 的平衡因子 = -2 失衡，新结点 2 插在「右孩子的左子树」上 → 先对右孩子右旋，再对自己左旋', rl, new Map([['n1', 'compare'], ['n3', 'pivot'], ['n2', 'active']]), 22)
  writes += 2
  const rl1: BNode = mk('n1', null, mk('n2', null, mk('n3', null, null)))
  emit('第一步 rotateR(3)：把 RL 掰成 RR。2 上升到 1 的右孩子位置，3 降为 2 的右孩子。2 次指针修改', rl1, new Map([['n2', 'active'], ['n3', 'swap']]), 7)
  writes += 2
  const rl2: BNode = mk('n2', mk('n1', null, null), mk('n3', null, null))
  emit('第二步 rotateL(1)：标准 RR，左单旋把 2 提为根。2 次指针修改', rl2, new Map([['n2', 'active']]), 16)
  emit(`RL 旋转结果：2(1, 3)。四种旋转殊途同归，都把中间值提为根；单旋 2 次指针修改、双旋 4 次，本演示共 ${writes} 次`, rl2, new Map([['n1', 'sorted'], ['n2', 'sorted'], ['n3', 'sorted']]), 22)
  return steps
}

/* ───────────────────────── 哈夫曼树构造 ───────────────────────── */

interface HNode { key: string; w: number; left: HNode | null; right: HNode | null; leaf?: string }

export function huffmanBuild(): VizStep[] {
  const weights = [5, 7, 2, 13, 9]
  const steps: VizStep[] = []
  let comparisons = 0
  let writes = 0
  let forest: HNode[] = weights.map((w, i) => ({ key: 'w' + i, w, left: null, right: null, leaf: String(w) }))
  let merged = 0

  const viz = (n: HNode, mark: Map<string, VizRole>): TreeNodeViz => {
    const node: TreeNodeViz = {
      key: n.key,
      label: String(n.w),
      children: [n.left ? viz(n.left, mark) : null, n.right ? viz(n.right, mark) : null],
    }
    const role = mark.get(n.key)
    if (role) node.role = role
    if (!n.leaf && !role) node.role = 'pivot'
    return node
  }
  const emit = (description: string, mark: Map<string, VizRole>, codeLine?: number): void => {
    const kids = forest.map((t) => viz(t, mark))
    const root: TreeNodeViz = forest.length === 1
      ? kids[0]!
      : { key: 'F', label: 'F', role: 'idle', children: kids }
    const s: VizStep = { description, snapshot: { kind: 'tree', root, counters: { comparisons, pointerWrites: writes } } }
    if (codeLine !== undefined) s.codeLine = codeLine
    steps.push(s)
  }

  emit(`初始森林：${weights.length} 个权值 ${weights.join('、')} 各自是一棵只有根的树。虚根 F 只是把它们并排挂在一起显示，不是哈夫曼树的结点。共需合并 n-1 = ${weights.length - 1} 次`, new Map(), 4)
  while (forest.length > 1) {
    merged += 1
    const m = forest.length
    comparisons += 2 * m - 3
    let i1 = 0
    let i2 = 1
    if (forest[i1]!.w > forest[i2]!.w) { const t = i1; i1 = i2; i2 = t }
    for (let i = 2; i < m; i += 1) {
      if (forest[i]!.w < forest[i1]!.w) { i2 = i1; i1 = i } else if (forest[i]!.w < forest[i2]!.w) i2 = i
    }
    const a = forest[i1]!
    const b = forest[i2]!
    emit(`第 ${merged} 次合并 · 选最小：扫描森林比较 ${2 * m - 3} 次，挑出权值最小的两棵 —— ${a.w} 和 ${b.w}`, new Map([[a.key, 'compare'], [b.key, 'compare']]), 13)
    const p: HNode = { key: 'm' + merged, w: a.w + b.w, left: a, right: b }
    writes += 2
    forest = forest.filter((_, i) => i !== i1 && i !== i2)
    forest.push(p)
    forest.sort((x, y) => x.w - y.w || x.key.localeCompare(y.key))
    emit(`合并：新结点权值 = ${a.w} + ${b.w} = ${p.w}，${a.w} 作左孩子、${b.w} 作右孩子（2 次指针修改）。森林剩 ${forest.length} 棵：${forest.map((t) => t.w).join('、')}`, new Map([[p.key, 'active'], [a.key, 'swap'], [b.key, 'swap']]), 18)
  }
  const depthOf = (n: HNode | null, d: number, out: { leaf: string; w: number; d: number }[]): void => {
    if (!n) return
    if (!n.left && !n.right) out.push({ leaf: n.leaf ?? String(n.w), w: n.w, d })
    depthOf(n.left, d + 1, out)
    depthOf(n.right, d + 1, out)
  }
  const leaves: { leaf: string; w: number; d: number }[] = []
  depthOf(forest[0]!, 0, leaves)
  const wpl = leaves.reduce((s, x) => s + x.w * x.d, 0)
  emit(`构造完成：森林只剩一棵树，根权值 ${forest[0]!.w} = 全部权值之和。虚根 F 消失，看到的就是哈夫曼树`, new Map(), 21)
  emit(`带权路径长度 WPL = ${leaves.map((x) => `${x.w}×${x.d}`).join(' + ')} = ${wpl}。权值大的结点离根近、权值小的离根远，WPL 达到最小 —— 这正是哈夫曼编码能让总码长最短的原因`, leaves.reduce((m, x) => m.set('w' + weights.indexOf(Number(x.leaf)), 'sorted'), new Map<string, VizRole>()), 21)
  return steps
}
