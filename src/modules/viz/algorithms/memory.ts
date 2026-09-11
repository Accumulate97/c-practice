/**
 * R5 内存格渲染器语料 —— 本站差异化优势。
 *
 * 一般数据结构可视化站只画「逻辑结构」（链表、树、图），很少把 C 语言底层的
 * 「物理内存」摊开来看：变量住在哪、里面存了什么、它又指向谁。这五个演示正是
 * 补上这一层，对 C 学习者价值最高：
 *   memoryPointerAddress → 指针与地址（& 与 *、指针运算按类型缩放）
 *   memoryArrayLayout    → 数组连续布局与 a[i] ≡ *(a+i) 的等价关系
 *   memoryCallStack      → 函数调用栈：栈帧随调用/返回压入弹出，局部变量随帧生灭
 *   memoryMultiPointer   → 多级指针链 pp → p → i，每多一个星号多解一层
 *   memoryMallocFree     → malloc/free 与野指针：free 后 p 值不变但已不可用
 *
 * 全部纯函数、产出 VizStep[]，每步都是完整内存快照（深拷贝互不影响）。
 * 这类演示不统计「比较 / 交换」，counterKeys 为空、快照不带 counters。
 * steps[].codeLine 对应 vizCode.ts 里 memory-* 源码的 1-based 行号。
 */
import type { MemoryCell, MemoryRegion, VizRole, VizStep } from '../types'

function cell(key: string, address: string, value: string, role?: VizRole, note?: string): MemoryCell {
  const c: MemoryCell = { key, address, value }
  if (role) c.role = role
  if (note) c.note = note
  return c
}
function region(key: string, title: string, cells: MemoryCell[], note?: string): MemoryRegion {
  const r: MemoryRegion = { key, title, cells }
  if (note) r.note = note
  return r
}
const clone = (cells: MemoryCell[]): MemoryCell[] => cells.map((c) => ({ ...c }))

/* ─────────────────────────── 指针与地址 ─────────────────────────── */
export function memoryPointerAddress(): VizStep[] {
  const steps: VizStep[] = []
  const emit = (cells: MemoryCell[], description: string, codeLine: number): void => {
    steps.push({ description, codeLine, snapshot: { kind: 'memory', regions: [region('mem', '变量与指针', clone(cells))] } })
  }
  emit([cell('i', '0x1000', '42'), cell('p', '0x2000', '随机值', 'idle', '未初始化')],
    'int i = 42 占 4 字节（地址 0x1000）；int *p 自己也是个变量，同样要占内存（0x2000），初始化前内容不可预测', 2)
  emit([cell('i', '0x1000', '42'), cell('p', '0x2000', '→ i', 'active', '存 0x1000')],
    'p = &i：把 i 的地址（0x1000）存进 p，此后 p 指向 i', 4)
  emit([cell('i', '0x1000', '99', 'swap', '被 *p 改'), cell('p', '0x2000', '→ i', 'active')],
    '*p = 99：解引用即「顺着 p 去改 0x1000 上的 i」（42 → 99），改的是所指对象，不是 p 本身', 5)
  emit([cell('i', '0x1000', '99', 'sorted'), cell('p', '0x2000', '→ i', 'active')],
    '此时 printf 读 i 得到 99 —— i 与 *p 是同一块内存的两种叫法', 6)
  emit([cell('i', '0x1000', '99'), cell('p', '0x2000', '→ 0x1004', 'compare', '+4 字节')],
    'p = p + 1：指针加 1 移动 sizeof(int) = 4 字节，p 由指向 0x1000 变为指向 0x1004（不再是 i）', 7)
  emit([cell('i', '0x1000', '99'), cell('p', '0x2000', '→ 0x1004', 'sorted')],
    '小结：指针变量存的是地址；解引用改的是所指对象；指针加减按所指类型的字节数缩放', 8)
  return steps
}

/* ─────────────────────────── 数组内存布局 ─────────────────────────── */
export function memoryArrayLayout(): VizStep[] {
  const steps: VizStep[] = []
  const vals = [10, 20, 30, 40, 50]
  const addr = (i: number): string => '0x' + (0x1000 + i * 4).toString(16)
  const emit = (
    over: Record<number, { value?: string; role?: VizRole }>,
    pval: string, prole: VizRole, pnote: string,
    description: string, codeLine: number,
  ): void => {
    const arr = vals.map((v, i) => {
      const o = over[i]
      return cell('a' + i, addr(i), o?.value ?? String(v), o?.role)
    })
    const regions: MemoryRegion[] = [
      region('arr', 'int a[5] 连续布局', arr, '基址 0x1000，每格 sizeof(int) = 4 字节'),
      region('ptr', '指针变量 p', [cell('p', '0x2000', pval, prole, pnote)]),
    ]
    steps.push({ description, codeLine, snapshot: { kind: 'memory', regions } })
  }
  emit({}, '未定义', 'idle', '尚未赋值',
    'int a[5] = {10,20,30,40,50}：五个 int 从 0x1000 起连续存放，地址 = 基址 + 下标 * 4', 2)
  emit({}, '→ a[0]', 'active', '存 0x1000',
    'int *p = a：数组名退化为首元素地址，p == &a[0] == 0x1000', 3)
  emit({ 2: { role: 'compare' } }, '→ a[0]', 'active', '存 0x1000',
    'a[2] == *(a+2) == p[2] == *(p+2) == 30：四种写法指的是同一格，都是「基址 + 偏移 * sizeof(int)」', 6)
  emit({ 1: { role: 'active' } }, '→ a[1]', 'compare', '存 0x1004',
    'p++：p 后移一个元素，改指 a[1]（地址 0x1004）', 10)
  emit({ 1: { role: 'active' }, 2: { value: '99', role: 'swap' } }, '→ a[1]', 'active', '存 0x1004',
    '*(p + 1) = 99：p 指 a[1]，p+1 即 a[2]，于是被改写的是 a[2]（30 → 99）', 11)
  emit({ 2: { value: '99', role: 'sorted' } }, '→ a[1]', 'sorted', '存 0x1004',
    '小结：数组下标 a[i] 只是指针偏移 *(a+i) 的语法糖；看懂内存布局，指针就不再抽象', 12)
  return steps
}

/* ─────────────────────────── 函数调用栈 ─────────────────────────── */
export function memoryCallStack(): VizStep[] {
  const steps: VizStep[] = []
  interface Frame { cells: MemoryCell[] }
  const frameMain = (): Frame => ({ cells: [
    cell('m', '0x7000', '3', undefined, 'main · 局部变量 m'),
    cell('raM', '0x7004', '← OS', 'idle', 'main · 返回地址'),
  ] })
  const frameF = (): Frame => ({ cells: [
    cell('a', '0x6f00', '3', undefined, 'f · 形参 a'),
    cell('b', '0x6f04', '1', undefined, 'f · 局部变量 b'),
    cell('raF', '0x6f08', '← main', 'idle', 'f · 返回地址'),
  ] })
  const frameG = (): Frame => ({ cells: [
    cell('x', '0x6e00', '3', undefined, 'g · 形参 x'),
    cell('t', '0x6e04', '6', undefined, 'g · 局部变量 t = x*2'),
    cell('raG', '0x6e08', '← f', 'idle', 'g · 返回地址'),
  ] })
  const emit = (bottomToTop: Frame[], description: string, codeLine: number): void => {
    const cells: MemoryCell[] = []
    const top = bottomToTop.length - 1
    bottomToTop.forEach((f, fi) => {
      f.cells.forEach((c, ci) => {
        const isTop = fi === top
        cells.push(cell(c.key, c.address, c.value, isTop && ci === 0 ? 'active' : c.role, c.note + (isTop && ci === 0 ? ' ← 栈顶' : '')))
      })
    })
    if (cells.length === 0) cells.push(cell('_empty', '——', '（栈空）', 'sorted', '所有栈帧均已弹出'))
    cells.reverse()
    steps.push({ description, codeLine, snapshot: { kind: 'memory', regions: [region('stack', '函数调用栈（栈顶在上）', cells, '每帧 = 形参 + 局部变量 + 返回地址；先压后弹')] } })
  }
  emit([frameMain()], '进入 main：压入 main 的栈帧（局部变量 m = 3 加返回地址），这是栈的最底层', 12)
  emit([frameMain(), frameF()], 'main 调用 f(m = 3)：f 的栈帧压在 main 之上（形参 a = 3、局部 b = 1、返回地址指回 main）', 13)
  emit([frameMain(), frameF(), frameG()], 'f 内调用 g(a = 3)：再压一层 g 的栈帧（形参 x = 3、局部 t = x*2 = 6），此刻栈深三层', 8)
  emit([frameMain(), frameF()], 'g 返回 t = 6：g 的栈帧随即弹出，x、t 随帧销毁，栈回落两层', 3)
  emit([frameMain()], 'f 算完 a + b + g(a) = 3 + 1 + 6 = 10 后返回：f 的栈帧弹出，形参 a、局部 b 被释放', 8)
  emit([], 'main 返回退出：最后一层 main 栈帧也弹出 —— 局部变量随栈帧生灭，这正是「函数调用栈」的运行机制', 13)
  return steps
}

/* ─────────────────────────── 多级指针 ─────────────────────────── */
export function memoryMultiPointer(): VizStep[] {
  const steps: VizStep[] = []
  const emit = (
    iv: string, irole: VizRole | undefined,
    pv: string, prole: VizRole | undefined,
    ppv: string, pprole: VizRole | undefined,
    description: string, codeLine: number,
  ): void => {
    const cells = [
      cell('i', '0x1000', iv, irole, 'int'),
      cell('p', '0x2000', pv, prole, 'int * · 存 i 的地址'),
      cell('pp', '0x3000', ppv, pprole, 'int ** · 存 p 的地址'),
    ]
    steps.push({ description, codeLine, snapshot: { kind: 'memory', regions: [region('mem', '三级指针链 pp → p → i', cells)] } })
  }
  emit('7', undefined, '→ i', 'active', '→ p', 'active',
    'int i = 7（0x1000）；int *p = &i（0x2000 存 0x1000）；int **pp = &p（0x3000 存 0x2000），构成 pp → p → i 三级链', 4)
  emit('7', undefined, '→ i', 'swap', '→ p', 'active',
    '*pp = &i：解一层 pp 得到的就是 p 本身，这句改写 p 里存的内容（仍指向 i）', 6)
  emit('8', 'swap', '→ i', 'active', '→ p', 'active',
    '**pp = 8：连续解两层，pp → p → i，最终改的是 i 本身（7 → 8）', 7)
  emit('9', 'swap', '→ i', 'active', '→ p', 'active',
    '***(&pp) = 9：&pp 先取到 pp 的地址，再连解三层，依旧落到 i（8 → 9），等价于 i = 9', 8)
  emit('9', 'sorted', '→ i', 'sorted', '→ p', 'sorted',
    '小结：每多一个星号就多解一层引用；无论几级指针，最终都顺着地址链找到 i', 9)
  return steps
}

/* ─────────────────────────── malloc/free 与野指针 ─────────────────────────── */
export function memoryMallocFree(): VizStep[] {
  const steps: VizStep[] = []
  const emit = (pval: string, prole: VizRole, pnote: string, blk: MemoryCell, description: string, codeLine: number): void => {
    const regions: MemoryRegion[] = [
      region('stack', '栈（指针变量）', [cell('p', '0x7000', pval, prole, pnote)]),
      region('heap', '堆（动态分配）', [blk]),
    ]
    steps.push({ description, codeLine, snapshot: { kind: 'memory', regions } })
  }
  emit('→ 0x5000', 'active', '存堆块首地址', cell('blk', '0x5000', '?', 'active', 'malloc 刚分配，未初始化'),
    'int *p = malloc(sizeof(int))：在堆上申请 4 字节（假设首地址 0x5000），返回的地址存进栈上的指针 p', 4)
  emit('→ 0x5000', 'active', 'p != NULL，分配成功', cell('blk', '0x5000', '?', 'active', 'malloc 刚分配，未初始化'),
    'if (p == NULL) return 1：申请后必须判空，p 非空才能继续用；对空指针解引用会让程序崩溃', 5)
  emit('→ 0x5000', 'active', 'p 有效', cell('blk', '0x5000', '42', 'swap', '被 *p 写入'),
    '*p = 42：p 有效时解引用，把 42 写进那块堆内存', 6)
  emit('→ 0x5000', 'compare', '值没变但已失效', cell('blk', '0x5000', '已释放', 'idle', '归还给堆'),
    'free(p)：把这块堆内存还给系统。注意 p 的值没变（仍存 0x5000），但这块内存已不属于你 —— p 成了「野指针」', 8)
  emit('→ 0x5000', 'swap', '野指针', cell('blk', '0x5000', '已释放', 'swap', '未定义行为'),
    '若此时再 *p = 7：访问已释放内存是未定义行为 —— 这块内存可能已被重新分配，读写会悄悄破坏别的数据', 9)
  emit('NULL', 'sorted', '置空', cell('blk', '0x5000', '已释放', 'idle', '归还给堆'),
    'p = NULL：free 后立刻把指针置空是好习惯；之后误用会因解引用空指针当场崩溃，把问题暴露出来而不是悄悄写坏内存', 11)
  emit('NULL', 'sorted', 'free(NULL) 安全', cell('blk', '0x5000', '已释放', 'idle', '归还给堆'),
    'free(p)：p 为 NULL 时 free(NULL) 是合法的空操作，不会二次释放报错', 12)
  return steps
}