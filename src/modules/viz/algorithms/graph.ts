/**
 * R4 图演示生成器（阶段 7 · 会话 2）。
 *
 * 覆盖：DFS 深度优先、Dijkstra 最短路径、Prim 最小生成树、Kruskal 最小生成树、拓扑排序。
 * 全部纯函数产出 VizStep[]，每步是完整图快照（结点坐标 0–100 归一化，渲染器负责缩放）。
 *
 * 两条口径：
 *   1. 结点标签控制在 3–4 字符内（渲染器把 label 画在 r≈5.5 的圆里、fontSize 4，再长会溢出）；
 *      需要展示 dist / indegree 时写成「A:5」「C:∞」这种紧凑形式。
 *   2. counters 每步都完整输出（gen-viz 要求「声明的 counterKeys == 所有步骤出现过的键的并集」）。
 */
import type { GraphEdgeViz, GraphNodeViz, VizRole, VizStep } from '../types'

/* 6 结点布局（0–100 归一化坐标），五套图演示共用同一批位置，观感一致 */
const POS: Record<string, { x: number; y: number }> = {
  A: { x: 15, y: 20 }, B: { x: 50, y: 10 }, C: { x: 85, y: 20 },
  D: { x: 28, y: 58 }, E: { x: 72, y: 58 }, F: { x: 50, y: 90 },
}
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

/** 无向边规范化键：A-B 与 B-A 视为同一条，方便按边查角色 */
const ekey = (a: string, b: string): string => (a < b ? a + '-' + b : b + '-' + a)

function nodes(roles: Map<string, VizRole>, labels?: Record<string, string>): GraphNodeViz[] {
  return KEYS.map((k) => {
    const g: GraphNodeViz = { key: k, label: labels?.[k] ?? k, x: POS[k]!.x, y: POS[k]!.y }
    const r = roles.get(k)
    if (r) g.role = r
    return g
  })
}

/* ───────────────────────── DFS 深度优先遍历 ───────────────────────── */
const DFS_ADJ: Record<string, string[]> = {
  A: ['B', 'D'], B: ['A', 'C', 'E'], C: ['B', 'E'],
  D: ['A', 'E', 'F'], E: ['B', 'C', 'D', 'F'], F: ['D', 'E'],
}
const PLAIN_EDGES: GraphEdgeViz[] = [
  { from: 'A', to: 'B' }, { from: 'A', to: 'D' }, { from: 'B', to: 'C' },
  { from: 'B', to: 'E' }, { from: 'C', to: 'E' }, { from: 'D', to: 'E' },
  { from: 'D', to: 'F' }, { from: 'E', to: 'F' },
]
export function graphDfs(): VizStep[] {
  const steps: VizStep[] = []
  const visited = new Set<string>()
  const order: string[] = []
  const roles = new Map<string, VizRole>()
  const emit = (description: string): void => {
    steps.push({ description, snapshot: { kind: 'graph', nodes: nodes(new Map(roles)), edges: PLAIN_EDGES, counters: { visited: visited.size } } })
  }
  emit('无向图 6 个结点，从 A 出发做深度优先遍历（DFS）：沿未访问的邻居一条道走到黑，走不动了才回溯。绿=已访问，橙=当前结点')
  const dfs = (u: string): void => {
    visited.add(u)
    order.push(u)
    for (const k of visited) roles.set(k, 'sorted')
    roles.set(u, 'active')
    emit(`访问 ${u}。访问序列：${order.join(' → ')}。接着按邻接表顺序考察 ${u} 的邻居 ${(DFS_ADJ[u] ?? []).join('、')}`)
    for (const v of DFS_ADJ[u] ?? []) {
      if (!visited.has(v)) {
        emit(`${v} 未访问，从 ${u} 递归深入 ${v}（ DFS 的「深」就体现在这里：优先钻到底）`)
        dfs(v)
        for (const k of visited) roles.set(k, 'sorted')
      }
    }
  }
  dfs('A')
  for (const k of visited) roles.set(k, 'sorted')
  emit(`DFS 完成，访问序列：${order.join(' → ')}（visited=${visited.size}，等于结点数说明图连通）。与 BFS 的「层层扩散」不同，DFS 是「一条道走到黑再回头」`)
  return steps
}

/* ───────────────── 带权图（Dijkstra / Prim / Kruskal 共用） ───────────────── */
const WEDGES: { from: string; to: string; weight: number }[] = [
  { from: 'A', to: 'B', weight: 6 }, { from: 'A', to: 'C', weight: 1 },
  { from: 'B', to: 'C', weight: 5 }, { from: 'B', to: 'D', weight: 4 },
  { from: 'C', to: 'D', weight: 5 }, { from: 'C', to: 'E', weight: 8 },
  { from: 'D', to: 'E', weight: 2 }, { from: 'D', to: 'F', weight: 7 },
  { from: 'E', to: 'F', weight: 3 },
]
function wNeighbors(u: string): { to: string; w: number }[] {
  const out: { to: string; w: number }[] = []
  for (const e of WEDGES) {
    if (e.from === u) out.push({ to: e.to, w: e.weight })
    else if (e.to === u) out.push({ to: e.from, w: e.weight })
  }
  return out
}
function wEdges(edgeRoles?: Map<string, VizRole>): GraphEdgeViz[] {
  return WEDGES.map((e) => {
    const eg: GraphEdgeViz = { from: e.from, to: e.to, weight: e.weight }
    const r = edgeRoles?.get(ekey(e.from, e.to))
    if (r) eg.role = r
    return eg
  })
}
const fmt = (d: number): string => (d === Infinity ? '∞' : String(d))

/* ───────────────────────── Dijkstra 最短路径 ───────────────────────── */
export function graphDijkstra(): VizStep[] {
  const steps: VizStep[] = []
  const dist: Record<string, number> = {}
  const used: Record<string, boolean> = {}
  for (const k of KEYS) { dist[k] = Infinity; used[k] = false }
  dist.A = 0
  let settled = 0
  const lbl = (): Record<string, string> => Object.fromEntries(KEYS.map((k) => [k, `${k}:${fmt(dist[k]!)}`]))
  const emit = (description: string, roles: Map<string, VizRole> = new Map(), edgeRoles?: Map<string, VizRole>): void => {
    steps.push({ description, snapshot: { kind: 'graph', nodes: nodes(roles, lbl()), edges: wEdges(edgeRoles), counters: { visited: settled } } })
  }
  const settledRoles = (): Map<string, VizRole> => {
    const r = new Map<string, VizRole>()
    for (const k of KEYS) if (used[k]) r.set(k, 'sorted')
    return r
  }
  emit('带权无向图，用 Dijkstra 求源点 A 到各点的最短路径。结点内数字是 dist[v]（∞=暂不可达）。绿=已确定(并入 S)，橙=本轮选中，蓝=正在松弛')
  for (let iter = 0; iter < KEYS.length; iter += 1) {
    let u = ''
    let best = Infinity
    for (const k of KEYS) if (!used[k] && dist[k]! < best) { best = dist[k]!; u = k }
    if (!u) break
    const rs = settledRoles()
    rs.set(u, 'active')
    emit(`在所有「未确定」的结点里，${u} 的 dist=${fmt(best)} 最小 → 选定它并入 S，认定 A 到 ${u} 的最短距离就是 ${fmt(best)}`, rs)
    // 上面这句要在标记 used 之前用 rs（含 active），下面正式并入
    const rs2 = settledRoles()
    rs2.set(u, 'sorted')
    used[u] = true
    settled += 1
    emit(`正式把 ${u} 标为已确定（绿）。现在用它松弛邻居：看「经过 ${u} 中转」能不能让别点更近`, rs2)
    for (const { to: v, w } of wNeighbors(u)) {
      if (!used[v] && dist[u]! + w < dist[v]!) {
        const old = dist[v]!
        dist[v] = dist[u]! + w
        const rr = settledRoles()
        rr.set(u, 'active')
        rr.set(v, 'compare')
        const er = new Map<string, VizRole>([[ekey(u, v), 'active']])
        emit(`松弛边 ${u}→${v}（权 ${w}）：dist[${u}]+${w}=${dist[u]! + w} < 原 dist[${v}]=${fmt(old)}，更新 dist[${v}]=${dist[v]}`, rr, er)
      }
    }
  }
  const rall = new Map<string, VizRole>()
  for (const k of KEYS) rall.set(k, 'sorted')
  emit(`Dijkstra 结束。A 到各点最短距离：${KEYS.map((k) => `${k}=${fmt(dist[k]!)}`).join('，')}。要点：每轮贪心地确定「当前最近」的结点，再用它松弛邻居，n-1 轮后全部确定`, rall)
  return steps
}

/* ───────────────────────── Prim 最小生成树 ───────────────────────── */
export function graphPrim(): VizStep[] {
  const steps: VizStep[] = []
  const inU: Record<string, boolean> = {}
  const low: Record<string, number> = {}
  const via: Record<string, string | null> = {}
  for (const k of KEYS) { inU[k] = false; low[k] = Infinity; via[k] = null }
  low.A = 0
  const mst = new Set<string>()
  let size = 0
  const lbl = (): Record<string, string> => Object.fromEntries(KEYS.map((k) => [k, inU[k] ? k : `${k}:${fmt(low[k]!)}`]))
  const emit = (description: string, roles: Map<string, VizRole>): void => {
    const edges = WEDGES.map((e) => {
      const eg: GraphEdgeViz = { from: e.from, to: e.to, weight: e.weight }
      if (mst.has(ekey(e.from, e.to))) eg.role = 'sorted'
      return eg
    })
    steps.push({ description, snapshot: { kind: 'graph', nodes: nodes(roles, lbl()), edges, counters: { visited: size } } })
  }
  const uRoles = (): Map<string, VizRole> => {
    const r = new Map<string, VizRole>()
    for (const k of KEYS) if (inU[k]) r.set(k, 'sorted')
    return r
  }
  emit('带权无向图，用 Prim 从 A 出发构造最小生成树（MST）：每轮把「一端已在 U 内、另一端在 U 外」的最小权边并入。绿=已在 U / MST 边，结点内是 lowcost（到 U 的最小边权，∞=还没连上）', new Map([['A', 'active']]))
  for (let iter = 0; iter < KEYS.length; iter += 1) {
    let u = ''
    let best = Infinity
    for (const k of KEYS) if (!inU[k] && low[k]! < best) { best = low[k]!; u = k }
    if (!u) break
    inU[u] = true
    size += 1
    if (via[u]) mst.add(ekey(u, via[u]!))
    const r = uRoles()
    r.set(u, 'active')
    emit(`U 外 lowcost 最小的是 ${u}（=${fmt(best)}），把它并入 U${via[u] ? `，同时把边 ${via[u]}—${u}（权 ${best}）加入 MST` : '（起点 A，无入边）'}。已并入 ${size} 个结点`, r)
    for (const { to: v, w } of wNeighbors(u)) {
      if (!inU[v] && w < low[v]!) { low[v] = w; via[v] = u }
    }
    const frontier = wNeighbors(u).filter(({ to: v }) => !inU[v])
    emit(`用 ${u} 的出边刷新 U 外各点的 lowcost：${frontier.length ? frontier.map(({ to: v }) => `${v}=${fmt(low[v]!)}`).join('，') : '（无 U 外邻居）'}`, uRoles())
  }
  const total = WEDGES.filter((e) => mst.has(ekey(e.from, e.to))).reduce((s, e) => s + e.weight, 0)
  const rall = new Map<string, VizRole>()
  for (const k of KEYS) rall.set(k, 'sorted')
  emit(`Prim 完成：MST 含 ${size} 个结点、${mst.size} 条边（=n-1），总权值=${total}（绿色高亮即 MST 边）。Prim 每轮只加一条最小边，适合稠密图`, rall)
  return steps
}

/* ───────────────────────── Kruskal 最小生成树 ───────────────────────── */
export function graphKruskal(): VizStep[] {
  const steps: VizStep[] = []
  const parent: Record<string, string> = {}
  for (const k of KEYS) parent[k] = k
  const find = (x: string): string => { let r = x; while (parent[r] !== r) r = parent[r]!; return r }
  const sorted = [...WEDGES].sort((a, b) => a.weight - b.weight)
  const taken = new Set<string>()
  const mstNodes = new Set<string>()
  let considered = 0
  let unions = 0
  let count = 0
  const emit = (description: string, cur: { from: string; to: string }, accept: boolean): void => {
    const roles = new Map<string, VizRole>()
    for (const k of mstNodes) roles.set(k, 'sorted')
    roles.set(cur.from, accept ? 'active' : 'compare')
    roles.set(cur.to, accept ? 'active' : 'compare')
    const edgeRoles = new Map<string, VizRole>()
    for (const t of taken) edgeRoles.set(t, 'sorted')
    edgeRoles.set(ekey(cur.from, cur.to), accept ? 'active' : 'swap')
    steps.push({ description, snapshot: { kind: 'graph', nodes: nodes(roles), edges: wEdges(edgeRoles), counters: { comparisons: considered, pointerWrites: unions } } })
  }
  steps.push({ description: 'Kruskal：先把所有边按权值升序排序，再用并查集逐条考察——两端点不在同一棵树（不成环）才收，收了就合并两棵树；收满 n-1 条即停。看边色：绿=已收入 MST，橙=本条正在收，红=被拒（会成环）', snapshot: { kind: 'graph', nodes: nodes(new Map()), edges: wEdges(new Map()), counters: { comparisons: considered, pointerWrites: unions } } })
  for (const e of sorted) {
    considered += 1
    const ru = find(e.from)
    const rv = find(e.to)
    if (ru !== rv) {
      parent[ru] = rv
      unions += 1
      count += 1
      taken.add(ekey(e.from, e.to))
      mstNodes.add(e.from)
      mstNodes.add(e.to)
      emit(`考察 ${e.from}—${e.to}（权 ${e.weight}，第 ${considered} 条）：find(${e.from})=${ru} ≠ find(${e.to})=${rv}，两端不同树、不成环 → 收下并合并（union 共 ${unions} 次，已收 ${count}/${KEYS.length - 1} 条）`, e, true)
    } else {
      emit(`考察 ${e.from}—${e.to}（权 ${e.weight}，第 ${considered} 条）：find 后两端同属一棵树（${ru}==${rv}），收下会成环 → 丢弃`, e, false)
    }
  }
  const total = WEDGES.filter((e) => taken.has(ekey(e.from, e.to))).reduce((s, e) => s + e.weight, 0)
  const rall = new Map<string, VizRole>()
  for (const k of mstNodes) rall.set(k, 'sorted')
  const er = new Map<string, VizRole>()
  for (const t of taken) er.set(t, 'sorted')
  steps.push({ description: `Kruskal 完成：共考察 ${considered} 条边，收下 ${count} 条（=n-1），总权值=${total}，union ${unions} 次。与 Prim 结果一致（同一张图的 MST 权值和唯一）。Kruskal 按边处理、用并查集判环，适合稀疏图`, snapshot: { kind: 'graph', nodes: nodes(rall), edges: wEdges(er), counters: { comparisons: considered, pointerWrites: unions } } })
  return steps
}

/* ───────────────────────── 拓扑排序 ───────────────────────── */
const TOPO_EDGES: GraphEdgeViz[] = [
  { from: 'A', to: 'B', directed: true }, { from: 'A', to: 'C', directed: true },
  { from: 'B', to: 'D', directed: true }, { from: 'C', to: 'D', directed: true },
  { from: 'C', to: 'E', directed: true }, { from: 'D', to: 'F', directed: true },
  { from: 'E', to: 'F', directed: true },
]
const TOPO_OUT: Record<string, string[]> = { A: ['B', 'C'], B: ['D'], C: ['D', 'E'], D: ['F'], E: ['F'], F: [] }
export function graphToposort(): VizStep[] {
  const steps: VizStep[] = []
  const indeg: Record<string, number> = {}
  for (const k of KEYS) indeg[k] = 0
  for (const e of TOPO_EDGES) indeg[e.to] = indeg[e.to]! + 1
  const order: string[] = []
  const emitted = new Set<string>()
  const stack: string[] = []
  const lbl = (): Record<string, string> => Object.fromEntries(KEYS.map((k) => [k, `${k}:${indeg[k]}`]))
  const emit = (description: string, roles: Map<string, VizRole>): void => {
    steps.push({ description, snapshot: { kind: 'graph', nodes: nodes(roles, lbl()), edges: TOPO_EDGES, counters: { visited: order.length } } })
  }
  emit('有向无环图（DAG），结点内数字是当前入度。拓扑排序：反复摘掉入度为 0 的结点并输出，同时把它所有后继的入度减 1。绿=已输出，蓝=在栈待处理，橙=当前。箭头方向=依赖（u→v 表示 u 必须在 v 前）', new Map())
  for (const k of KEYS) if (indeg[k] === 0) stack.push(k)
  emit(`初始扫描：入度为 0 的结点是 ${stack.join('、')}（没有任何前驱，可以最先做），全部入栈。栈：[${stack.join(', ')}]`, new Map(stack.map((k) => [k, 'pivot' as VizRole])))
  while (stack.length > 0) {
    const u = stack.pop()!
    order.push(u)
    emitted.add(u)
    const r = new Map<string, VizRole>()
    for (const k of emitted) r.set(k, 'sorted')
    for (const k of stack) r.set(k, 'pivot')
    r.set(u, 'active')
    emit(`弹出栈顶 ${u} 并输出（拓扑序列：${order.join(' → ')}），随后把 ${u} 的所有后继入度减 1`, new Map(r))
    for (const v of TOPO_OUT[u] ?? []) {
      indeg[v] = indeg[v]! - 1
      if (indeg[v] === 0) {
        stack.push(v)
        const r2 = new Map<string, VizRole>()
        for (const k of emitted) r2.set(k, 'sorted')
        for (const k of stack) r2.set(k, 'pivot')
        r2.set(v, 'compare')
        emit(`${u}→${v}：indeg[${v}] 减到 0（前驱全部输出完），${v} 入栈。栈：[${stack.join(', ')}]`, r2)
      }
    }
  }
  const rall = new Map<string, VizRole>()
  for (const k of emitted) rall.set(k, 'sorted')
  emit(order.length === KEYS.length
    ? `拓扑排序完成：${order.join(' → ')}（输出了全部 ${order.length} 个结点，说明图中无环）。注意同一张 DAG 常有多个合法拓扑序列，取决于入度 0 结点的出栈顺序`
    : `只输出了 ${order.length} 个 < ${KEYS.length} 个结点，说明图中有环，不存在拓扑序列`, rall)
  return steps
}