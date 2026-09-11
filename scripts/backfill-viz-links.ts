/**
 * 任务 2（阶段 7–9）：回填知识卡片 relatedViz 与题目 vizIds，打通「学 ↔ 懂」双向关联。
 *
 * 纪律（任务书硬约束）：
 *   · 只写 card.relatedViz 与 problem.vizIds 两个字段，其余一个字节不动（不碰判分/verified）
 *   · 规则式：章节范围 + 标题/题干关键词 → 演示 id；无真实关联一律保持 []，绝不硬填
 *   · 引用的演示 id 必须真实存在于 public/data/viz/index.json，否则直接抛错
 *   · 幂等：重复运行结果一致
 *
 * 用法：npm run backfill:viz
 * 跑完必须：npm run build:index 重建索引 → npm run verify:data 过 REF-DANGLING 闸门
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const KNOWLEDGE_DIR = join(DATA, 'knowledge')
const PROBLEM_DIR = join(DATA, 'problems')

type Rule = {
  /** 限定分片文件名（章节范围），如 /^c-ch09/；缺省 = 全部分片 */
  file?: RegExp
  /** 匹配文本：卡片 = title + section；题目 = stem + title + section */
  text: RegExp
  viz: string[]
}

/** 知识卡片规则：ds 卡片 26 张逐张对题，c 卡片按章节关键词精确命中 */
const CARD_RULES: Rule[] = [
  // —— ds 第2章 线性表 ——
  { file: /^ds-ch02/, text: /线性表的定义|基本操作/, viz: ['linear-singly-insert', 'linear-singly-delete'] },
  { file: /^ds-ch02/, text: /链式表示|单链表/, viz: ['linear-singly-insert', 'linear-singly-delete'] },
  { file: /^ds-ch02/, text: /循环链表|双向链表|双链表/, viz: ['linear-circular-list', 'linear-doubly-insert-delete'] },
  // —— ds 第3章 栈和队列 ——
  { file: /^ds-ch03/, text: /栈/, viz: ['linear-stack-push-pop'] },
  { file: /^ds-ch03/, text: /队列/, viz: ['linear-queue-enqueue-dequeue'] },
  // —— ds 第4章：数组顺序存储的地址计算 ↔ 内存格演示 ——
  { file: /^ds-ch04/, text: /数组的顺序存储与地址计算/, viz: ['memory-array-layout'] },
  // —— ds 第5章 树 ——
  { file: /^ds-ch05/, text: /遍历/, viz: ['tree-preorder', 'tree-inorder', 'tree-postorder'] },
  { file: /^ds-ch05/, text: /哈夫曼/, viz: ['tree-huffman'] },
  // —— ds 第6章 图 ——
  { file: /^ds-ch06/, text: /DFS|BFS|图的遍历/, viz: ['graph-dfs', 'graph-bfs'] },
  { file: /^ds-ch06/, text: /最小生成树|最短路径|拓扑排序/, viz: ['graph-prim', 'graph-kruskal', 'graph-dijkstra', 'graph-toposort'] },
  // —— ds 第7章 查找：二叉排序树/AVL 的插入删除与旋转演示 ——
  { file: /^ds-ch07/, text: /二叉排序树|平衡二叉树/, viz: ['tree-bst-insert', 'tree-bst-delete', 'tree-avl-rotate'] },
  // —— ds 第8章 排序 ——
  { file: /^ds-ch08/, text: /插入类|直接插入|折半插入|希尔/, viz: ['sort-insertion', 'sort-shell'] },
  { file: /^ds-ch08/, text: /冒泡/, viz: ['sort-bubble'] },
  { file: /^ds-ch08/, text: /快排|快速/, viz: ['sort-quick'] },
  { file: /^ds-ch08/, text: /选择/, viz: ['sort-selection'] },
  { file: /^ds-ch08/, text: /堆/, viz: ['sort-heapsort'] },
  { file: /^ds-ch08/, text: /归并/, viz: ['sort-merge'] },
  { file: /^ds-ch08/, text: /基数/, viz: ['sort-radix'] },
  // —— c 第6章 数组 ——
  { file: /^c-ch06/, text: /内存布局|行主序/, viz: ['memory-array-layout'] },
  { file: /^c-ch06/, text: /数组名与地址/, viz: ['memory-array-layout'] },
  { file: /^c-ch06/, text: /冒泡排序/, viz: ['sort-bubble'] },
  { file: /^c-ch06/, text: /选择排序/, viz: ['sort-selection'] },
  { file: /^c-ch06/, text: /插入排序/, viz: ['sort-insertion'] },
  // —— c 第7章 函数 ——
  { file: /^c-ch07/, text: /值传递/, viz: ['memory-swap-call'] },
  { file: /^c-ch07/, text: /函数调用的三种形式|嵌套调用/, viz: ['memory-call-stack'] },
  { file: /^c-ch07/, text: /递归|栈帧/, viz: ['memory-call-stack'] },
  // —— c 第9章 指针（R5 内存格主战场）——
  { file: /^c-ch09/, text: /^地址、指针变量/, viz: ['memory-pointer-address'] },
  { file: /^c-ch09/, text: /传址调用|返回多个值/, viz: ['memory-swap-call'] },
  { file: /^c-ch09/, text: /数组名与指针|等价访问写法|算术运算与步长|用指针遍历数组/, viz: ['memory-array-layout'] },
  { file: /^c-ch09/, text: /二维数组的地址结构|行指针|越界|尾后指针/, viz: ['memory-array-layout'] },
  { file: /^c-ch09/, text: /二级指针|多级指针/, viz: ['memory-multi-pointer'] },
  { file: /^c-ch09/, text: /malloc|calloc|realloc|内存泄漏|所有权|动态二维数组|野指针/, viz: ['memory-malloc-free'] },
  { file: /^c-ch09/, text: /悬空指针/, viz: ['memory-call-stack', 'memory-malloc-free'] },
  // —— c 第10章 结构体：链表结点与传值/传址 ——
  { file: /^c-ch10/, text: /链表结点的定义/, viz: ['linear-singly-insert', 'memory-malloc-free'] },
  { file: /^c-ch10/, text: /链表的插入/, viz: ['linear-singly-insert'] },
  { file: /^c-ch10/, text: /值传递|指针传递|地址传递/, viz: ['memory-swap-call'] },
  // —— 补充：越界与地址范围、指针类型与混合运算 ——
  { file: /^c-ch06/, text: /下标越界/, viz: ['memory-array-layout'] },
  { file: /^c-ch09/, text: /类型必须匹配|关系运算与合法地址|与整数的混合运算/, viz: ['memory-pointer-address'] },
]

/** 题目规则：只在有真实关联的章节内按题干关键词命中；概念/语法题一律 [] */
const PROBLEM_RULES: Rule[] = [
  // —— 排序题：仅限确有排序程序的章节，ch04 详解顺带提及不硬填 ——
  { file: /^c-ch06/, text: /冒泡/, viz: ['sort-bubble'] },
  { file: /^c-ch06/, text: /选择排序/, viz: ['sort-selection'] },
  { file: /^c-ch06/, text: /插入排序/, viz: ['sort-insertion'] },
  // —— c 第6章 数组：内存布局、存放顺序与地址计算 ——
  { file: /^c-ch06/, text: /内存布局|行主序|列主序|存放顺序|存储顺序|内存.{0,6}存放/, viz: ['memory-array-layout'] },
  { file: /^c-ch06/, text: /地址|偏移|元素个数|所占内存|字节数/, viz: ['memory-array-layout'] },
  // —— c 第7章 函数：传参方式与指针作参数 ——
  { file: /^c-ch07/, text: /值传递|地址传递|传址|swap|交换/, viz: ['memory-swap-call'] },
  { file: /^c-ch07/, text: /指针/, viz: ['memory-swap-call'] },
  // —— 递归与调用栈（不限章节）——
  { text: /递归|栈帧|调用栈/, viz: ['memory-call-stack'] },
  // —— c 第9章 指针 ——
  { file: /^c-ch09/, text: /malloc|calloc|realloc|\bfree\b|动态内存|内存泄漏/, viz: ['memory-malloc-free'] },
  { file: /^c-ch09/, text: /野指针|悬空指针/, viz: ['memory-malloc-free'] },
  { file: /^c-ch09/, text: /二级指针|指针指针|多级指针|\*\*/, viz: ['memory-multi-pointer'] },
  { file: /^c-ch09/, text: /传址|地址传递/, viz: ['memory-swap-call'] },
  { file: /^c-ch09/, text: /数组名|步长/, viz: ['memory-array-layout'] },
  { file: /^c-ch09/, text: /取地址|解引用|指针运算|指向/, viz: ['memory-pointer-address'] },
  // —— c 第10章 结构体与链表 ——
  { file: /^c-ch10/, text: /双向链表|双链表/, viz: ['linear-doubly-insert-delete'] },
  { file: /^c-ch10/, text: /链表/, viz: ['linear-singly-insert'] },
  { file: /^c-ch10/, text: /malloc|calloc|realloc|\bfree\b/, viz: ['memory-malloc-free'] },
  { file: /^c-ch10/, text: /值传递|地址传递|传址/, viz: ['memory-swap-call'] },
  { file: /^ds-ch02/, text: /链表/, viz: ['linear-singly-insert', 'linear-singly-delete'] },
]

function match(rules: Rule[], file: string, text: string): string[] {
  const out: string[] = []
  for (const r of rules) {
    if (r.file && !r.file.test(file)) continue
    if (!r.text.test(text)) continue
    for (const v of r.viz) if (!out.includes(v)) out.push(v)
  }
  return out
}

/** 合法演示 id 全集：规则表打错字在这里当场抓住，不放脏数据进库 */
const vizIndex = JSON.parse(readFileSync(join(DATA, 'viz', 'index.json'), 'utf8')) as { demos: { id: string }[] }
const validIds = new Set(vizIndex.demos.map((d) => d.id))
for (const r of [...CARD_RULES, ...PROBLEM_RULES]) {
  for (const v of r.viz) if (!validIds.has(v)) throw new Error(`规则表引用了不存在的演示 id: ${v}`)
}

const shardFiles = (dir: string): string[] =>
  readdirSync(dir).filter((f) => /^(c|ds)-ch\d+\.json$/.test(f)).sort()

// ———— 1) 知识卡片 relatedViz ————
let cardsTotal = 0
let cardsHit = 0
const cardVizCount = new Map<string, number>()
for (const f of shardFiles(KNOWLEDGE_DIR)) {
  const path = join(KNOWLEDGE_DIR, f)
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { cards: { id: string; title: string; section?: string; relatedViz?: string[] }[] }
  let changed = false
  for (const c of doc.cards) {
    cardsTotal++
    const viz = match(CARD_RULES, f, `${c.title} ${c.section ?? ''}`)
    if (viz.length > 0) {
      cardsHit++
      for (const v of viz) cardVizCount.set(v, (cardVizCount.get(v) ?? 0) + 1)
    }
    const next = viz.join(',')
    const prev = (c.relatedViz ?? []).join(',')
    if (next !== prev) { c.relatedViz = viz; changed = true }
  }
  if (changed) writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', 'utf8')
}

// ———— 2) 题目 vizIds ————
let probsTotal = 0
let probsHit = 0
const probVizCount = new Map<string, number>()
for (const f of shardFiles(PROBLEM_DIR)) {
  const path = join(PROBLEM_DIR, f)
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { problems: Record<string, unknown>[] }
  let changed = false
  for (const p of doc.problems) {
    probsTotal++
    // 匹配文本要带上代码与选项：主力题型的 stem 往往只是「下面程序的运行结果是」，
    // malloc / 递归 / 指针参数这些特征全在 code、blanks、options 里（2026-09-11 实测 77 道指针题仅 1 道 stem 含 malloc）
    const codeText = [p.stem, p.title, p.section, p.code, p.fixed_code, p.explanation, p.solution,
      p.options ? JSON.stringify(p.options) : '', p.blanks ? JSON.stringify(p.blanks) : '']
      .filter((v) => typeof v === 'string' && v.length > 0).join(' ')
    const text = codeText
    const viz = match(PROBLEM_RULES, f, text)
    if (viz.length > 0) {
      probsHit++
      for (const v of viz) probVizCount.set(v, (probVizCount.get(v) ?? 0) + 1)
    }
    const next = viz.join(',')
    const prev = Array.isArray(p.vizIds) ? (p.vizIds as string[]).join(',') : ''
    if (next !== prev) { p.vizIds = viz; changed = true }
  }
  if (changed) writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', 'utf8')
}

const fmt = (m: Map<string, number>): string => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')
console.log(`卡片 ${cardsTotal} 张：${cardsHit} 张回填 relatedViz，${cardsTotal - cardsHit} 张保持 []`)
console.log(`  卡片侧引用分布：${fmt(cardVizCount)}`)
console.log(`题目 ${probsTotal} 道：${probsHit} 道回填 vizIds，${probsTotal - probsHit} 道保持 []`)
console.log(`  题目侧引用分布：${fmt(probVizCount)}`)
console.log('下一步：npm run build:index && npm run verify:data')
