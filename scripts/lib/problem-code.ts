/**
 * 从题目 JSON 里抽出「可编译运行的 C 源码 + 需要比对的输出」。
 * verify-data.ts / lint-code.ts / judge-verify.ts 共用同一份口径，
 * 避免三个脚本对「哪道题算代码题、跑哪个字段」各写一套理解。
 */

export interface TestCaseLike {
  stdin: string
  expected: string
}

export interface Runnable {
  /** 送去编译的完整 C 源码 */
  code: string
  /** 需要实机跑的用例；code_reading 只有一条，expected 取自 answer */
  cases: TestCaseLike[]
  /** 本次校验的是题目里的哪个字段，写进 verification-report.json */
  checkedField: string
}

export interface ProblemLike {
  id: string
  type: string
  [key: string]: unknown
}

/** 代码类题型：必须实机验证后才能置 verified: true（00_任务书.md 第四节） */
export let CODE_TYPES: string[] = [
  'code_completion',
  'debug',
  'code_reading',
  'programming',
  'code_ordering'
]

export function isCodeType(type: string): boolean {
  return CODE_TYPES.indexOf(type) >= 0
}

function str(p: ProblemLike, key: string): string | null {
  let v = p[key]
  return typeof v === 'string' ? v : null
}

function casesOf(p: ProblemLike): TestCaseLike[] {
  let v = p['testCases']
  if (!Array.isArray(v)) return []
  let out: TestCaseLike[] = []
  for (let raw of v) {
    let it = raw as Partial<TestCaseLike> | null
    if (it && typeof it.stdin === 'string' && typeof it.expected === 'string') {
      out.push({ stdin: it.stdin, expected: it.expected })
    }
  }
  return out
}

/**
 * 返回 null 表示这道题不需要实机编译（单选/判断/填空/简答/复杂度/配对）。
 * 字段缺失也返回 null —— 那种情况由 schema 校验负责报错，这里不重复报。
 */
export function buildRunnableSource(p: ProblemLike): Runnable | null {
  switch (p.type) {
    case 'code_completion': {
      let code = str(p, 'solution')
      if (!code) return null
      return { code, cases: casesOf(p), checkedField: 'solution' }
    }
    case 'debug': {
      let code = str(p, 'fixed_code')
      if (!code) return null
      return { code, cases: casesOf(p), checkedField: 'fixed_code' }
    }
    case 'code_reading': {
      let code = str(p, 'code')
      let answer = str(p, 'answer')
      if (!code || !answer) return null
      return { code, cases: [{ stdin: '', expected: answer }], checkedField: 'answer' }
    }
    case 'programming': {
      let code = str(p, 'reference')
      if (!code) return null
      return { code, cases: casesOf(p), checkedField: 'reference' }
    }
    case 'code_ordering': {
      let lines = p['lines']
      let order = p['correct_order']
      if (!Array.isArray(lines) || !Array.isArray(order)) return null
      let ordered: string[] = []
      for (let idx of order) {
        if (typeof idx !== 'number' || idx < 0 || idx >= lines.length) return null
        let line = lines[idx]
        if (typeof line !== 'string') return null
        ordered.push(line)
      }
      return { code: ordered.join('\n'), cases: casesOf(p), checkedField: 'correct_order' }
    }
    default:
      return null
  }
}

/** 三个反引号：用 charCode 拼，免得这个文件里出现模板字符串定界符 */
let FENCE: string = String.fromCharCode(96, 96, 96)

/** 抽出 Markdown 里所有 json 围栏代码块的原文 */
export function extractJsonFences(markdown: string): string[] {
  let blocks: string[] = []
  let cur: string[] | null = null
  for (let line of markdown.split(/\r?\n/)) {
    let t = line.trim()
    if (cur === null) {
      if (t.indexOf(FENCE + 'json') === 0) cur = []
    } else if (t === FENCE) {
      blocks.push(cur.join('\n'))
      cur = null
    } else {
      cur.push(line)
    }
  }
  return blocks
}

/** 从规范文档正文里取出带 id 的题目样例对象 */
export function readDocSamples(markdown: string): ProblemLike[] {
  let out: ProblemLike[] = []
  for (let block of extractJsonFences(markdown)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && typeof (parsed as ProblemLike).id === 'string') {
      out.push(parsed as ProblemLike)
    }
  }
  return out
}
