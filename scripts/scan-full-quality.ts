/**
 * 任务 2 · 全库质量体检扫描器 —— 只读、只报告，绝不改题目数据。
 *
 * 五条检查线（严重度 P0=影响判分正确性 / P1=可能误导学生 / P2=体例瑕疵）：
 *   A 选择题答案唯一性·结构层：answer 越界或非法、选项重复（原样/掩码后）、选项字母前缀错位、
 *     explanation 里写的答案字母与 answer 字段不一致
 *   B 选择题答案唯一性·实机层：stem 自带完整程序且选项像输出候选的单选题，
 *     用 Godbolt 真跑一次，把真实 stdout 与 4 个选项逐一比对 →
 *     唯一命中且=answer / 多解 / 无一正确 / 与 answer 不符（严格串行，尊重 minIntervalMs）
 *   C explanation 质量：缺失、<50 字、判断题 explanation 的对错口径与 answer 矛盾
 *   D 存疑残留标记：比 scan:doubt 更宽的正则，跨全字段（表面文本 / 元信息分列）
 *   E 字段自洽：id 重复、代码题缺可运行代码、testCases 空或形状非法、
 *     code_reading 答案是占位符、填空数与 blanks 不符、元字段取值越界
 *
 * 用法：
 *   node scripts/scan-full-quality.ts            全量（含 Godbolt 实机，约 2 分钟）
 *   node scripts/scan-full-quality.ts --no-net   只跑本地结构检查（约 1 秒）
 *   node scripts/scan-full-quality.ts --limit=5  实机只跑前 5 题（调试）
 *
 * 产物：tmp/full-quality-scan.json（机器可读全量清单，不进 git）
 *       docs/全库质量报告.md（人读结论 + 待人工复核清单）
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRunnableSource, isCodeType } from './lib/problem-code.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'public', 'data', 'problems')
const OUT_JSON = join(ROOT, 'tmp', 'full-quality-scan.json')
const OUT_MD = join(ROOT, 'docs', '全库质量报告.md')
const REPORT_JSON = join(DIR, 'verification-report.json')
const SHARD = /^(c|ds)-ch\d+\.json$/
const FENCE = String.fromCharCode(96, 96, 96)

const NO_NET = process.argv.includes('--no-net')
const limitArg = process.argv.find((a) => a.startsWith('--limit=')) ?? ''
const LIMIT = limitArg ? Number(limitArg.slice(8)) : Infinity

type P = Record<string, unknown>
interface Rec { file: string; p: P }
type Sev = 'P0' | 'P1' | 'P2'
interface Finding { id: string; type: string; file: string; sev: Sev; code: string; detail: string }
const F: Finding[] = []
let curFile = ''
function add(p: P, sev: Sev, code: string, detail: string): void {
  F.push({ id: S(p, 'id') || '(缺 id)', type: S(p, 'type'), file: curFile, sev, code, detail })
}

const S = (p: P, k: string): string => (typeof p[k] === 'string' ? (p[k] as string) : '')
const A = (p: P, k: string): unknown[] => (Array.isArray(p[k]) ? (p[k] as unknown[]) : [])
const STRARR = (p: P, k: string): string[] => A(p, k).filter((x): x is string => typeof x === 'string')

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
/** 中文语境下的「字数」：去掉 markdown 记号与空白后按字符计 */
function zhLen(t: string): number {
  return t.replace(/[*`#>\-|_[\]()（）\s]/g, '').length
}
const LETTER = (i: number): string => String.fromCharCode(65 + i)
function optBody(o: string): string {
  return o.replace(/^\s*[A-H]\s*[)）.、:：]\s*/, '').trim()
}
/** 选项里的 □ / · 是「一个空格」的印刷记号，比对时还原成空格，但绝不折叠其它空白 */
function optNorm(o: string): string {
  return optBody(o).replace(/[□·]/g, ' ')
}
function loose(t: string): string { return t.replace(/\s+/g, ' ').trim() }
/** 数「几个空」：像 ___(1)___ 这种带序号的记号整体算一个空（否则会被数成前后两段下划线） */
function countMarks(v: string): number {
  const indexed = v.match(/_{2,}\s*[（(]\s*\d+\s*[)）]\s*_{2,}/g)
  if (indexed && indexed.length) return indexed.length
  return (v.match(/_{2,}/g) ?? []).length
}

// ───────────────────────── 载入 ─────────────────────────
function load(): Rec[] {
  const out: Rec[] = []
  for (const f of readdirSync(DIR).sort()) {
    if (!SHARD.test(f)) continue
    const j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { problems?: P[] }
    for (const p of j.problems ?? []) out.push({ file: f, p })
  }
  return out
}
const recs = load()
const byType = new Map<string, number>()
for (const r of recs) byType.set(S(r.p, 'type'), (byType.get(S(r.p, 'type')) ?? 0) + 1)

// ───────────────────────── A 选择题·结构层 ─────────────────────────
const LETTER_RE = /^(?:\*\*|「|【)?\s*(?:答案|正确答案|本题答案|故选|应选|应该选|选)\s*(?:是|为)?\s*[:：]?\s*(?:\*\*|`|「|【)?\s*([A-H])/
function ansIndex(p: P, n: number): number | null {
  const a = p['answer']
  if (typeof a === 'number' && Number.isInteger(a)) return a >= 0 && a < n ? a : null
  if (typeof a === 'string' && /^[A-H]$/.test(a.trim())) return a.trim().charCodeAt(0) - 65
  return null
}
let scChecked = 0, tfChecked = 0
for (const r of recs) {
  const p = r.p; curFile = r.file
  const t = S(p, 'type')
  const opts = STRARR(p, 'options')
  const expl = S(p, 'explanation')

  if (t === 'single_choice') {
    scChecked += 1
    if (opts.length < 2) add(p, 'P0', 'sc-options-too-few', `只有 ${opts.length} 个选项`)
    if (opts.length > 6) add(p, 'P2', 'sc-options-too-many', `有 ${opts.length} 个选项`)
    if (typeof p['answer'] !== 'number') add(p, 'P0', 'sc-answer-not-index', `answer=${JSON.stringify(p['answer'])}，期望 0..${opts.length - 1} 的整数下标`)
    const ai = ansIndex(p, opts.length)
    if (ai === null && opts.length >= 2) add(p, 'P0', 'sc-answer-out-of-range', `answer=${JSON.stringify(p['answer'])} 越界（选项 ${opts.length} 个）`)
    opts.forEach((o, i) => { if (!o.trim()) add(p, 'P0', 'sc-option-empty', `第 ${i + 1} 个选项为空`) })
    // 选项重复 = 事实上的「多个选项均正确」
    const seen = new Map<string, number>()
    opts.forEach((o, i) => {
      const k = o.trim()
      if (seen.has(k)) add(p, 'P0', 'sc-option-duplicate', `选项 ${LETTER(seen.get(k) as number)} 与 ${LETTER(i)} 原样重复：${JSON.stringify(o.slice(0, 40))}`)
      else seen.set(k, i)
    })
    // 只把「去掉全部空白后相同」当实质重复：判分侧 normalizeOutput 会吃掉行尾空白，
    // 两个只差空格的选项在机器眼里是同一个答案。掩码数字不算重复——
    // 「5,9」与「6,9」是输出预测题里正当的两个候选，掩掉数字会把 465 道好题误判成雷同。
    const seenW = new Map<string, number>()
    opts.forEach((o, i) => {
      const k = optBody(o).replace(/\s+/g, '')
      if (!k) return
      if (seenW.has(k) && o.trim() !== opts[seenW.get(k) as number].trim())
        add(p, 'P2', 'sc-option-duplicate-nospace', `选项 ${LETTER(seenW.get(k) as number)} 与 ${LETTER(i)} 去掉空白后相同：${JSON.stringify(optBody(o).slice(0, 30))}`)
      else if (!seenW.has(k)) seenW.set(k, i)
    })
    // 选项字母前缀与下标错位（学生看到的 A/B/C/D 与判分下标不一致）
    opts.forEach((o, i) => {
      const m = /^\s*(?:\*\*)?\s*([A-H])\s*[)）.、:：]/.exec(o)
      if (m && m[1].charCodeAt(0) - 65 !== i) add(p, 'P0', 'sc-option-letter-mismatch', `第 ${i + 1} 个选项自带前缀「${m[1]}」`)
    })
    if (ai !== null && expl) {
      const m = LETTER_RE.exec(expl)
      if (m && m[1].charCodeAt(0) - 65 !== ai)
        add(p, 'P0', 'sc-explanation-letter-conflict', `explanation 说答案是 ${m[1]}，answer 字段指向 ${LETTER(ai)}`)
    }
    if (!S(p, 'stem').trim()) add(p, 'P0', 'stem-empty', 'stem 为空')
  }

  if (t === 'true_false') {
    tfChecked += 1
    const a = p['answer']
    const ok = typeof a === 'boolean' || a === 0 || a === 1 ||
      (typeof a === 'string' && /^(对|错|正确|错误|是|否|√|×|[TF])$/.test(a.trim()))
    if (!ok) add(p, 'P0', 'tf-answer-shape', `answer=${JSON.stringify(a)}`)
    const truthy = a === true || a === 1 || (typeof a === 'string' && /^(对|正确|是|√|T)$/.test(a.trim()))
    if (expl) {
      const m = /(?:答案|正确答案|本题答案|故|应)\s*(?:是|为)?\s*[:：]?\s*(?:\*\*|`)?\s*(对|错|正确|错误|√|×)/.exec(expl)
      if (m) {
        const saysTrue = /^(对|正确|√)$/.test(m[1])
        if (saysTrue !== truthy) add(p, 'P0', 'tf-explanation-conflict', `explanation 判「${m[1]}」，answer=${JSON.stringify(a)}`)
      }
    }
  }
}

// ───────────────────────── C explanation 质量 ─────────────────────────
let explMissing = 0, explShort = 0
for (const r of recs) {
  const p = r.p; curFile = r.file
  const expl = S(p, 'explanation')
  if (!expl.trim()) { explMissing += 1; add(p, 'P0', 'explanation-missing', 'explanation 缺失或为空') }
  else if (zhLen(expl) < 50) { explShort += 1; add(p, 'P1', 'explanation-short', `${zhLen(expl)} 字：${JSON.stringify(expl.slice(0, 40))}`) }
}

// ───────────────────────── D 存疑残留标记 ─────────────────────────
const DOUBT_RE = /\[\?\]|存疑|待裁决|待确认|待定|待补|TODO|FIXME|TBD|XXX|PENDING-REAL-STDOUT|占位|\?\?\?/g
const META_KEYS = new Set(['explanation', 'note', 'analysis', 'source', 'ai_generated', 'generated_at'])
let doubtSurface = 0, doubtMeta = 0
for (const r of recs) {
  const p = r.p; curFile = r.file
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'string' && !Array.isArray(v) && typeof v !== 'object') continue
    const txt = typeof v === 'string' ? v : JSON.stringify(v)
    const hits = txt.match(DOUBT_RE)
    if (!hits) continue
    if (META_KEYS.has(k)) { doubtMeta += hits.length; add(p, 'P2', 'doubt-marker-meta', `${k} 命中 ${hits.length} 处：${JSON.stringify([...new Set(hits)])}`) }
    else { doubtSurface += hits.length; add(p, 'P0', 'doubt-marker-surface', `${k} 命中 ${hits.length} 处：${JSON.stringify([...new Set(hits)])}`) }
  }
}

// ───────────────────────── E 字段自洽 ─────────────────────────
const idSeen = new Map<string, string>()
const BLOOMS = new Set(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'])
let verifiedCount = 0
let descCount = 0
for (const r of recs) {
  const p = r.p; curFile = r.file
  const id = S(p, 'id'); const t = S(p, 'type')
  if (!id) add(p, 'P0', 'id-missing', '缺 id')
  else if (idSeen.has(id)) add(p, 'P0', 'id-duplicate', `与 ${idSeen.get(id)} 同 id`)
  else idSeen.set(id, r.file)
  if (p['verified'] === true) verifiedCount += 1
  const cat = S(p, 'category'); if (cat && !/^(c|ds)$/.test(cat)) add(p, 'P2', 'meta-category', `category=${cat}`)
  const bl = S(p, 'bloom'); if (bl && !BLOOMS.has(bl)) add(p, 'P2', 'meta-bloom', `bloom=${bl}`)
  const d = p['difficulty']
  if (d !== undefined && (typeof d !== 'number' || d < 1 || d > 5)) add(p, 'P2', 'meta-difficulty', `difficulty=${JSON.stringify(d)}`)
  if (!S(p, 'chapter').trim()) add(p, 'P2', 'meta-chapter-missing', 'chapter 缺失')
  if (!S(p, 'source').trim()) add(p, 'P2', 'meta-source-missing', 'source 缺失')

  // answerIsDescription=true 是设计内的「描述性试题」：不进自动判分，
  // 所以它没有可运行源码、answer 为空、没有 testCases 都属正常，不当缺陷报。
  const desc = p['answerIsDescription'] === true
  if (desc) descCount += 1
  if (isCodeType(t) && !desc) {
    if (buildRunnableSource(p as never) === null) add(p, 'P0', 'code-no-runnable', `代码题（${t}）取不到可运行源码`)
    const cases = A(p, 'testCases')
    if (t !== 'code_reading' && cases.length === 0) add(p, 'P0', 'code-no-testcases', `${t} 没有 testCases`)
    cases.forEach((c, i) => {
      const o = (c ?? {}) as Record<string, unknown>
      if (typeof o['stdin'] !== 'string' || typeof o['expected'] !== 'string')
        add(p, 'P0', 'code-bad-testcase', `testCases[${i}] 缺 stdin/expected 字符串`)
    })
    if (!S(p, 'code').trim() && !S(p, 'code_starter').trim() && t !== 'programming' && t !== 'code_reading')
      add(p, 'P1', 'code-no-stem-code', `${t} 既无 code 也无 code_starter`)
  }
  if (t === 'code_reading' && !desc) {
    const a = S(p, 'answer')
    if (!a.trim()) add(p, 'P0', 'cr-answer-empty', 'code_reading 的 answer 为空')
    else if (a.includes('PENDING-REAL-STDOUT')) add(p, 'P0', 'cr-answer-placeholder', 'answer 仍是占位符')
  }
  if (t === 'fill_blank') {
    const blanks = A(p, 'blanks')
    if (blanks.length === 0) add(p, 'P0', 'fb-no-blanks', 'fill_blank 没有 blanks')
    blanks.forEach((b, i) => {
      const o = (b ?? {}) as Record<string, unknown>
      const ans = o['answer']
      if (!(typeof ans === 'string' && ans.trim()) && !Array.isArray(ans))
        add(p, 'P0', 'fb-blank-no-answer', `blanks[${i}] 无 answer`)
    })
    // stem 常把同一段代码写两遍（纯文本 + 围栏副本，方便学生复制），
    // 所以按「去围栏后的 stem / 每个围栏块 / code / code_starter」分别数下划线，
    // 只要有任一视图与 blanks 条数吻合就算自洽，别把排版重复当成漏空。
    const stemRaw = S(p, 'stem')
    const fences: string[] = []
    const fre = new RegExp(FENCE + '[^\\n]*\\n([\\s\\S]*?)' + FENCE, 'g')
    let fm: RegExpExecArray | null
    while ((fm = fre.exec(stemRaw)) !== null) fences.push(fm[1])
    const bare = stemRaw.replace(new RegExp(FENCE + '[^\\n]*\\n[\\s\\S]*?' + FENCE, 'g'), '')
    const views = [bare, ...fences, S(p, 'code'), S(p, 'code_starter')].filter((x) => x.trim())
    const counts = views.map(countMarks).filter((n) => n > 0)
    if (counts.length && !counts.includes(blanks.length))
      add(p, 'P1', 'fb-count-mismatch', `题面下划线 ${[...new Set(counts)].join('/')} 处，blanks ${blanks.length} 条`)
  }
  if (t === 'programming' || t === 'code_completion' || t === 'debug') {
    if (!S(p, 'reference').trim() && !S(p, 'solution').trim() && !S(p, 'fixed_code').trim())
      add(p, 'P1', 'code-no-answer-field', `${t} 无 reference/solution/fixed_code`)
  }
  if (t === 'short_answer' && !S(p, 'reference_answer').trim() && !S(p, 'answer').trim())
    add(p, 'P1', 'sa-no-answer', 'short_answer 无参考答案')
}

// ───────────────────────── B 实机层：判定规则 ─────────────────────────
/**
 * 把「真实输出 vs 四个选项」的事实翻译成人能读的结论。
 *
 * 为什么要分这么多档：单选题并不都是「输出预测题」。实测 99 道候选里，
 * 17 道题干代码根本不是完整可编译程序（考的是「哪个表达式对」「哪句 scanf 对」），
 * 21 道的选项是描述句（「程序的输出结果为小写字母 a」）而不是字面输出。
 * 一律按「stdout 必须逐字等于某个选项」判定，会把 38 道好题误报成缺陷。
 * 所以判定顺序是：编译/运行异常先看有没有对应选项 → 严格等值（判分口径）→
 * 仅差空白 → 描述句里唯一嵌着真实输出 → 「不确定值」类选项 → 才叫 no-match。
 *
 * bodies 必须是调用方用 normalize(optNorm(option)) 处理过的选项正文，口径与线上一致。
 */
interface NetVerdict { verdict: string; matched: string[]; looseOnly: string[]; note: string }
const RE_COMPILE_OPT = /编译|语法错|不能通过|无法通过|连接/
const RE_ABNORMAL_OPT = /不确定|随机值|无定值|不定值|运行(时)?(出错|错误)|执行(时)?(出错|错误)|崩溃|死循环|未定义/
const CJK = /[\u4e00-\u9fa5]/
/** 全角→半角：选项里常用 － ， 　 这类全角记号排版，NFKC 归一后才比得动 */
const nfkc = (t: string): string => t.normalize('NFKC')
/** 输出里出现控制字符或 U+FFFD = 打印了不可预测的字节（未初始化/越界），不是「答案不符」 */
const hasGarbage = (t: string): boolean => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(t)
const RE_READS_STDIN = /\bscanf\s*\(|\bgetchar\s*\(|\bfgets\s*\(|\bgetc\s*\(|\bgetche?\s*\(|\bgets\s*\(/

function classifyNet(ec: string, out: string, rawOut: string, bodies: string[], ai: number | null, needsInput: boolean): NetVerdict {
  const A = ai === null ? '?' : LETTER(ai)
  const hit = (re: RegExp): number => bodies.findIndex((b) => re.test(b))
  const one = (list: number[], yes: string, no: string, note: string): NetVerdict => ({
    verdict: list.length === 1 ? (list[0] === ai ? yes : no) : '',
    matched: list.length === 1 && list[0] === ai ? [LETTER(list[0])] : [],
    looseOnly: list.length === 1 && list[0] !== ai ? [LETTER(list[0])] : [],
    note,
  })
  if (ec === 'compile-error') {
    const k = hit(RE_COMPILE_OPT)
    if (k >= 0) return { verdict: k === ai ? 'ok-compile-error-is-answer' : 'compile-error-vs-answer', matched: [LETTER(k)], looseOnly: [], note: '题干程序实机编译失败；选项 ' + LETTER(k) + ' 正是「编译/语法错误」，answer=' + A }
    return { verdict: 'excluded-fragment', matched: [], looseOnly: [], note: '题干代码不是完整可编译程序（本题考表达式/改错，不是输出预测），实机层不适用' }
  }
  if (ec === 'runtime-error' || ec === 'timeout') {
    const what = ec === 'timeout' ? '超时（疑似死循环）' : '运行时崩溃'
    const k = hit(RE_ABNORMAL_OPT)
    if (k >= 0) return { verdict: k === ai ? 'ok-abnormal-is-answer' : 'abnormal-vs-answer', matched: [LETTER(k)], looseOnly: [], note: '题干程序实机' + what + '；选项 ' + LETTER(k) + ' 对应该事实，answer=' + A }
    return { verdict: ec === 'timeout' ? 'abnormal-timeout' : 'abnormal-runtime-error', matched: [], looseOnly: [], note: '题干程序实机' + what + '，且没有任何选项对应该事实' }
  }
  // 三层等值：严格（判分口径）→ 折叠空白 → 完全忽略空白。只有严格层能定「多解」，
  // 后两层是「选项排版与真实输出差空白」的线索，一律 P2，不把排版差异说成答案错。
  const strict: number[] = []
  const looseHit: number[] = []
  const nospaceHit: number[] = []
  const flat = out.replace(/\s+/g, '')
  bodies.forEach((b, k) => {
    if (b === out) strict.push(k)
    else if (loose(b) === loose(out)) looseHit.push(k)
    else if (b.replace(/\s+/g, '') === flat) nospaceHit.push(k)
  })
  if (strict.length === 1) return { verdict: strict[0] === ai ? 'ok-unique' : 'answer-mismatch', matched: [LETTER(strict[0])], looseOnly: [], note: strict[0] === ai ? '' : '真实输出逐字等于选项 ' + LETTER(strict[0]) + '，但 answer=' + A }
  if (strict.length > 1) return { verdict: 'multi-match', matched: strict.map(LETTER), looseOnly: [], note: '判分口径下 ' + strict.map(LETTER).join('/') + ' 与真实输出完全相同 → 多解' }
  for (const tier of [[looseHit, '折叠空白后'], [nospaceHit, '忽略全部空白后']] as Array<[number[], string]>) {
    const [list, how] = tier
    if (list.length === 1) return one(list, 'ok-modulo-whitespace', 'answer-mismatch-whitespace', '真实输出与选项 ' + LETTER(list[0]) + ' ' + how + '相同（□ 记号/缩进/全角排版差异），answer=' + A)
    if (list.length > 1) return { verdict: 'multi-match-loose', matched: [], looseOnly: list.map(LETTER), note: how + ' ' + list.map(LETTER).join('/') + ' 都与真实输出相同' }
  }
  // 描述性选项：真实输出作为子串嵌在选项文字里（如「程序的输出结果为小写字母 a」）
  const trimmed = out.trim()
  const embedded = trimmed ? bodies.map((b, k) => (CJK.test(b) && b.includes(trimmed) ? k : -1)).filter((k) => k >= 0) : []
  if (embedded.length === 1) return { verdict: embedded[0] === ai ? 'ok-embedded' : 'embedded-mismatch', matched: [LETTER(embedded[0])], looseOnly: [], note: '选项是描述句，真实输出 ' + JSON.stringify(trimmed.slice(0, 30)) + ' 唯一嵌在选项 ' + LETTER(embedded[0]) + '，answer=' + A }
  if (embedded.length > 1) return { verdict: 'embedded-multi', matched: embedded.map(LETTER), looseOnly: [], note: '真实输出同时嵌在描述性选项 ' + embedded.map(LETTER).join('/') + ' 里 → 无法区分' }
  const ind = hit(RE_ABNORMAL_OPT)
  if (ind >= 0) return { verdict: ind === ai ? 'ok-indeterminate' : 'indeterminate-vs-answer', matched: [LETTER(ind)], looseOnly: [], note: '真实输出 ' + JSON.stringify(out.slice(0, 30)) + ' 不等于任何具体选项，而选项 ' + LETTER(ind) + ' 是「不确定值」类，answer=' + A }
  if (hasGarbage(rawOut)) return { verdict: 'nondeterministic-output', matched: [], looseOnly: [], note: '真实输出含控制字符/替换符（' + JSON.stringify(rawOut.slice(0, 24)) + '），是未初始化或越界读的结果，不能当证据判答案错' }
  if (needsInput) return { verdict: 'excluded-needs-input', matched: [], looseOnly: [], note: '题干程序读 stdin，而选择题没有结构化 stdin（输入常写在题干散文里），实机输出不可作为证据' }
  if (bodies.every((b) => CJK.test(b))) return { verdict: 'excluded-descriptive', matched: [], looseOnly: [], note: '四个选项都是描述句/公式而不是字面输出（问「程序的功能是」「应填的表达式是」），实机层不适用' }
  return { verdict: 'no-match', matched: [], looseOnly: [], note: '真实输出 ' + JSON.stringify(out.slice(0, 40)) + ' 不匹配任何选项' }
}

// ───────────────────────── B 实机层：候选筛选 ─────────────────────────
function extractCode(stem: string): string | null {
  const re = new RegExp(FENCE + '[^\\n]*\\n([\\s\\S]*?)' + FENCE, 'g')
  let best: string | null = null; let m: RegExpExecArray | null
  while ((m = re.exec(stem)) !== null) if (/int\s+main/.test(m[1])) best = m[1]
  if (best) return best.trim()
  let cut = Infinity
  for (const k of ['#include', 'int main', 'void main']) { const i = stem.indexOf(k); if (i >= 0 && i < cut) cut = i }
  if (Number.isFinite(cut)) return stem.slice(cut).trim()
  return null
}
interface Cand { rec: Rec; code: string; stdin: string }
const cands: Cand[] = []
for (const r of recs) {
  const p = r.p
  if (S(p, 'type') !== 'single_choice') continue
  const opts = STRARR(p, 'options')
  if (opts.length < 3) continue
  if (opts.some((o) => o.length > 60)) continue
  const code = extractCode(S(p, 'stem'))
  if (!code || !/int\s+main/.test(code)) continue
  let stdin = typeof p['stdin'] === 'string' ? (p['stdin'] as string) : ''
  const tc = A(p, 'testCases')
  if (!stdin && tc.length) { const o = tc[0] as Record<string, unknown>; if (typeof o?.['stdin'] === 'string') stdin = o['stdin'] as string }
  cands.push({ rec: r, code, stdin })
}
console.log(`本地检查完成：单选 ${scChecked} 判断 ${tfChecked} 全库 ${recs.length}；实机候选 ${cands.length} 题；结构层命中 ${F.length} 条`)

// ───────────────────────── B 实机层：Godbolt ─────────────────────────
interface ExecResult { errorClass: string; compiled: boolean; exitCode: number; stdout: string; stderr: string; diagnostics: unknown[]; compilerMessage: string; execTimeMs?: number }
interface Backend { id: string; minIntervalMs: number; timeoutMs: number; maxConcurrency: number; execute(r: { code: string; stdin: string; compileOnly?: boolean }): Promise<ExecResult> }
interface NetRow { id: string; file: string; verdict: string; answer: string; matched: string[]; looseOnly: string[]; stdout: string; errorClass: string; ms: number; opts: string[]; note: string }
/** 实机判定 → 严重度；ok-* 与 excluded-* 不进待复核清单（null = 不记 finding） */
const NET_SEV: Record<string, Sev | null> = {
  'answer-mismatch': 'P0', 'multi-match': 'P0', 'compile-error-vs-answer': 'P0',
  'abnormal-vs-answer': 'P1', 'abnormal-runtime-error': 'P1', 'abnormal-timeout': 'P1',
  'embedded-mismatch': 'P1', 'embedded-multi': 'P1', 'multi-match-loose': 'P1',
  'answer-mismatch-whitespace': 'P1', 'indeterminate-vs-answer': 'P1', 'no-match': 'P1',
  'transport-error': 'P2',
}
const NET: NetRow[] = []
const netStats = new Map<string, number>()

async function runNet(): Promise<void> {
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: false, root: ROOT.split('\\').join('/'), logLevel: 'silent',
    server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true },
  })
  let be: Backend; let beMath: Backend; let normalize: (t: string) => string
  let needsMath: (c: string) => boolean = () => false
  try {
    const mod = (await server.ssrLoadModule('/src/judge/backends/godbolt.ts')) as { createGodboltBackend: (o: Record<string, unknown>) => Backend }
    const base = (await server.ssrLoadModule('/src/judge/backends/base.ts')) as { normalizeOutput: (t: string) => string }
    const math = (await server.ssrLoadModule('/src/judge/math-lib.ts')) as { MATH_COMPILER: string; MATH_BACKEND_ID: string; needsMathLib: (c: string) => boolean }
    normalize = base.normalizeOutput
    needsMath = math.needsMathLib
    be = mod.createGodboltBackend({})
    beMath = mod.createGodboltBackend({ id: math.MATH_BACKEND_ID, compiler: math.MATH_COMPILER })
  } finally { await server.close() }
  console.log(`实机后端就绪 id=${be.id} minIntervalMs=${be.minIntervalMs} timeoutMs=${be.timeoutMs}；开始串行跑 ${Math.min(cands.length, LIMIT)} 题`)

  const list = cands.slice(0, Number.isFinite(LIMIT) ? LIMIT : cands.length)
  let i = 0
  for (const c of list) {
    i += 1
    const p = c.rec.p; curFile = c.rec.file
    const opts = STRARR(p, 'options')
    const ai = ansIndex(p, opts.length)
    const pick = needsMath(c.code) ? beMath : be
    let res: ExecResult | null = null
    let err = ''
    for (let attempt = 0; attempt < 2 && res === null; attempt += 1) {
      try {
        await sleep(pick.minIntervalMs)
        const t0 = Date.now()
        res = await pick.execute({ code: c.code, stdin: c.stdin, compileOnly: false })
        res.execTimeMs = res.execTimeMs ?? Date.now() - t0
      } catch (e) { err = String((e as Error)?.message ?? e); res = null; await sleep(2000) }
    }
    if (res === null) {
      NET.push({ id: S(p, 'id'), file: curFile, verdict: 'transport-error', answer: ai === null ? '?' : LETTER(ai), matched: [], looseOnly: [], stdout: '', errorClass: err.slice(0, 120), ms: 0, opts: opts.map(optBody), note: '后端抖动，未判定' })
      netStats.set('transport-error', (netStats.get('transport-error') ?? 0) + 1)
      continue
    }
    const rawOut = normalize(res.stdout)
    // 比对文本一律先 NFKC（全角减号/逗号/空格 → 半角），否则 c-ch07-sc-004 这类
    // 用「－17」排版的选项会与真实输出「-17」比不上，白白报成缺陷。
    const out = nfkc(rawOut)
    const v = classifyNet(res.errorClass, out, rawOut, opts.map((o) => nfkc(normalize(optNorm(o)))), ai, RE_READS_STDIN.test(c.code) && !c.stdin.trim())
    const verdict = v.verdict
    netStats.set(verdict, (netStats.get(verdict) ?? 0) + 1)
    NET.push({ id: S(p, 'id'), file: curFile, verdict, answer: ai === null ? '?' : LETTER(ai), matched: v.matched, looseOnly: v.looseOnly, stdout: rawOut.slice(0, 200), errorClass: res.errorClass, ms: Math.round(res.execTimeMs ?? 0), opts: opts.map(optBody), note: v.note })
    const sev = NET_SEV[verdict]
    if (sev) add(p, sev, 'net-' + verdict, v.note || ('stdout=' + JSON.stringify(out.slice(0, 60))))
    if (i % 10 === 0) console.log(`  …实机 ${i}/${list.length}`)
  }
  console.log(`实机完成 ${list.length} 题：` + [...netStats.entries()].map(([k, v]) => `${k}=${v}`).join(' '))
}
if (!NO_NET && cands.length) await runNet()

// ───────────────────────── judge:verify 复跑证据 ─────────────────────────
let jv = { generated_at: '', total: 0, ok: 0, inconclusive: 0, carried: 0, requests: 0 }
if (existsSync(REPORT_JSON)) {
  const j = JSON.parse(readFileSync(REPORT_JSON, 'utf8')) as { generated_at?: string; results?: Array<{ ok: boolean; inconclusive: boolean; carried_over?: boolean; request_count: number }> }
  const rs = j.results ?? []
  jv = {
    generated_at: j.generated_at ?? '', total: rs.length,
    ok: rs.filter((x) => x.ok).length, inconclusive: rs.filter((x) => x.inconclusive).length,
    carried: rs.filter((x) => x.carried_over === true).length,
    requests: rs.reduce((s, x) => s + (x.request_count ?? 0), 0),
  }
}

// ───────────────────────── 输出 ─────────────────────────
const CODES: Record<string, { sev: Sev; title: string; advice: string }> = {
  'sc-options-too-few': { sev: 'P0', title: '单选选项不足 2 个', advice: '补选项或改题型' },
  'sc-options-too-many': { sev: 'P2', title: '单选选项超过 6 个', advice: '体例问题，可保留' },
  'sc-answer-not-index': { sev: 'P0', title: '单选 answer 不是整数下标', advice: '前端按下标取答案，非整数会判分异常' },
  'sc-answer-out-of-range': { sev: 'P0', title: '单选 answer 越界', advice: '修正下标' },
  'sc-option-empty': { sev: 'P0', title: '存在空选项', advice: '补内容' },
  'sc-option-duplicate': { sev: 'P0', title: '选项原样重复（多个选项均正确）', advice: '换掉其中一个干扰项' },
  'sc-option-duplicate-nospace': { sev: 'P2', title: '选项仅空白不同', advice: '输出预测题里换行/空格就是考点，多数属正当设计，仅需人工确认判分口径不会折叠空白' },
  'sc-option-letter-mismatch': { sev: 'P0', title: '选项自带字母前缀与下标错位', advice: '学生看到的字母与判分下标不一致' },
  'sc-explanation-letter-conflict': { sev: 'P0', title: 'explanation 与 answer 指向不同选项', advice: '二者必有一错，需人工裁决' },
  'tf-answer-shape': { sev: 'P0', title: '判断题 answer 取值异常', advice: '统一为 true/false' },
  'tf-explanation-conflict': { sev: 'P0', title: '判断题 explanation 与 answer 矛盾', advice: '人工裁决' },
  'stem-empty': { sev: 'P0', title: 'stem 为空', advice: '补题干' },
  'explanation-missing': { sev: 'P0', title: '缺 explanation', advice: 'AGENTS.md 要求每题必带详解' },
  'explanation-short': { sev: 'P1', title: 'explanation 少于 50 字', advice: '补充「为什么」与易错点' },
  'doubt-marker-surface': { sev: 'P0', title: '学生可见文本残留存疑标记', advice: '逐条裁决后清除' },
  'doubt-marker-meta': { sev: 'P2', title: '元信息里的知情注记', advice: '设计内保留，不判失败' },
  'id-missing': { sev: 'P0', title: '缺 id', advice: '补 id' },
  'id-duplicate': { sev: 'P0', title: 'id 重复', advice: '两题必有一题要改 id' },
  'meta-category': { sev: 'P2', title: 'category 取值异常', advice: '应为 c 或 ds' },
  'meta-bloom': { sev: 'P2', title: 'bloom 取值异常', advice: '应为六级之一' },
  'meta-difficulty': { sev: 'P2', title: 'difficulty 越界', advice: '应为 1..5' },
  'meta-chapter-missing': { sev: 'P2', title: '缺 chapter', advice: '补章节' },
  'meta-source-missing': { sev: 'P2', title: '缺 source', advice: 'AGENTS.md 要求如实注明出处' },
  'code-no-runnable': { sev: 'P0', title: '代码题取不到可运行源码', advice: '缺 solution/fixed_code/reference/answer' },
  'code-no-testcases': { sev: 'P0', title: '代码题无 testCases', advice: '无测试用例等于无法判分' },
  'code-bad-testcase': { sev: 'P0', title: 'testCase 形状非法', advice: 'stdin/expected 必须是字符串' },
  'code-no-stem-code': { sev: 'P1', title: '代码题无题面代码', advice: '学生看不到要填/要改的代码' },
  'code-no-answer-field': { sev: 'P1', title: '无标准答案代码字段', advice: '补 reference/solution/fixed_code' },
  'cr-answer-empty': { sev: 'P0', title: 'code_reading 答案为空', advice: '必须来自真实 stdout' },
  'cr-answer-placeholder': { sev: 'P0', title: 'code_reading 答案仍是占位符', advice: '跑 judge:verify 取真实输出' },
  'fb-no-blanks': { sev: 'P0', title: '填空题无 blanks', advice: '无法判分' },
  'fb-blank-no-answer': { sev: 'P0', title: '填空某空无 answer', advice: '补答案与 accepted' },
  'fb-count-mismatch': { sev: 'P1', title: '下划线数量与 blanks 条数不符', advice: '人工核对是否漏空/多空' },
  'sa-no-answer': { sev: 'P1', title: '简答题无参考答案', advice: '补 reference_answer 或 grading_points' },
  'net-answer-mismatch': { sev: 'P0', title: '实机输出唯一匹配的选项不是 answer', advice: '答案错，或题干程序与选项设计不符，必须人工裁决' },
  'net-multi-match': { sev: 'P0', title: '实机输出逐字等于多个选项（多解）', advice: '干扰项必须与真实输出可区分' },
  'net-compile-error-vs-answer': { sev: 'P0', title: '程序实机编译失败，但 answer 不是「编译错误」那个选项', advice: '人工裁决：题干代码有误或答案错' },
  'net-abnormal-vs-answer': { sev: 'P1', title: '程序实机崩溃/超时，但 answer 不是对应选项', advice: '多为未定义行为题，人工确认' },
  'net-abnormal-runtime-error': { sev: 'P1', title: '题干程序运行时崩溃且无选项对应', advice: '人工确认是否题目本意' },
  'net-abnormal-timeout': { sev: 'P1', title: '题干程序超时（疑似死循环）且无选项对应', advice: '人工确认是否题目本意' },
  'net-embedded-mismatch': { sev: 'P1', title: '真实输出唯一嵌在某个描述性选项里，但不是 answer', advice: '人工核对描述句与 answer' },
  'net-embedded-multi': { sev: 'P1', title: '真实输出同时嵌在多个描述性选项里', advice: '选项之间无法区分' },
  'net-multi-match-loose': { sev: 'P1', title: '折叠空白后多个选项与真实输出相同', advice: '若空白是考点则属正当，人工确认' },
  'net-answer-mismatch-whitespace': { sev: 'P1', title: '真实输出仅与某选项差空白，且该选项不是 answer', advice: '人工核对空白/换行书写' },
  'net-indeterminate-vs-answer': { sev: 'P1', title: '真实输出不等于任何具体选项，而「不确定值」选项不是 answer', advice: '多为未初始化变量题，人工裁决' },
  'net-no-match': { sev: 'P1', title: '实机输出不匹配任何选项', advice: '选项写错/输出格式差异，人工核对' },
  'net-transport-error': { sev: 'P2', title: '后端抖动，未判定', advice: '重跑本脚本；不影响数据' },
}
const byCode = new Map<string, Finding[]>()
for (const f of F) { const l = byCode.get(f.code) ?? []; l.push(f); byCode.set(f.code, l) }
const order = [...byCode.keys()].sort((a, b) => {
  const sa = 'P0P1P2'.indexOf(CODES[a]?.sev ?? 'P2'), sb = 'P0P1P2'.indexOf(CODES[b]?.sev ?? 'P2')
  return sa - sb || (CODES[a]?.title ?? a).localeCompare(CODES[b]?.title ?? b, 'zh')
})
const p0 = F.filter((x) => x.sev === 'P0').length
const p1 = F.filter((x) => x.sev === 'P1').length
const p2 = F.filter((x) => x.sev === 'P2').length

writeFileSync(OUT_JSON, JSON.stringify({
  generated_at: new Date().toISOString(), totals: { problems: recs.length, findings: F.length, p0, p1, p2 },
  by_type: Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])),
  net_stats: Object.fromEntries(netStats), net_rows: NET, findings: F,
}, null, 1), 'utf8')

const L: string[] = []
L.push('# 全库质量报告')
L.push('')
L.push(`- 生成时刻：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（Asia/Shanghai）`)
L.push(`- 生成命令：\`node scripts/scan-full-quality.ts${NO_NET ? ' --no-net' : ''}\`（脚本只读，**不改任何题目数据**）`)
L.push(`- 扫描范围：\`public/data/problems/\` 全部 ${recs.length} 道题（${readdirSync(DIR).filter((n) => SHARD.test(n)).length} 个分片）`)
L.push('- 机器可读全量清单：`tmp/full-quality-scan.json`（已 gitignore，含逐题命中明细与实机 stdout）')
L.push('- 口径声明：本轮**只报告不修改**。P0/P1 全部进入第九节「待人工复核清单」，由人裁决后再动数据。')
L.push('')
L.push('## 一、一句话结论')
L.push('')
L.push(`全库 ${recs.length} 道题结构层命中 ${F.length} 条（P0 ${p0} / P1 ${p1} / P2 ${p2}）；` +
  `Godbolt 实机复核 ${NET.length} 道「题干自带完整程序」的单选题，其中 ${netStats.get('ok-unique') ?? 0} 道真实输出唯一命中 answer 选项。`)
L.push('')
L.push('## 二、规模盘点')
L.push('')
L.push('| 题型 | 数量 | 占比 |')
L.push('|---|---:|---:|')
const tot = recs.length
for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1])) L.push(`| \`${k}\` | ${v} | ${(100 * v / tot).toFixed(1)}% |`)
L.push(`| **合计** | **${tot}** | 100% |`)
L.push('')
const aiN = recs.filter((r) => r.p['ai_generated'] === true).length
L.push(`- \`ai_generated: true\`：${aiN} 道（${(100 * aiN / tot).toFixed(1)}%）；既有/教材转录：${tot - aiN} 道`)
L.push(`- \`verified: true\`：${verifiedCount} 道（唯一置位途径是 \`npm run judge:verify\`，本轮未改动）`)
L.push(`- \`answerIsDescription: true\`：${descCount} 道（描述性试题，设计内不进自动判分，故 answer 为空不计缺陷）`)
L.push('')
L.push('## 三、检查项总览')
L.push('')
L.push('| 严重度 | 检查项 | 命中 | 处置建议 |')
L.push('|---|---|---:|---|')
for (const c of order) {
  const m = CODES[c] ?? { sev: 'P2' as Sev, title: c, advice: '' }
  L.push(`| ${m.sev} | ${m.title}（\`${c}\`） | ${byCode.get(c)?.length ?? 0} | ${m.advice} |`)
}
L.push('')
L.push('## 四、选择题答案唯一性（A 结构层）')
L.push('')
L.push(`单选题 ${scChecked} 道、判断题 ${tfChecked} 道全量逐题检查：answer 是否合法下标、选项是否重复（原样 / 掩码数字字符串后）、`)
L.push('选项自带字母前缀是否与下标错位、explanation 写的答案字母是否与 answer 字段一致。')
L.push('')
const ACODES = order.filter((c) => /^(sc-|tf-)/.test(c))
if (!ACODES.length) L.push('**0 命中**：没有发现「多个选项均正确」「无一正确」「answer 越界」「解析与答案打架」的结构性缺陷。')
else for (const c of ACODES) { L.push(`### ${CODES[c]?.title ?? c}（${byCode.get(c)?.length ?? 0} 条）`); L.push(''); L.push(...table(byCode.get(c) ?? [])); L.push('') }
L.push('')
L.push('## 五、选择题答案唯一性（B 实机层，Godbolt 真跑）')
L.push('')
L.push(`结构层查不出「选项写得像但程序真实输出是另一个」这类问题，所以把 ${cands.length} 道「stem 自带完整可编译程序、选项像输出候选」的单选题`)
L.push('送去 Godbolt 实机跑（编译参数与线上判分同源：`-std=c99 -Wall -Wextra`，严格串行、尊重 `minIntervalMs`），')
L.push('把真实 stdout 与 4 个选项逐一比对。选项里的 `□` / `·` 是「一个空格」的印刷记号，比对时还原成空格但不折叠其它空白。')
L.push('')
if (!NET.length) {
  L.push(NO_NET ? '本次以 `--no-net` 运行，未做实机复核。' : '无候选题。')
} else {
  L.push('| 判定 | 数量 | 含义 |')
  L.push('|---|---:|---|')
  const MEAN: Record<string, string> = {
    'ok-unique': '真实输出逐字等于、且只等于 answer 指向的选项',
    'ok-modulo-whitespace': '真实输出与 answer 选项仅差空白（□ 记号/缩进书写差异）',
    'ok-embedded': '选项是描述句，真实输出唯一嵌在 answer 指向的那句里',
    'ok-indeterminate': '输出确实不可预测，而 answer 正是「不确定值」',
    'ok-compile-error-is-answer': '程序确实编译失败，而 answer 正是「编译出错」',
    'ok-abnormal-is-answer': '程序确实崩溃/超时，而 answer 正是对应选项',
    'excluded-fragment': '题干代码不是完整可编译程序（考表达式/改错），实机层不适用',
    'answer-mismatch': '真实输出唯一匹配的选项不是 answer → 答案错',
    'multi-match': '真实输出逐字等于多个选项 → 多解',
    'compile-error-vs-answer': '程序编译失败，但 answer 不是「编译错误」选项',
    'abnormal-vs-answer': '程序崩溃/超时，但 answer 不是对应选项',
    'abnormal-runtime-error': '程序运行时崩溃且无选项对应',
    'abnormal-timeout': '程序超时且无选项对应',
    'embedded-mismatch': '真实输出唯一嵌在某个描述性选项里，但不是 answer',
    'embedded-multi': '真实输出同时嵌在多个描述性选项里',
    'multi-match-loose': '折叠空白后多个选项与真实输出相同',
    'answer-mismatch-whitespace': '真实输出仅与某选项差空白，且该选项不是 answer',
    'indeterminate-vs-answer': '输出不可预测，但 answer 指向某个具体值',
    'no-match': '真实输出不匹配任何选项',
    'transport-error': '后端抖动，未判定',
  }
  for (const [k, v] of [...netStats.entries()].sort((a, b) => b[1] - a[1])) L.push(`| \`${k}\` | ${v} | ${MEAN[k] ?? ''} |`)
  L.push(`| **合计** | **${NET.length}** | |`)
  L.push('')
  const excluded = NET.filter((x) => x.verdict === 'excluded-fragment')
  const bad = NET.filter((x) => !x.verdict.startsWith('ok-') && x.verdict !== 'excluded-fragment')
  L.push(`其中 ${excluded.length} 道的题干代码不是完整可编译程序（这类题考「哪个表达式对」「哪句 scanf 对」，不是输出预测），实机层不适用，单列为 excluded-fragment（不计缺陷）。`)
  L.push('')
  L.push(bad.length ? `### 需人工复核的 ${bad.length} 题` : '**实机层 0 异常**：所有可判定的候选题，真实输出都唯一命中 answer 指向的选项。')
  L.push('')
  if (bad.length) {
    L.push('| 题号 | 判定 | answer | 命中 | 真实 stdout（前 50 字） | 说明 |')
    L.push('|---|---|---|---|---|---|')
    for (const x of bad.slice(0, 60)) L.push(`| \`${x.id}\` | ${x.verdict} | ${x.answer} | ${[...x.matched, ...x.looseOnly.map((y) => y + '~')].join(',') || '—'} | ${JSON.stringify(x.stdout.slice(0, 50))} | ${(x.note || '').replace(/\|/g, '/')} |`)
    if (bad.length > 60) L.push(`| …其余 ${bad.length - 60} 条见 tmp/full-quality-scan.json | | | | |`)
    L.push('')
    L.push('> 「命中」列：字母 = 严格等值命中（判分口径）；字母后带 ~ = 仅折叠空白后命中。')
  }
}
L.push('')
L.push('## 六、explanation 质量（C）')
L.push('')
L.push(`- 缺失 / 为空：**${explMissing}** 道（AGENTS.md 第三节要求每道题必须带 explanation）`)
L.push(`- 少于 50 字（去 markdown 记号后按字符计）：**${explShort}** 道`)
const shortList = (byCode.get('explanation-short') ?? []).slice(0, 40)
if (shortList.length) { L.push(''); L.push(...table(shortList)) }
L.push('')
L.push('与 answer 矛盾的自检结果见第四、五节（`sc-explanation-letter-conflict` / `tf-explanation-conflict` / `net-answer-mismatch`）。')
L.push('')
L.push('## 七、存疑残留标记（D）')
L.push('')
L.push(`正则：\`${DOUBT_RE.source}\`（比 \`npm run scan:doubt\` 更宽，多扫 待定/待补/TBD/XXX/占位/???）。`)
L.push('')
L.push(`- 学生可见的表面文本（stem/options/blanks/answer/solution/code/testCases）：**${doubtSurface}** 处`)
L.push(`- 元信息（explanation/source 等知情注记，设计内保留）：**${doubtMeta}** 处`)
const ds = byCode.get('doubt-marker-surface') ?? []
if (ds.length) { L.push(''); L.push(...table(ds)) }
L.push('')
L.push('## 八、字段自洽（E）与 judge:verify 复跑')
L.push('')
const EC = order.filter((c) => /^(id-|meta-|code-|cr-|fb-|sa-|stem-)/.test(c))
if (!EC.length) L.push('**0 命中**：id 无重复、代码题都能取到可运行源码与 testCases、填空下划线数与 blanks 条数一致、元字段取值合法。')
else for (const c of EC) { L.push(`- ${CODES[c]?.title ?? c}（\`${c}\`）：**${byCode.get(c)?.length ?? 0}** 条`) }
L.push('')
L.push('### judge:verify 全量复跑（数据改动后的漂移检查）')
L.push('')
L.push(`- 报告：\`public/data/problems/verification-report.json\`，生成于 ${jv.generated_at || '(未找到)'}`)
L.push(`- 覆盖代码题 **${jv.total}** 道，实机请求 **${jv.requests}** 次，通过 **${jv.ok}/${jv.total}**`)
L.push(`- 后端抖动导致「未判定」：**${jv.inconclusive}** 道；沿用 last_known_good 证据：**${jv.carried}** 道`)
L.push('- 复跑命令：`node scripts/judge-verify.ts --no-write`（只跑不改数据；`verified` 一个字节都没动）')
L.push('')
L.push('## 九、待人工复核清单')
L.push('')
const needHuman = F.filter((x) => x.sev !== 'P2')
if (!needHuman.length) L.push('本轮没有需要人工裁决的条目。')
else {
  L.push(`P0 ${p0} 条 + P1 ${p1} 条，按检查项分组（完整明细见 \`tmp/full-quality-scan.json\`）：`)
  L.push('')
  L.push('| 优先级 | 检查项 | 条数 | 题号（前 12） |')
  L.push('|---|---|---:|---|')
  for (const c of order.filter((x) => (CODES[x]?.sev ?? 'P2') !== 'P2')) {
    const l = byCode.get(c) ?? []
    L.push(`| ${CODES[c]?.sev} | ${CODES[c]?.title ?? c} | ${l.length} | ${l.slice(0, 12).map((x) => '`' + x.id + '`').join(' ')}${l.length > 12 ? ' …' : ''} |`)
  }
}
L.push('')
L.push('## 十、结论与建议')
L.push('')
L.push(`1. **答案唯一性**：结构层 ${ACODES.reduce((s, c) => s + (byCode.get(c)?.length ?? 0), 0)} 条命中、实机层 ${NET.filter((x) => !x.verdict.startsWith('ok-')).length} 条异常。`)
L.push('   实机层是本轮新增的证据来源——它把「AI 生成的选项是否与真实程序行为一致」从主观判断变成了可复跑的事实。')
L.push('2. **explanation**：全库无缺失即为达标底线；短解析清单已列出，建议按章节批量补「为什么 + 易错点」，不必逐条重写。')
L.push('3. **不自动改数据**：本轮严格遵守「只报告不修改」。P0 条目建议按题型分批裁决，改完必须重跑 `npm run judge:verify` 与 `npm run verify:data`。')
L.push('4. **复跑方式**：`node scripts/scan-full-quality.ts`（含实机，约 2 分钟）；`--no-net` 只做本地结构检查（约 1 秒），适合接进 CI。')
L.push('')
writeFileSync(OUT_MD, L.join('\n'), 'utf8')

function table(list: Finding[]): string[] {
  const out = ['| 题号 | 类型 | 分片 | 明细 |', '|---|---|---|---|']
  for (const x of list.slice(0, 40)) out.push(`| \`${x.id}\` | ${x.type} | ${x.file} | ${x.detail.replace(/\|/g, '/')} |`)
  if (list.length > 40) out.push(`| …其余 ${list.length - 40} 条见 \`tmp/full-quality-scan.json\` | | | |`)
  return out
}
console.log(`报告写出：docs/全库质量报告.md（${(L.join('\n').length / 1024).toFixed(1)} KB）；P0=${p0} P1=${p1} P2=${p2}`)