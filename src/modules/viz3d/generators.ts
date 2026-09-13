/**
 * 3D 可视化馆专属语料生成器（任务 2）。
 *
 * 为什么只有 4 条：3D 馆 38 个演示里 34 个直接复用 2D 馆语料（见 catalog.ts），
 * 只有这 4 个是「2D 表达不出来、必须靠第三个维度才讲得清」的差异化内容 ——
 * 野指针的形成、内存泄漏的累积、递归栈帧的堆叠回退、二维下标到一维地址的映射。
 *
 * 三条纪律与 scripts/gen-viz.ts 完全一致：
 *   1. 纯函数，不 import React / three / DOM，Node 侧可经 Vite SSR 直接调用；
 *   2. 每步是**完整状态快照**，后退只靠下标回退，绝不写逆运算；
 *   3. 无时间戳，同版本 + 同输入 = 字节相同的语料（可复现，禁手改）。
 *
 * 所有 snapshot.kind 一律是既有的 'memory' —— 不新增快照类型、不改 schema，
 * 这是 AGENTS.md「不改 schema」硬约束下唯一可行的做法。3D 场景的差异
 * 由 catalog.ts 的 scene 字段指定，不由语料指定。
 */
import type { MemoryCell, MemoryRegion, MemorySnapshot, VizRole, VizStep } from '../viz/types'

/* ------------------------------------------------------------------ *
 * 小工具：少写样板，同时保证 role / note 为空时不落进 JSON
 * ------------------------------------------------------------------ */
function cell(key: string, address: string, value: string, role?: VizRole, note?: string): MemoryCell {
  return { key, address, value, ...(role ? { role } : {}), ...(note ? { note } : {}) }
}
function region(key: string, title: string, cells: MemoryCell[], note?: string): MemoryRegion {
  return { key, title, cells, ...(note ? { note } : {}) }
}
function step(
  description: string,
  regions: MemoryRegion[],
  counters?: Record<string, number>,
  codeLine?: number,
): VizStep {
  const snapshot: MemorySnapshot = { kind: 'memory', regions, ...(counters ? { counters } : {}) }
  return { description, ...(codeLine ? { codeLine } : {}), snapshot }
}

/**
 * 栈区地址刻意取高位（0x7ff…）、堆区取低位（0x90…）：
 * 与真实 x86-64 Linux 进程的布局方向一致，学生从 3D 沙盘上看到的相对位置
 * 不会因为「画得好看」而跟 gdb 里对不上。
 */
const STACK_ADDR = '0x7ff0'

/* ================================================================== *
 * 1. 野指针（悬空指针）是怎么形成的
 * ================================================================== */
const WILD_CODE = `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *p;              /* 1. 只定义未初始化：此刻已经是野指针 */
    p = malloc(sizeof(int));
    *p = 42;             /* 2. 合法写入 */
    free(p);             /* 3. 归还内存，但 p 本身没被改 */
    *p = 99;             /* 4. 对已释放内存写 —— 未定义行为 */
    p = NULL;            /* 5. 唯一正确的补救 */
    return 0;
}
`

function wildPointer(): VizStep[] {
  const emptyHeap = (): MemoryRegion[] => [
    region('stack', '栈区（自动变量）', [cell('p', STACK_ADDR, '（不确定）', 'idle', '未初始化：栈上遗留的垃圾值')], 'p 是局部指针变量，随 main 的栈帧而生'),
    region('heap', '堆区（malloc 申请）', [], '还没有任何堆块'),
  ]
  const withBlock = (
    pValue: string, pRole: VizRole, pNote: string,
    blkValue: string, blkRole: VizRole, blkNote: string,
  ): MemoryRegion[] => [
    region('stack', '栈区（自动变量）', [cell('p', STACK_ADDR, pValue, pRole, pNote)]),
    region('heap', '堆区（malloc 申请）', [cell('blk', '0x9000', blkValue, blkRole, blkNote)]),
  ]
  return [
    step('定义 int *p 但没赋值。此刻 p 里装的是栈上遗留的垃圾值 —— 它已经是一个野指针了。野指针不是「坏掉的指针」，而是「指向不确定内存的指针」。', emptyHeap(), undefined, 5),
    step('malloc(sizeof(int)) 在堆区切出 4 个字节，返回首地址 0x9000 存进 p。从这一刻起 p 才真正可用：栈区的 p 与堆区的块之间出现了一条唯一的连线。', withBlock('→ 0x9000', 'active', '存的是堆块首地址', '（未写入）', 'active', '刚分配，内容是脏的'), { pointerWrites: 1 }, 6),
    step('*p = 42：解引用写入。顺着 p 里的地址找到堆块，把 42 放进去。这是完全合法的访问 —— 合法的判据不是「p 非空」，而是「p 指向的内存仍归你所有」。', withBlock('→ 0x9000', 'active', '存的是堆块首地址', '42', 'compare', '由 *p 写入'), { pointerWrites: 2 }, 7),
    step('free(p) 只把这 4 个字节归还给分配器，**它不会把 p 改成 NULL**。看 3D 沙盘：堆块变了色（不再归你），但栈区 p 里的 0x9000 一个比特都没动。', withBlock('→ 0x9000', 'swap', 'free 不修改 p 本身', '42', 'swap', '已归还分配器，随时可能被下一次 malloc 分走'), { pointerWrites: 2 }, 8),
    step('这就是悬空指针诞生的瞬间：内存所有权已经交回，p 却仍指向它。危险不在于「现在会不会崩」，而在于分配器随时可能把 0x9000 交给别人，届时你的写入会静默毁掉别人的数据。', withBlock('→ 0x9000', 'swap', '悬空：指向已释放内存', '42', 'swap', '逻辑上不可用，物理上仍可被 p 触及'), { pointerWrites: 2 }, 8),
    step('*p = 99 —— 对已释放内存写入，标准里叫未定义行为。实测可能安然无事、可能段错误、也可能改掉随后 malloc 到的那块数据。第三种最致命：崩溃点离犯错点十万八千里。', withBlock('→ 0x9000', 'swap', '悬空：指向已释放内存', '99 ← 越界写', 'swap', '未定义行为'), { pointerWrites: 3 }, 9),
    step('补救只有一行：free 之后立刻 p = NULL。此后若再误写 *p，程序会当场崩在错误的那一行（空指针解引用），而不是悄悄烂在别处。把「静默破坏」换成「立即定位」，这就是置空的全部价值。', withBlock('NULL', 'sorted', '正确姿势：free 后立即置空', '99', 'idle', '已与 p 无关'), { pointerWrites: 4 }, 10),
  ]
}

/* ================================================================== *
 * 2. 内存泄漏是怎么形成的
 * ================================================================== */
const LEAK_CODE = `#include <stdlib.h>

int main(void) {
    for (int i = 0; i < 4; i++) {
        int *p = malloc(sizeof(int) * 4);  /* 每轮申请 16 字节 */
        p[0] = i;                          /* 用完之后...... */
    }                                      /* p 出了作用域，从未 free */
    /* 四块堆内存的入口永久丢失：内存泄漏 */
    return 0;
}
`

function leak(): VizStep[] {
  const BLOCK = 16
  const steps: VizStep[] = []
  /** 已泄漏（不可达）的块：一旦进去就出不来，每步都原样重画 —— 快照是完整状态 */
  const leaked: MemoryCell[] = []
  steps.push(step(
    '循环还没开始，堆区是空的。注意接下来要发生的事：p 定义在循环体内部，所以**每一轮都是一个全新的 p**，上一轮的 p 连同它记着的地址一起消失。',
    [region('stack', '栈区（循环体内的 p）', [], 'p 的作用域仅限循环体'), region('heap', '堆区（malloc 申请）', [], '空闲')],
    { leakedBlocks: 0, bytesLost: 0 }, 4,
  ))
  for (let i = 0; i < 4; i += 1) {
    const addr = '0x' + (0x9000 + i * BLOCK).toString(16)
    const live = [...leaked, cell('b' + i, addr, '（未写入）', 'active', '第 ' + (i + 1) + ' 次 malloc，16 字节')]
    steps.push(step(
      `第 ${i + 1} 轮：int *p = malloc(16) 得到 ${addr}。此刻它是有主的 —— 唯一的入口就是栈区这个 p。`,
      [region('stack', '栈区（循环体内的 p）', [cell('p', STACK_ADDR, '→ ' + addr, 'active', '本轮的 p，作用域即将结束')]),
       region('heap', '堆区（malloc 申请）', live, leaked.length > 0 ? '红色块已不可达' : undefined)],
      { leakedBlocks: leaked.length, bytesLost: leaked.length * BLOCK }, 5,
    ))
    const used = [...leaked, cell('b' + i, addr, String(i), 'compare', 'p[0] = ' + i)]
    steps.push(step(
      `p[0] = ${i}：正常写入。到目前为止一切合法，内存也在你手上。`,
      [region('stack', '栈区（循环体内的 p）', [cell('p', STACK_ADDR, '→ ' + addr, 'compare', '仍指向 ' + addr)]),
       region('heap', '堆区（malloc 申请）', used, leaked.length > 0 ? '红色块已不可达' : undefined)],
      { leakedBlocks: leaked.length, bytesLost: leaked.length * BLOCK }, 6,
    ))
    leaked.push(cell('b' + i, addr, String(i), 'swap', '入口已丢失 → 不可达（泄漏）'))
    steps.push(step(
      `循环体结束，p 随作用域销毁。堆区那 16 字节还在占用，但**再没有任何指针指向它**，free 也无从下手 —— 这就是泄漏。已累计泄漏 ${leaked.length} 块 / ${leaked.length * BLOCK} 字节。`,
      [region('stack', '栈区（循环体内的 p）', [], 'p 已销毁，栈区空了'),
       region('heap', '堆区（malloc 申请）', leaked, '红色 = 不可达，进程结束前一直被占着')],
      { leakedBlocks: leaked.length, bytesLost: leaked.length * BLOCK }, 7,
    ))
  }
  steps.push(step(
    '终局：64 字节堆内存被永久占用且不可回收。单次泄漏无感，但把这段放进循环一万次的服务里，就是内存曲线一路上扬直到 OOM。修法：free(p) 写在循环体内、p 出作用域之前；或者干脆别让唯一入口是局部变量。',
    [region('stack', '栈区（循环体内的 p）', [], 'main 仍在运行，但已无任何指针指向那四块'),
     region('heap', '堆区（malloc 申请）', leaked, '4 块全部不可达')],
    { leakedBlocks: leaked.length, bytesLost: leaked.length * BLOCK }, 9,
  ))
  return steps
}

/* ================================================================== *
 * 3. 递归调用栈：层层堆叠与回退
 * ================================================================== */
const REC_CODE = `#include <stdio.h>

long fact(int n) {
    if (n <= 1) return 1;       /* 递归出口 */
    return n * fact(n - 1);     /* 先递归下去，回来再乘 */
}

int main(void) {
    printf("%ld\\n", fact(5));
    return 0;
}
`

interface Frame {
  name: string
  n: number
  ret: string
  role: VizRole
  addr: number
}
function frameRegions(frames: Frame[]): MemoryRegion[] {
  // regions[0] = 栈底（main）。CallStack3D 按数组顺序自下而上堆叠
  return frames.map((f) => region(
    f.name.replace(/\W/g, ''),
    f.name,
    [
      cell(f.name + '-n', '0x' + f.addr.toString(16), String(f.n), f.role, '形参 n'),
      cell(f.name + '-r', '0x' + (f.addr + 8).toString(16), f.ret, f.role === 'active' ? 'compare' : f.role, '返回值'),
      cell(f.name + '-a', '0x' + (f.addr + 12).toString(16), f.name === 'main' ? '← OS' : '← 上层', 'idle', '返回地址'),
    ],
    f.role === 'active' ? '当前正在执行的栈帧（栈顶）' : undefined,
  ))
}
function recursion(): VizStep[] {
  const steps: VizStep[] = []
  const main: Frame = { name: 'main', n: 0, ret: '—', role: 'idle', addr: 0x7000 }
  const live: Frame[] = [{ ...main, role: 'active' }]
  steps.push(step(
    'main 的栈帧先落地：形参、局部变量、返回地址。此刻栈深 1，栈顶就是 main。',
    frameRegions(live), { stackDepth: 1 }, 8,
  ))
  steps.push(step(
    'main 调用 fact(5)：为 fact(5) 压入一个新栈帧，装好形参 n=5，返回地址指向 main 里 printf 那一行。注意 fact(5) 此刻**还算不出返回值** —— 它得先等 fact(4)。',
    frameRegions([...live, { name: 'fact(5)', n: 5, ret: '待定', role: 'active', addr: 0x6f00 }]), { stackDepth: 2 }, 9,
  ))
  live.push({ name: 'fact(5)', n: 5, ret: '待定', role: 'idle', addr: 0x6f00 })
  for (let n = 4; n >= 2; n -= 1) {
    const addr = 0x6f00 - (5 - n) * 0x20
    steps.push(step(
      `fact(${n + 1}) 执行 return ${n + 1} * fact(${n})：于是 fact(${n}) 的栈帧被压上来，栈深变成 ${live.length + 1}。每一层都卡在「等下一层返回」，所以返回值一路都是「待定」。`,
      frameRegions([...live, { name: `fact(${n})`, n, ret: '待定', role: 'active', addr }]), { stackDepth: live.length + 1 }, 5,
    ))
    live.push({ name: `fact(${n})`, n, ret: '待定', role: 'idle', addr })
  }
  steps.push(step(
    'fact(2) 又调用 fact(1)。栈深 6，这是本次递归的最深处 —— 再深就要担心栈溢出了（每层栈帧都吃真实的栈空间，这正是「递归深度不能无限制」的物理原因）。',
    frameRegions([...live, { name: 'fact(1)', n: 1, ret: '待定', role: 'active', addr: 0x6e80 }]), { stackDepth: live.length + 1 }, 5,
  ))
  live.push({ name: 'fact(1)', n: 1, ret: '待定', role: 'active', addr: 0x6e80 })
  steps.push(step(
    '命中递归出口：n <= 1 成立，fact(1) 直接 return 1，不再往下调用。整个递归在这里触底。',
    frameRegions(live.map((f, i) => (i === live.length - 1 ? { ...f, ret: '1', role: 'sorted' as VizRole } : f))), { stackDepth: live.length }, 4,
  ))
  // 回退阶段：逐层弹出并算出返回值
  const values: Record<number, number> = { 1: 1 }
  for (let n = 2; n <= 5; n += 1) {
    values[n] = n * (values[n - 1] ?? 1)
    const popped = live.filter((f) => f.name !== `fact(${n - 1})`)
    const top = popped.map((f) => (f.name === `fact(${n})` ? { ...f, ret: String(values[n]), role: 'sorted' as VizRole } : f))
    steps.push(step(
      `fact(${n - 1}) 返回 ${values[n - 1]}，它的栈帧被弹出销毁，栈深回到 ${top.length}。fact(${n}) 这才拿到操作数，算出 ${n} × ${values[n - 1]} = ${values[n]} 并随之返回。递归的「回」阶段就是这样一层层退的。`,
      frameRegions(top), { stackDepth: top.length }, 5,
    ))
    live.length = 0
    live.push(...top.map((f) => ({ ...f, role: f.name === 'main' ? 'idle' as VizRole : 'idle' as VizRole })))
  }
  steps.push(step(
    'fact(5) 返回 120，main 拿到结果打印。栈又只剩 main 一层 —— 压栈 5 次、弹栈 5 次，完全对称。这也解释了为什么递归函数的时间/空间开销要按「最大栈深」算，而不是按调用次数算。',
    frameRegions([{ ...main, role: 'active', ret: '120' }]), { stackDepth: 1 }, 8,
  ))
  return steps
}

/* ================================================================== *
 * 4. 二维数组的内存立方体：下标 → 地址
 * ================================================================== */
const MATRIX_CODE = `#include <stdio.h>

int main(void) {
    int a[3][3] = { {1, 2, 3}, {4, 5, 6}, {7, 8, 9} };
    /* 行优先：a[i][j] 的地址 = 基址 + (i * 3 + j) * sizeof(int) */
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++)
            printf("a[%d][%d]=%d addr=%p\\n", i, j, a[i][j], (void *)&a[i][j]);
    return 0;
}
`

const MATRIX_BASE = 0x1000
function matrixCells(active: string | null): MemoryCell[] {
  const cells: MemoryCell[] = []
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const linear = i * 3 + j
      const key = `a${i}${j}`
      cells.push(cell(
        key,
        '0x' + (MATRIX_BASE + linear * 4).toString(16),
        String(linear + 1),
        active === null ? 'idle' : active === key ? 'active' : 'sorted',
        active === key ? `线性序号 ${linear} = i*3+j = ${i}*3+${j}` : undefined,
      ))
    }
  }
  return cells
}
function matrixCube(): VizStep[] {
  const steps: VizStep[] = [
    step(
      'int a[3][3] 在内存里根本不是「3×3 的方块」，而是**连续的 9 个 int**。C 语言按行优先把它们一字排开：先 a[0][0..2]，再 a[1][0..2]，最后 a[2][0..2]。3D 视图里上层是逻辑二维网格，下层是物理一维内存。',
      [region('matrix', 'int a[3][3] —— 逻辑二维 / 物理一维', matrixCells(null), '基址 0x1000，每格 sizeof(int) = 4 字节，共 36 字节连续')],
      { visited: 0 }, 4,
    ),
  ]
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const linear = i * 3 + j
      steps.push(step(
        `a[${i}][${j}] = ${linear + 1}，地址 = 0x${(MATRIX_BASE + linear * 4).toString(16)}。套公式：基址 0x1000 + (i×列数 + j) × 4 = 0x1000 + (${i}×3 + ${j}) × 4。线性序号 ${linear}，正好是上层网格与下层内存条的对应位置。`,
        [region('matrix', 'int a[3][3] —— 逻辑二维 / 物理一维', matrixCells(`a${i}${j}`), '行优先存储，遍历顺序 = 地址递增顺序')],
        { visited: linear + 1 }, 8,
      ))
    }
  }
  steps.push(step(
    '结论：这个公式解释了三件事 —— ① 为什么二维数组传参可以退化成 int (*p)[3] 甚至 int *；② 为什么按列遍历（外层 j、内层 i）会跳着访问内存，缓存命中率骤降；③ 为什么 a[i][j] 与 a[j][i] 地址不同，转置必须真的搬数据。',
    [region('matrix', 'int a[3][3] —— 逻辑二维 / 物理一维', matrixCells(null), 'addr(i,j) = base + (i*cols + j)*sizeof(elem)')],
    { visited: 9 }, 5,
  ))
  return steps
}

/* ================================================================== *
 * 规格表：scripts/gen-viz3d.ts 按此逐条生成 + 校验 + 落盘
 * ================================================================== */
export interface Viz3DSpec {
  id: string
  title: string
  category: string
  chapter: string
  /** 全部是 memory 快照 —— 不新增 kind，不动 schema */
  renderer: 'memory'
  algorithm: string
  counterKeys: string[]
  code: string
  n?: number
  /** 关联题目：生成器按 chapter + 标题关键字在题目索引里挑，保证 relatedProblems 永不悬空 */
  related: { chapter: string; keywords: string[]; max: number }
  generate: () => VizStep[]
}

export const VIZ3D_SPECS: Viz3DSpec[] = [
  {
    id: 'mem3d-wild-pointer',
    title: '野指针的形成（3D 内存沙盘）',
    category: 'memory',
    chapter: '第9章 指针',
    renderer: 'memory',
    algorithm: 'wildPointer',
    counterKeys: ['pointerWrites'],
    code: WILD_CODE,
    n: 2,
    related: { chapter: '第9章 指针', keywords: ['野指针', '悬空', 'free', 'malloc'], max: 3 },
    generate: wildPointer,
  },
  {
    id: 'mem3d-leak',
    title: '内存泄漏的形成（3D 内存沙盘）',
    category: 'memory',
    chapter: '第9章 指针',
    renderer: 'memory',
    algorithm: 'leak',
    counterKeys: ['bytesLost', 'leakedBlocks'],
    code: LEAK_CODE,
    n: 4,
    related: { chapter: '第9章 指针', keywords: ['malloc', 'free', '内存'], max: 3 },
    generate: leak,
  },
  {
    id: 'mem3d-recursion',
    title: '递归调用栈的堆叠与回退（3D）',
    category: 'memory',
    chapter: '第7章 函数',
    renderer: 'memory',
    algorithm: 'recursion',
    counterKeys: ['stackDepth'],
    code: REC_CODE,
    n: 6,
    related: { chapter: '第7章 函数', keywords: ['递归', '函数调用'], max: 3 },
    generate: recursion,
  },
  {
    id: 'mem3d-matrix-cube',
    title: '二维数组的内存立方体（3D）',
    category: 'memory',
    chapter: '第6章 数组',
    renderer: 'memory',
    algorithm: 'matrixCube',
    counterKeys: ['visited'],
    code: MATRIX_CODE,
    n: 9,
    related: { chapter: '第6章 数组', keywords: ['二维数组', '地址', '行'], max: 3 },
    generate: matrixCube,
  },
]
