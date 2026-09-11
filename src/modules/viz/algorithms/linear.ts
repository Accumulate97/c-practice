/**
 * R2 节点链演示生成器（阶段 7 · 会话 2）。
 *
 * 全部纯函数、产出 VizStep[]，每一步都是**完整状态快照**（后退只靠下标回退，不做逆运算）。
 * 教学重点统一落在「指针修改顺序」上（07_可视化演示规范.md 二·A/B 的关键教学点）：
 *   linearSinglyDelete      单链表删除 —— 先连（pre->next 绕过）后断（free）
 *   linearDoublyInsertDelete 双链表插删 —— 插入 4 次、删除 2 次指针修改的先后
 *   linearStackPushPop      顺序栈 —— top 指针 + 栈满/栈空判别
 *   linearQueueEnqueueDequeue 循环队列 —— front/rear 绕回 + 「少用一个单元」的队满歧义
 *   linearCircularList      单循环链表 —— 尾结点指回头，尾插 O(1)
 *
 * 纪律：结点一律用 key 不用 id（build-index.ts 的 collectIds 会把带 id 的对象收进索引）；
 *      每步都带齐 spec 声明的全部 counterKeys（gen-viz.ts 落盘前严格比对统计口径）。
 */
import type { ChainEdge, ChainNode, VizRole, VizStep } from '../types'

type Ptr = { label: string; node: string | null }

function nd(key: string, label: string, role?: VizRole, fields?: Record<string, string>): ChainNode {
  const o: ChainNode = { key, label }
  if (role) o.role = role
  if (fields) o.fields = fields
  return o
}
function eg(from: string, to: string | null, role?: VizRole, label?: string): ChainEdge {
  const o: ChainEdge = { from, to }
  if (role) o.role = role
  if (label) o.label = label
  return o
}
function snap(nodes: ChainNode[], edges: ChainEdge[], pointers: Ptr[], counters: Record<string, number>) {
  return { kind: 'nodechain' as const, nodes, edges, pointers, counters }
}

/* ───────────────────────── 单链表删除 ───────────────────────── */

export function linearSinglyDelete(): VizStep[] {
  const steps: VizStep[] = []
  let comparisons = 0
  let writes = 0
  const keys = ['A', 'B', 'C', 'D']
  const alive = new Set(keys)

  const nodes = (mark: Map<string, VizRole>): ChainNode[] =>
    keys.filter((k) => alive.has(k)).map((k) => nd(k, k, mark.get(k)))
  /** 边永远按「当前还活着的结点」串成链，free 掉 C 之后 B 自动直连 D */
  const edges = (bypassC = false): ChainEdge[] => {
    const seq = keys.filter((k) => alive.has(k))
    const out: ChainEdge[] = []
    for (let i = 0; i < seq.length; i += 1) {
      const cur = seq[i]!
      const nxt = i + 1 < seq.length ? seq[i + 1]! : null
      out.push(eg(cur, nxt, bypassC && cur === 'B' ? 'swap' : undefined))
    }
    return out
  }

  steps.push({
    description: '单链表 head → A → B → C → D → ∧，现在要删除结点 C。删除的难点是：必须先记住 C 的前驱，否则摘掉 C 之后链表就断了',
    codeLine: 4,
    snapshot: snap(nodes(new Map()), edges(), [{ label: 'head', node: 'A' }], { comparisons, pointerWrites: writes }),
  })
  steps.push({
    description: 'p 从 head 出发、pre 落后一步（pre = NULL）。p = A：A 不是要找的 C，比较 1 次',
    codeLine: 5,
    snapshot: snap(nodes(new Map([['A', 'compare']])), edges(), [{ label: 'p', node: 'A' }, { label: 'pre = NULL', node: null }], { comparisons: ++comparisons, pointerWrites: writes }),
  })
  steps.push({
    description: 'pre = A、p = B：B 也不是 C，比较 2 次。循环体每转一圈，pre 和 p 一起往前走一步',
    codeLine: 6,
    snapshot: snap(nodes(new Map([['B', 'compare']])), edges(), [{ label: 'p', node: 'B' }, { label: 'pre', node: 'A' }], { comparisons: ++comparisons, pointerWrites: writes }),
  })
  steps.push({
    description: 'pre = B、p = C：p->data 命中，比较 3 次后退出循环。此刻 pre = B 就是 C 的前驱，删除全靠它',
    codeLine: 5,
    snapshot: snap(nodes(new Map([['C', 'pivot']])), edges(), [{ label: 'p', node: 'C' }, { label: 'pre', node: 'B' }], { comparisons: ++comparisons, pointerWrites: writes }),
  })
  steps.push({
    description: '第一步「先连」：pre->next = p->next，也就是让 B 直接指向 D。C 被绕过但还没释放，链表此刻已经完整',
    codeLine: 11,
    snapshot: snap(nodes(new Map([['C', 'swap'], ['B', 'active']])), edges(true), [{ label: 'p', node: 'C' }, { label: 'pre', node: 'B' }], { comparisons, pointerWrites: ++writes }),
  })
  alive.delete('C')
  steps.push({
    description: '第二步「后断」：free(p) 归还 C 的内存，结点从链表里消失。顺序不能颠倒 —— 先 free 再取 p->next 就是访问已释放内存',
    codeLine: 12,
    snapshot: snap(nodes(new Map()), edges(), [{ label: 'head', node: 'A' }], { comparisons, pointerWrites: writes }),
  })
  steps.push({
    description: '删除完成：head → A → B → D → ∧。全程 3 次比较、1 次指针修改。若删的是头结点（pre == NULL），则改的是 head = p->next',
    codeLine: 10,
    snapshot: snap(keys.filter((k) => alive.has(k)).map((k) => nd(k, k, 'sorted')), edges(), [{ label: 'head', node: 'A' }], { comparisons, pointerWrites: writes }),
  })
  return steps
}

/* ───────────────────────── 双链表插入与删除 ───────────────────────── */

export function linearDoublyInsertDelete(): VizStep[] {
  const steps: VizStep[] = []
  let writes = 0
  /** 双链表状态：order 决定横向排布，hasX 表示 X 是否已经接入 */
  const render = (
    order: string[],
    xIn: boolean,
    nextMap: Record<string, string | null>,
    prevMap: Record<string, string | null>,
    mark: Map<string, VizRole>,
    hotEdges: Set<string>,
  ) => {
    const nodes = order.map((k) => nd(k, k, mark.get(k)))
    const edges: ChainEdge[] = []
    for (const k of order) {
      if (k === 'X' && !xIn) continue
      const nx = nextMap[k]
      if (nx !== undefined && (xIn || k !== 'X')) edges.push(eg(k, nx, hotEdges.has('n' + k) ? 'swap' : undefined, 'next'))
    }
    for (const k of order) {
      if (k === 'X' && !xIn) continue
      const pv = prevMap[k]
      if (pv !== undefined && (xIn || k !== 'X')) edges.push(eg(k, pv, hotEdges.has('p' + k) ? 'swap' : undefined, 'prev'))
    }
    return snap(nodes, edges, [{ label: 'head', node: order[0] ?? null }], { pointerWrites: writes })
  }

  const base = (withX: boolean) => ({
    order: withX ? ['A', 'B', 'X', 'C'] : ['A', 'B', 'C'],
    nextMap: { A: 'B', B: 'C', C: null } as Record<string, string | null>,
    prevMap: { A: null, B: 'A', C: 'B' } as Record<string, string | null>,
  })

  const b0 = base(false)
  steps.push({
    description: '双向链表 A ↔ B ↔ C：每个结点有 prev 和 next 两个指针（下方弧线是 prev 回指，直线是 next）。现在要在 B 之后插入 X，再把它删掉',
    codeLine: 4,
    snapshot: render(b0.order, false, b0.nextMap, b0.prevMap, new Map(), new Set()),
  })
  steps.push({
    description: 'malloc 出新结点 X（画在 B 和 C 之间的位置上），此时它的 prev / next 都还是 NULL，尚未接入链表',
    codeLine: 5,
    snapshot: render(['A', 'B', 'X', 'C'], false, { ...b0.nextMap, X: null }, { ...b0.prevMap, X: null }, new Map([['X', 'active']]), new Set()),
  })

  const linked = {
    order: ['A', 'B', 'X', 'C'],
    nextMap: { A: 'B', B: 'X', X: 'C', C: null } as Record<string, string | null>,
    prevMap: { A: null, B: 'A', X: 'B', C: 'X' } as Record<string, string | null>,
  }
  const stages: { desc: string; line: number; next: Record<string, string | null>; prev: Record<string, string | null>; hot: string[] }[] = [
    { desc: '① x->prev = p：新结点先抓住前驱 B。这一步最安全，改的只是 X 自己', line: 6, next: { ...b0.nextMap, X: null }, prev: { ...b0.prevMap, X: 'B' }, hot: ['pX'] },
    { desc: '② x->next = p->next：X 再抓住后继 C。**必须在改 B->next 之前做** —— 一旦 B->next 先指向 X，C 就再也找不到了', line: 7, next: { ...b0.nextMap, X: 'C' }, prev: { ...b0.prevMap, X: 'B' }, hot: ['nX'] },
    { desc: '③ p->next->prev = x：让后继 C 的 prev 回指 X（C 原来指向 B，现在改指 X）', line: 8, next: { ...b0.nextMap, X: 'C' }, prev: { ...b0.prevMap, X: 'B', C: 'X' }, hot: ['pC'] },
    { desc: '④ p->next = x：最后才让 B 的 next 指向 X。4 次指针修改到此完成，插入成功：A ↔ B ↔ X ↔ C', line: 9, next: linked.nextMap, prev: linked.prevMap, hot: ['nB'] },
  ]
  for (const s of stages) {
    writes += 1
    steps.push({ description: s.desc, codeLine: s.line, snapshot: render(linked.order, true, s.next, s.prev, new Map([['X', 'active']]), new Set(s.hot)) })
  }
  steps.push({
    description: '插入完成后的稳定状态：X 的 prev/next 与 B、C 的指针互相咬合，双向都能走通',
    snapshot: render(linked.order, true, linked.nextMap, linked.prevMap, new Map([['X', 'sorted']]), new Set()),
  })

  const del1 = { next: { ...linked.nextMap, B: 'C' }, prev: linked.prevMap }
  writes += 1
  steps.push({
    description: '现在删除 X。① x->prev->next = x->next：让 B 的 next 跳过 X 直接指向 C',
    codeLine: 15,
    snapshot: render(linked.order, true, del1.next, del1.prev, new Map([['X', 'swap']]), new Set(['nB'])),
  })
  const del2 = { next: del1.next, prev: { ...linked.prevMap, C: 'B' } }
  writes += 1
  steps.push({
    description: '② x->next->prev = x->prev：让 C 的 prev 跳过 X 直接指向 B。这两步先后无所谓，因为读的都是 X 自己的指针',
    codeLine: 16,
    snapshot: render(linked.order, true, del2.next, del2.prev, new Map([['X', 'swap']]), new Set(['pC'])),
  })
  steps.push({
    description: '③ free(x)：X 被摘除，双链表回到 A ↔ B ↔ C。小结：插入 4 次指针修改（顺序敏感），删除 2 次（顺序无关）+ 1 次 free',
    codeLine: 17,
    snapshot: render(b0.order, false, b0.nextMap, b0.prevMap, new Map([['A', 'sorted'], ['B', 'sorted'], ['C', 'sorted']]), new Set()),
  })
  return steps
}

/* ───────────────────────── 顺序栈 push / pop ───────────────────────── */

const STACK_CAP = 5

export function linearStackPushPop(): VizStep[] {
  const steps: VizStep[] = []
  let writes = 0
  const data: (number | null)[] = Array.from({ length: STACK_CAP }, () => null)
  let top = -1

  const emit = (description: string, codeLine?: number, hot?: number, hotRole: VizRole = 'active'): void => {
    const nodes = data.map((v, i) =>
      nd('S' + i, v == null ? '·' : String(v), i === hot ? hotRole : (v == null ? 'idle' : 'sorted'), { i: String(i) }),
    )
    const step: VizStep = {
      description,
      snapshot: snap(nodes, [], [{ label: top < 0 ? 'top = -1' : 'top', node: top < 0 ? null : 'S' + top }], { pointerWrites: writes }),
    }
    if (codeLine !== undefined) step.codeLine = codeLine
    steps.push(step)
  }

  emit('顺序栈：data[0..4] 是数组，top 是栈顶下标。初始 top = -1 表示空栈（判空条件 top == -1）', 2)
  const ops: { kind: 'push' | 'pop'; value: number; line: number }[] = [
    { kind: 'push', value: 10, line: 6 }, { kind: 'push', value: 20, line: 6 }, { kind: 'push', value: 30, line: 6 },
    { kind: 'pop', value: 30, line: 12 }, { kind: 'push', value: 40, line: 6 }, { kind: 'push', value: 50, line: 6 },
    { kind: 'push', value: 60, line: 6 },
  ]
  for (const op of ops) {
    if (op.kind === 'push') {
      writes += 1
      top += 1
      data[top] = op.value
      emit(`push(${op.value})：先 ++top 变成 ${top}，再 data[${top}] = ${op.value}。栈里现在有 ${top + 1} 个元素`, op.line, top)
    } else {
      const v = data[top]
      writes += 1
      data[top] = null
      top -= 1
      emit(`pop()：先取 e = data[${top + 1}] = ${v}，再 top-- 变成 ${top}。弹出的永远是最后压进去的 ${v}（LIFO）`, op.line, top + 1, 'swap')
    }
  }
  emit(`此时 top = ${top} = MAXSIZE-1，栈已满。判满条件是 top == MAXSIZE-1`, 5)
  emit('再 push(70)：判满成立，函数直接返回 0，数据一个字节都不写 —— 否则 data[5] 就越界踩到别的变量（栈溢出）', 5, undefined, 'compare')
  return steps
}

/* ───────────────────────── 循环队列 enqueue / dequeue ───────────────────────── */

const Q_CAP = 5

export function linearQueueEnqueueDequeue(): VizStep[] {
  const steps: VizStep[] = []
  let writes = 0
  const data: (number | null)[] = Array.from({ length: Q_CAP }, () => null)
  let front = 0
  let rear = 0
  /** 环形边：Q0→Q1→…→Q4→Q0，把「绕回」画出来（Q4→Q0 是下方弧线） */
  const ring: ChainEdge[] = Array.from({ length: Q_CAP }, (_, i) => eg('Q' + i, 'Q' + ((i + 1) % Q_CAP)))

  const emit = (description: string, codeLine?: number, hot?: number, hotRole: VizRole = 'active'): void => {
    const nodes = data.map((v, i) =>
      nd('Q' + i, v == null ? '·' : String(v), i === hot ? hotRole : (v == null ? 'idle' : 'sorted'), { i: String(i) }),
    )
    const edges = ring.map((e, i) => (i === hot ? { ...e, role: hotRole } : e))
    const pointers: Ptr[] = front === rear
      ? [{ label: 'front = rear', node: 'Q' + front }]
      : [{ label: 'front', node: 'Q' + front }, { label: 'rear', node: 'Q' + ((rear + Q_CAP - 1) % Q_CAP) }]
    const step: VizStep = { description, snapshot: snap(nodes, edges, pointers, { pointerWrites: writes }) }
    if (codeLine !== undefined) step.codeLine = codeLine
    steps.push(step)
  }

  emit('循环队列：把数组首尾相接看成环（下方弧线是 Q4 → Q0）。front 指向队头元素，rear 指向队尾的**下一个空位**；少用一个单元，队满条件是 (rear+1)%5 == front', 2)
  const plan: { kind: 'en' | 'de' | 'note'; value: number; line: number }[] = [
    { kind: 'en', value: 10, line: 6 }, { kind: 'en', value: 20, line: 6 }, { kind: 'en', value: 30, line: 6 }, { kind: 'en', value: 40, line: 6 },
    { kind: 'de', value: 10, line: 12 }, { kind: 'de', value: 20, line: 12 },
    { kind: 'en', value: 50, line: 6 }, { kind: 'en', value: 60, line: 6 },
    { kind: 'note', value: 0, line: 5 }, { kind: 'note', value: 0, line: 5 },
  ]
  for (const op of plan) {
    if (op.kind === 'en') {
      data[rear] = op.value
      const old = rear
      rear = (rear + 1) % Q_CAP
      writes += 1
      const wrapped = rear < old ? ` rear 从 ${old} 绕回 ${rear} —— 这就是「循环」` : ` rear 前进到 ${rear}`
      emit(`enQueue(${op.value})：data[${old}] = ${op.value}，然后 rear = (${old}+1)%5。${wrapped}`, op.line, old)
    } else if (op.kind === 'de') {
      const v = data[front]
      data[front] = null
      const old = front
      front = (front + 1) % Q_CAP
      writes += 1
      emit(`deQueue()：e = data[${old}] = ${v}，然后 front = (${old}+1)%5 = ${front}。队头前移，${v} 出队`, op.line, old, 'swap')
    } else if (plan.indexOf(op) === 8) {
      emit(`现在 front = ${front}、rear = ${rear}，(rear+1)%5 = ${(rear + 1) % Q_CAP} == front → **队满**。注意 Q1 明明是空的，却不能再放：这就是「少用一个单元」换来的判满无歧义`, op.line, undefined, 'compare')
    } else {
      emit(`再 enQueue(70)：判满成立直接返回 0。若不留这个空格，队满时 rear 也会追上 front，与队空条件 front == rear 撞车，就分不清是空还是满了`, op.line, undefined, 'compare')
    }
  }
  return steps
}

/* ───────────────────────── 单循环链表 ───────────────────────── */

export function linearCircularList(): VizStep[] {
  const steps: VizStep[] = []
  let comparisons = 0
  let writes = 0
  const order = ['A', 'B', 'C', 'D']

  const render = (count: number, mark: Map<string, VizRole>, pointers: Ptr[], hot?: string): void => {
    const live = order.slice(0, count)
    const nodes = live.map((k) => nd(k, k, mark.get(k)))
    const edges: ChainEdge[] = live.map((k, i) => {
      const to = live[(i + 1) % live.length]!
      const isRing = i === live.length - 1
      return eg(k, to, hot === k + to ? 'swap' : isRing ? 'pivot' : undefined, isRing ? 'next（回指头）' : undefined)
    })
    steps.push({ snapshot: snap(nodes, edges, pointers, { comparisons, pointerWrites: writes }), description: '' })
  }
  const say = (description: string, codeLine?: number): void => {
    const last = steps[steps.length - 1]!
    last.description = description
    if (codeLine !== undefined) last.codeLine = codeLine
  }

  render(3, new Map(), [{ label: 'head', node: 'A' }])
  say('单循环链表：尾结点 C 的 next 不是 NULL，而是指回头结点 A（下方那条回指弧线）。整条链首尾相接成一个环', 3)
  render(3, new Map([['C', 'pivot']]), [{ label: 'head', node: 'A' }, { label: 'tail', node: 'C' }])
  say('只要额外记住 tail，尾插就不必每次从头绕一圈找尾巴：普通单链表尾插是 O(n)，带 tail 的循环链表是 O(1)', 6)
  steps.push({
    description: 'malloc 出新结点 D。尾插的关键顺序是「先连后改」：① D->next = tail->next，也就是让 D 指回头结点 A',
    codeLine: 9,
    snapshot: snap(
      ['A', 'B', 'C', 'D'].map((k) => nd(k, k, k === 'D' ? 'active' : undefined)),
      [eg('A', 'B'), eg('B', 'C'), eg('C', 'A', 'pivot', 'next'), eg('D', 'A', 'swap', 'next')],
      [{ label: 'head', node: 'A' }, { label: 'tail', node: 'C' }],
      { comparisons, pointerWrites: ++writes },
    ),
  })
  steps.push({
    description: '② tail->next = D：让 C 指向 D。**必须在①之后** —— 如果先改 C->next，A 的地址就丢了，环断成一条链',
    codeLine: 10,
    snapshot: snap(
      ['A', 'B', 'C', 'D'].map((k) => nd(k, k, k === 'D' ? 'active' : undefined)),
      [eg('A', 'B'), eg('B', 'C'), eg('C', 'D', 'swap', 'next'), eg('D', 'A', 'pivot', 'next（回指头）')],
      [{ label: 'head', node: 'A' }, { label: 'tail', node: 'C' }],
      { comparisons, pointerWrites: ++writes },
    ),
  })
  steps.push({
    description: '③ tail = D：尾指针前移。插入完成，A → B → C → D → A 仍然是一个环，全程 3 次指针修改',
    codeLine: 11,
    snapshot: snap(
      order.map((k) => nd(k, k, 'sorted')),
      [eg('A', 'B'), eg('B', 'C'), eg('C', 'D'), eg('D', 'A', 'pivot', 'next（回指头）')],
      [{ label: 'head', node: 'A' }, { label: 'tail', node: 'D' }],
      { comparisons, pointerWrites: ++writes },
    ),
  })
  for (const k of order) {
    comparisons += 1
    steps.push({
      description: `遍历第 ${comparisons} 个结点 ${k}：do-while 的停止条件是 p == head（绕回起点），而不是 p == NULL —— 循环链表里永远遇不到 NULL`,
      codeLine: 17,
      snapshot: snap(
        order.map((j) => nd(j, j, j === k ? 'active' : (order.indexOf(j) < order.indexOf(k) ? 'compare' : undefined))),
        [eg('A', 'B'), eg('B', 'C'), eg('C', 'D'), eg('D', 'A', 'pivot', 'next（回指头）')],
        [{ label: 'head', node: 'A' }, { label: 'p', node: k }],
        { comparisons, pointerWrites: writes },
      ),
    })
  }
  steps.push({
    description: `绕完一圈回到 head，p == head 成立退出，长度 = ${comparisons}。对比：普通单链表尾结点 next = NULL，遍历靠 p != NULL 结束；循环链表靠「回到起点」结束`,
    codeLine: 17,
    snapshot: snap(
      order.map((k) => nd(k, k, 'sorted')),
      [eg('A', 'B'), eg('B', 'C'), eg('C', 'D'), eg('D', 'A', 'pivot', 'next（回指头）')],
      [{ label: 'head', node: 'A' }, { label: 'p', node: 'A' }],
      { comparisons, pointerWrites: writes },
    ),
  })
  return steps
}
