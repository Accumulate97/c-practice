/**
 * 程序填空（code_completion）判分层（阶段 4 模块 3）。
 *
 * 职责边界（与既有判分层严格分工，一行规则都不重写）：
 *   本文件只管三件事 —— ① 解析空位标记 ② 把学生填写拼回模板 ③ 文本层面的等价匹配与差异。
 *   「拼装后的程序到底对不对」由实机执行裁定：归一化/逐行比对/firstDiffLine 走
 *   src/judge/backends/base.ts，事实分类与 didExecute 断言走 backends/godbolt.ts，
 *   串行/节流/缓存/看门狗/降级走 grading/stdin-run.ts 的 runStdinTests。
 *
 * 为什么文本匹配不能当最终结论（2026-09-09 立项时用户点名的坑 1）：
 *   等价写法必须连同上下文一起编译验证。三个真实反例：
 *     · c-ch06-cc-002 空位 3 的上下文是 if(【3】==0)，填 i%3 正确，填 i%3==0 会变成
 *       ((i%3==0)==0) —— 语义翻转，字符串层面看"更像答案"却是错的；
 *     · c-ch06-cc-001 空位 3 的上下文后面没有分号，填 printf("\n") 缺分号直接语法错；
 *     · c-ch06-cc-004 空位 2 的上下文是 for(【2】i++)，填 i=16;i<=31 缺末尾分号语法错。
 *   所以本文件的 matchBlank 只产出「与参考写法是否一致」的提示，最终 verdict 一律来自实机运行；
 *   两者不一致时以实机为准（学生写出参考解之外的正确等价写法 → 判通过并说明）。
 *
 * 拼装为什么必须空格包裹（坑 2，上轮真实缺陷）：
 *   c-ch04-cc-006 空位 3 的上下文是 else 后紧跟标记再跟分号，把标记直接删掉再贴答案会得到
 *   elselen=28 → 编译失败。assembleCompletion 一律用 " " + 答案 + " " 包裹，从根上杜绝词法粘连；
 *   代价是拼装结果里空位两侧各多一个空格，对 C 词法无任何影响（空白即分隔符）。
 */
import type { ProblemRecord } from '../data/loader'

/** 与 schema/Problem.schema.json 的 code_completion.blanks 同构 */
export interface BlankSpec {
  index: number
  answer: string
  accepted: string[]
  hint?: string
}

/** 空位标记在模板里的字节区间（end 不含），index 为标记里写的编号 */
export interface SlotMark {
  index: number
  start: number
  end: number
}

/** 学生对各空位的填写，键为 blank.index */
export type BlankValues = Record<number, string>

// 空位标记正则的唯一真源。
// 数据里**实际**写法是「斜杠 + 一星 + 两下划线 + BLANK_n + 两下划线 + 一星 + 斜杠」，
// 即 /*__BLANK_n__*/ —— 2026-09-09 全库扫描确认：20 道 code_completion 题、47 处标记，
// 形态只此一种，且每题标记数恒等于 blanks.length（脚本 tmp/scan-markers.mjs 复核）。
// schema 的 code 描述、authoring-verify.ts、convert-to-schema.mjs 与本文件第 388 行的
// 缺陷文案用的都是这个单星形态。星号数放开到 {1,3} 以同时容忍任务书里的 /***BLANK_1***/
// 历史写法；此前写死 {2,3} 会让全部 20 道题的 blankSlots() 返回空数组、completionTarget()
// 一律判 blocking，模块 3 整条链路直接哑掉（本轮实测发现并修正）。
// 每次调用返回新实例：带 g 标志的正则有 lastIndex 状态，共享实例会在多次扫描时漏匹配。
export function blankMarkerRe(): RegExp {
  return /\/\*{1,3}(?:_+)?BLANK_(\d+)(?:_+)?\*{1,3}\//g
}

/** 按文档顺序取出全部空位标记 */
export function blankSlots(template: string): SlotMark[] {
  const out: SlotMark[] = []
  const re = blankMarkerRe()
  let m: RegExpExecArray | null = re.exec(template)
  while (m !== null) {
    const index = Number.parseInt(m[1] ?? '', 10)
    if (Number.isFinite(index)) out.push({ index, start: m.index, end: m.index + m[0].length })
    m = re.exec(template)
  }
  return out
}

/**
 * 把学生填写拼回模板，得到可编译的完整 C 源码。
 * 空格包裹见文件头「坑 2」。未填写的空位按空串处理（渲染器会在提交前拦住，
 * 这里不做二次判断，保证纯函数可单测）。
 */
export function assembleCompletion(template: string, values: BlankValues): string {
  return template.replace(blankMarkerRe(), (marker: string, num: string): string => {
    const index = Number.parseInt(num ?? '', 10)
    if (!Number.isFinite(index)) return marker
    const raw = values[index]
    const text = typeof raw === 'string' ? raw : ''
    return ' ' + text + ' '
  })
}

/* ------------------------------------------------------------------ *
 * 文本归一化：只吸收「空白」这一类无意义差异，其余一律逐字符比
 * ------------------------------------------------------------------ */

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

/**
 * 重写字符串/字符字面量**之外**的空白。
 * 字面量内部必须原样保留：printf("%d %d") 与 printf("%d%d") 是两份不同的输出，
 * 若把引号里的空格一起吃掉，就会把真正的答案差异判成等价。
 */
function rewriteOutsideLiterals(text: string, drop: boolean): string {
  const out: string[] = []
  let i = 0
  let pendingSpace = false
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (ch === '"' || ch === "'") {
      if (pendingSpace && !drop) out.push(' ')
      pendingSpace = false
      const quote = ch
      out.push(quote)
      i += 1
      while (i < text.length) {
        const c = text[i] ?? ''
        out.push(c)
        i += 1
        // 反斜杠转义：下一个字符原样吞掉，\" 不能当成字面量结束
        if (c === '\\' && i < text.length) {
          out.push(text[i] ?? '')
          i += 1
          continue
        }
        if (c === quote) break
      }
      continue
    }
    if (isSpace(ch)) {
      pendingSpace = true
      i += 1
      continue
    }
    if (pendingSpace) {
      if (!drop) out.push(' ')
      pendingSpace = false
    }
    out.push(ch)
    i += 1
  }
  return out.join('')
}

/**
 * 空位归一化：CRLF→LF、剥首尾空白、把词法空白折叠成单个空格。
 * 这是「精确匹配」用的口径 —— 教材里 i%4==0 与 i % 4 == 0 是同一个答案。
 */
export function normalizeBlank(text: string): string {
  return rewriteOutsideLiterals(text.replace(/\r\n?/g, '\n').trim(), false)
}

/** 更紧的口径：字面量之外的空白全部删掉，用于识别「只差空白」的写法 */
export function squeezeBlank(text: string): string {
  return rewriteOutsideLiterals(text.replace(/\r\n?/g, '\n').trim(), true)
}

/* ------------------------------------------------------------------ *
 * 三级匹配：精确 answer → accepted 等价写法 → 不匹配（给差异）
 * ------------------------------------------------------------------ */

export type BlankMatchKind =
  /** 与 blanks[].answer 一致（折叠空白后逐字符相同） */
  | 'exact'
  /** 与 blanks[].accepted 里的某个等价写法一致 */
  | 'accepted'
  /** 都不一致 —— 注意这只是文本层面的提示，最终结论看实机运行 */
  | 'mismatch'
  /** 空位没填（mismatch 的前置状态，单独一类以便 UI 拦提交） */
  | 'empty'

export interface BlankDiff {
  /** 归一化后的学生填写 */
  given: string
  /** 最接近的参考写法（answer 与 accepted 里编辑距离最小者） */
  closest: string
  closestFrom: 'answer' | 'accepted'
  /** 编辑距离；候选过长时不做 DP，回落到 answer 并置 null */
  distance: number | null
  /** 1 起；与 closest 逐列比对的首个不同位置，完全前缀关系时为较短串长度 + 1 */
  firstDiffColumn: number | null
  /** 人类可读的差异提示（分号 / 多余片段 / 列号） */
  hint: string
}

export interface BlankMatch {
  index: number
  kind: BlankMatchKind
  /** 原样填写（未归一化），UI 显示用 */
  givenRaw: string
  /** 归一化后的填写 */
  given: string
  expected: string
  accepted: string[]
  /** kind === 'accepted' 时命中的那个等价写法 */
  matchedVariant: string | null
  /** true = 只在 squeezeBlank 口径下才相等，即差异纯为空白 */
  whitespaceOnly: boolean
  hint?: string
  diff: BlankDiff | null
}

/** 编辑距离上限：空位答案都很短（现存最长 34 字符），超长则不值得做 O(n*m) */
const MAX_DP_LEN = 240

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = cur
  }
  return prev[b.length] ?? 0
}

function firstDiffColumn(a: string, b: string): number | null {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i + 1
  return a.length === b.length ? null : n + 1
}

function diffHint(given: string, closest: string, column: number | null): string {
  const gSemi = given.endsWith(';')
  const cSemi = closest.endsWith(';')
  if (gSemi && !cSemi && given.slice(0, -1).trim() === closest.trim()) {
    return '你多写了一个末尾分号。本空位的上下文里分号是否必需取决于模板（模板已带分号时多写无害，未带时会变成空语句或缺分号），最终以实机编译为准。'
  }
  if (!gSemi && cSemi && closest.slice(0, -1).trim() === given.trim()) {
    return '你少写了一个末尾分号。若模板在该空位后没有分号（如 c-ch06-cc-001 空位 3），缺分号会直接编译失败。'
  }
  if (closest.length > 0 && given.includes(closest)) {
    return '你的写法包含了参考写法，但多出了「' + given.replace(closest, '').trim() + '」'
  }
  if (given.length > 0 && closest.includes(given)) {
    return '你的写法是参考写法的一部分，少了「' + closest.replace(given, '').trim() + '」'
  }
  return column === null ? '与参考写法一致' : '从第 ' + String(column) + ' 列起与最接近的参考写法不同'
}

/** 单个空位的三级匹配 */
export function matchBlank(givenRaw: string, blank: BlankSpec): BlankMatch {
  const given = normalizeBlank(givenRaw)
  const expected = normalizeBlank(blank.answer)
  const accepted = blank.accepted.map(normalizeBlank).filter((s) => s.length > 0)
  const base = {
    index: blank.index,
    givenRaw,
    given,
    expected,
    accepted,
    hint: blank.hint,
  }
  if (given.length === 0) {
    return { ...base, kind: 'empty', matchedVariant: null, whitespaceOnly: false, diff: null }
  }

  // 一级：与 answer 相同；二级：与 accepted 中某个相同。都先按 normalizeBlank 口径比。
  const candidates: Array<{ text: string; kind: 'exact' | 'accepted'; from: 'answer' | 'accepted' }> = [
    { text: expected, kind: 'exact', from: 'answer' },
    ...accepted.map((text) => ({ text, kind: 'accepted' as const, from: 'accepted' as const })),
  ]
  for (const c of candidates) {
    if (c.text.length > 0 && given === c.text) {
      return { ...base, kind: c.kind, matchedVariant: c.kind === 'accepted' ? c.text : null, whitespaceOnly: false, diff: null }
    }
  }
  // 再退一步：字面量之外空白全删后相同 → 仍是同一个答案，只是排版不同
  const givenSqueezed = squeezeBlank(given)
  if (givenSqueezed.length > 0) {
    for (const c of candidates) {
      if (c.text.length > 0 && givenSqueezed === squeezeBlank(c.text)) {
        return {
          ...base,
          kind: c.kind,
          matchedVariant: c.kind === 'accepted' ? c.text : null,
          whitespaceOnly: true,
          diff: null,
        }
      }
    }
  }

  // 三级：不匹配 → 找出最接近的参考写法并给出差异
  let closest = expected
  let closestFrom: 'answer' | 'accepted' = 'answer'
  let distance: number | null = null
  const tooLong = candidates.some((c) => c.text.length > MAX_DP_LEN) || given.length > MAX_DP_LEN
  if (!tooLong) {
    let best = Number.POSITIVE_INFINITY
    for (const c of candidates) {
      if (c.text.length === 0) continue
      const d = levenshtein(given, c.text)
      if (d < best) {
        best = d
        closest = c.text
        closestFrom = c.from
        distance = d
      }
    }
  }
  const column = firstDiffColumn(given, closest)
  return {
    ...base,
    kind: 'mismatch',
    matchedVariant: null,
    whitespaceOnly: false,
    diff: { given, closest, closestFrom, distance, firstDiffColumn: column, hint: diffHint(given, closest, column) },
  }
}

export interface BlankGrade {
  perBlank: BlankMatch[]
  /** 空位总数 */
  total: number
  filled: number
  emptyIndexes: number[]
  exactCount: number
  acceptedCount: number
  mismatchCount: number
  /** 所有空位都在文本层面命中（exact 或 accepted） */
  allMatched: boolean
  /** 至少有一个空位没填 —— 提交前必须拦住，否则拼装出的程序必然编译失败 */
  allFilled: boolean
}

/** 整题的空位匹配汇总。纯函数、离线，不发任何网络请求 */
export function gradeBlanks(values: BlankValues, blanks: BlankSpec[]): BlankGrade {
  const perBlank = blanks.map((b) => matchBlank(typeof values[b.index] === 'string' ? (values[b.index] as string) : '', b))
  const exactCount = perBlank.filter((m) => m.kind === 'exact').length
  const acceptedCount = perBlank.filter((m) => m.kind === 'accepted').length
  const mismatchCount = perBlank.filter((m) => m.kind === 'mismatch').length
  const emptyIndexes = perBlank.filter((m) => m.kind === 'empty').map((m) => m.index)
  return {
    perBlank,
    total: perBlank.length,
    filled: perBlank.length - emptyIndexes.length,
    emptyIndexes,
    exactCount,
    acceptedCount,
    mismatchCount,
    allMatched: exactCount + acceptedCount === perBlank.length && perBlank.length > 0,
    allFilled: emptyIndexes.length === 0 && perBlank.length > 0,
  }
}

/* ------------------------------------------------------------------ *
 * 题目 → 可作答目标（数据缺陷要在 UI 里如实说出来，绝不静默降级）
 * ------------------------------------------------------------------ */

export interface CompletionTarget {
  /** 含空位标记的原始代码 */
  template: string
  slots: SlotMark[]
  blanks: BlankSpec[]
  /** 题库给的测试用例组数；0 = 只能做本地文本比对，无法实机判分 */
  caseCount: number
  /** 预存的完整参考代码（solution），仅用于「参考答案与拼装结果对照」的自查展示 */
  solution: string
  /** 非 null = 根本无法作答/判分，UI 显示缺陷面板并禁用提交 */
  blocking: string | null
  /** 非致命缺陷（如个别空位缺 answer），UI 提示但仍可作答 */
  warnings: string[]
}

function toBlankSpecs(raw: unknown): BlankSpec[] {
  if (!Array.isArray(raw)) return []
  const out: BlankSpec[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.index !== 'number') continue
    const accepted = Array.isArray(rec.accepted) ? rec.accepted.filter((s): s is string => typeof s === 'string') : []
    out.push({
      index: rec.index,
      answer: typeof rec.answer === 'string' ? rec.answer : '',
      accepted,
      hint: typeof rec.hint === 'string' && rec.hint.length > 0 ? rec.hint : undefined,
    })
  }
  return out.sort((a, b) => a.index - b.index)
}

export function completionTarget(problem: ProblemRecord): CompletionTarget {
  const template = typeof problem.code === 'string' ? problem.code : ''
  const blanks = toBlankSpecs(problem.blanks)
  const caseCount = Array.isArray(problem.testCases) ? problem.testCases.length : 0
  const solution = typeof problem.solution === 'string' ? problem.solution : ''
  const warnings: string[] = []

  if (template.trim().length === 0) {
    return { template, slots: [], blanks, caseCount, solution, blocking: '本题 code 字段为空，没有可作答的程序（数据缺陷）', warnings }
  }
  const slots = blankSlots(template)
  if (slots.length === 0) {
    return { template, slots, blanks, caseCount, solution, blocking: '代码里找不到空位标记 /*__BLANK_n__*/，无法定位作答位置（数据缺陷）', warnings }
  }
  if (blanks.length === 0) {
    return { template, slots, blanks, caseCount, solution, blocking: '本题 blanks 字段为空，没有预存答案可比对（数据缺陷）', warnings }
  }

  // 三向一致：标记数量、标记编号、blanks 声明必须完全对得上，否则拼装会张冠李戴
  const slotIndexes = slots.map((s) => s.index)
  const declared = blanks.map((b) => b.index)
  const dupSlot = slotIndexes.find((v, i) => slotIndexes.indexOf(v) !== i)
  if (dupSlot !== undefined) {
    return { template, slots, blanks, caseCount, solution, blocking: '代码里空位编号 ' + String(dupSlot) + ' 重复出现，无法确定该填哪个（数据缺陷）', warnings }
  }
  const missingMark = declared.filter((d) => !slotIndexes.includes(d))
  const extraMark = slotIndexes.filter((s) => !declared.includes(s))
  if (missingMark.length > 0 || extraMark.length > 0) {
    const parts: string[] = []
    if (missingMark.length > 0) parts.push('blanks 声明了代码里没有的编号 ' + missingMark.join('、'))
    if (extraMark.length > 0) parts.push('代码里的编号 ' + extraMark.join('、') + ' 在 blanks 里没有答案')
    return { template, slots, blanks, caseCount, solution, blocking: '空位标记与 blanks 声明不一致：' + parts.join('；') + '（数据缺陷）', warnings }
  }
  for (const b of blanks) {
    if (b.answer.trim().length === 0) warnings.push('空位 ' + String(b.index) + ' 没有预存 answer，该空位无法做文本比对（只能靠实机运行判分）')
  }
  if (caseCount === 0) warnings.push('本题没有 testCases，无法实机判分，只能做本地文本比对（不计正确率）')
  if (solution.trim().length === 0) warnings.push('本题缺 solution 字段（不影响作答，judge:verify 需要它做实机取证）')

  return { template, slots, blanks, caseCount, solution, blocking: null, warnings }
}

/** 未填写的空位编号，UI 用它把提交按钮拦住并逐一点名 */
export function missingBlankIndexes(values: BlankValues, blanks: BlankSpec[]): number[] {
  return blanks
    .filter((b) => normalizeBlank(typeof values[b.index] === 'string' ? (values[b.index] as string) : '').length === 0)
    .map((b) => b.index)
}
