/**
 * 概念题（不编译、不联网）的文本归一化与比对（阶段 5）。
 *
 * ── 为什么单独一层，而不是复用 judge/backends/base.ts 的 normalizeOutput ────────
 * base.ts 服务的是**程序 stdout**：逐行剥行尾空白、剥末尾换行，此外一个字符都不能差
 * （%2d 与 %5d 的输出差一个空格就是另一份答案）。概念题比的是**人写的一个词**：
 * 「编译」与「编译。」、「int」与「 INT 」、「O(n^2)」与「o (n²)」在阅卷人眼里是同一个答案。
 * 两套口径混用会互相伤害：把 stdout 的严格规则套到概念题上，学生因为多打一个句号就被判错；
 * 把概念题的宽松规则套到 stdout 上，等于放宽代码题判分（AGENTS.md 二·7 明令禁止）。
 * 所以这里独立一份，且只被七个概念题渲染器 import，代码题的判分路径一行都不碰。
 *
 * ── 三条不会破例的规矩 ─────────────────────────────────────────────────
 *   1. 期望值为空 = 数据缺陷，一律 false：绝不用空串当期望，否则学生交白卷会被判「通过」
 *      （与 grading/exact.ts 对 code_reading 空 answer 的处置同源）；
 *   2. 归一化只做**无损的等价变形**（Unicode 兼容分解、折叠空白、剥首尾标点、大小写不敏感），
 *      不做同义词猜测 —— 猜同义词就是替数据补答案，猜错的代价由学生承担；
 *   3. accepted 是数据里显式给出的可接受答案，与 answer 同权；数据没给就不放宽。
 */

/** 首尾可剥的标点：学生常把「编译。」当答案交上来，句号不属于答案本身 */
const TRIM_PUNCT = '。，、；：！？…·．,.:;!?～~"\'“”‘’「」『』'

/** NFKC 漏网的上标字符（² ³ 已被 NFKC 转成 2 3，ⁿ 这类不会） */
const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n',
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

/**
 * 概念题文本归一化：NFKC → 折叠空白 → 剥首尾标点 → 小写。
 * 全角「ｉｎｔ　」与半角「INT」在这里变成同一个串。
 */
export function normalizeConceptText(input: unknown): string {
  let text = asText(input).normalize('NFKC').replace(/\s+/g, ' ').trim()
  let changed = true
  while (changed) {
    changed = false
    const first = text.charAt(0)
    if (first.length > 0 && TRIM_PUNCT.includes(first)) {
      text = text.slice(1).trim()
      changed = true
    }
    const last = text.charAt(text.length - 1)
    if (last.length > 0 && TRIM_PUNCT.includes(last)) {
      text = text.slice(0, -1).trim()
      changed = true
    }
  }
  return text.toLowerCase()
}

/** 概念填空 / 匹配题的比对：与 answer 或 accepted 中任一项等价即算对 */
export function conceptMatches(input: unknown, expected: unknown, accepted?: unknown): boolean {
  const want = normalizeConceptText(expected)
  if (want.length === 0) return false
  const got = normalizeConceptText(input)
  if (got.length === 0) return false
  if (got === want) return true
  if (!Array.isArray(accepted)) return false
  return accepted.some((alt) => {
    const a = normalizeConceptText(alt)
    return a.length > 0 && a === got
  })
}

/**
 * 复杂度表达式归一化：O(n^2) / o (n²) / O(n**2) / O(n2) 视为同一个答案。
 * 做法是「去掉记号只留骨架」：删空白、删 * 与 ^、上标转数字、小写。
 * 于是 n*log n 与 n log n 与 nlogn 同形，n^2 与 n2 同形；
 * 但 O(n) 与 O(n^2) 仍然不同形（n ≠ n2），不会把不同的复杂度判成一个。
 */
export function normalizeComplexity(input: unknown): string {
  let text = asText(input).normalize('NFKC')
  text = [...text].map((ch) => SUPERSCRIPTS[ch] ?? ch).join('')
  return text.toLowerCase().replace(/[\s*^]/g, '')
}

/** 剥掉 O( … ) 外壳：允许学生只写「n^2」而不写「O(n^2)」 */
function unwrap(norm: string): string {
  const m = /^o\((.*)\)$/.exec(norm)
  return m !== null && m[1] !== undefined ? m[1] : norm
}

function complexityEquivalent(a: string, b: string): boolean {
  return a === b || unwrap(a) === unwrap(b)
}

/** 复杂度题的比对：answer 与 accepted 同权，带/不带 O() 外壳都算对 */
export function complexityMatches(input: unknown, expected: unknown, accepted?: unknown): boolean {
  const want = normalizeComplexity(expected)
  if (want.length === 0) return false
  const got = normalizeComplexity(input)
  if (got.length === 0) return false
  if (complexityEquivalent(got, want)) return true
  if (!Array.isArray(accepted)) return false
  return accepted.some((alt) => {
    const a = normalizeComplexity(alt)
    return a.length > 0 && complexityEquivalent(got, a)
  })
}

/**
 * 确定性打乱（匹配题右侧选项 / 排序题的初始顺序都要用）。
 * 不能用 Math.random：React 每次重渲染都会得到新顺序，学生会看见选项自己跳来跳去。
 * 种子取题目 id，所以同一道题在任何机器上打开都是同一个顺序。
 */
export function seededOrder(seed: string, length: number): number[] {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const order = Array.from({ length }, (_, i) => i)
  // Fisher–Yates，随机源是上面那个 FNV-1a 哈希推进的 LCG
  for (let i = length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0
    const j = h % (i + 1)
    const tmp = order[i] ?? 0
    order[i] = order[j] ?? 0
    order[j] = tmp
  }
  return order
}
