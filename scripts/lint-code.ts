/**
 * 阶段 3 · 代码风格硬扫（AGENTS.md 第二节第 6 条「禁用清单」的可执行版本）
 *
 * 先剥掉注释与字符串/字符字面量，再匹配禁用构造。不剥就会误报：
 * 教材风格文档里「不要用 & 做引用形参」这类句子本身带 &，
 * printf 的格式串里也常出现 new / delete 之类的词。
 *
 * 例外：banned-system 的字面量本身在被禁构造内部（system("pause") 的 "pause"），
 * 剥掉字符串就永远扫不到，因此该规则只剥注释、保留字符串（raw: true）。
 *
 * 禁用清单：
 *   cpp-ref-param   引用形参 int &x      —— C++ 语法，标准 C 没有
 *   cpp-new         new T                 —— 分配要写 malloc
 *   cpp-delete      delete                —— 释放要写 free
 *   cpp-stream      cin / cout / cerr / endl / std::
 *   cpp-header      #include <iostream> 等 C++ 标准库头
 *   banned-gets     gets(                 —— C11 已移除，用 fgets
 *   banned-conio    conio.h               —— 非标准
 *   banned-getch    getch( / getche(      —— 非标准
 *   banned-kbhit    kbhit                 —— 非标准
 *   banned-system   system("pause")       —— 非标准且依赖 shell
 *   banned-bios     <bios.h> <io.h> <process.h> <windows.h> 等 DOS/Windows 专有头
 *
 * 用法：
 *   node scripts/lint-code.ts              扫 public/data 与 04 的样例代码（必须 0 命中）
 *   node scripts/lint-code.ts --all        再加扫 05/06 的 C 代码围栏（仅供参考，见下方口径说明）
 *   node scripts/lint-code.ts --self-test  自证：禁用构造能抓到，scanf 的 & 不会误报
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDocSamples } from './lib/problem-code.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBLEM_DIR = join(ROOT, 'public', 'data', 'problems')
const NON_SHARD = new Set(['index.json', 'verification-report.json'])
/** 只认这些键的值是「要送去编译的 C 源码」。answer/expected 是文本输出，不能当代码扫 */
const CODE_KEYS = new Set(['code', 'solution', 'fixed_code', 'reference', 'code_starter', 'lines'])

interface Rule { id: string; re: RegExp; hint: string; raw?: boolean }
/** 统一带 g（exec 循环需要，缺了会死循环）与 m（#include 行首锚定需要） */
const rx = (p: string): RegExp => new RegExp(p, 'gm')

const RULES: Rule[] = [
  { id: 'cpp-ref-param', re: rx('\\b(?:int|char|float|double|void|long|short|signed|unsigned|size_t|const)\\s*(?:\\*\\s*)*&\\s*[A-Za-z_]\\w*\\b'), hint: 'C++ 引用形参，标准 C 请改传指针' },
  { id: 'cpp-new', re: rx('\\bnew\\s+(?:[A-Za-z_]\\w*|\\()'), hint: 'C++ 的 new，请改 malloc' },
  { id: 'cpp-delete', re: rx('\\bdelete\\b'), hint: 'C++ 的 delete，请改 free' },
  { id: 'cpp-stream', re: rx('\\b(?:std::|cin|cout|cerr|clog|endl)\\b'), hint: 'C++ 流与命名空间' },
  { id: 'cpp-header', re: rx('^\\s*#\\s*include\\s*<(?:iostream|vector|string|list|deque|stack|queue|map|set|unordered_map|unordered_set|algorithm|functional|utility|cstdio|cmath)>'), hint: 'C++ 标准库头（C 应用 <stdio.h> 等）' },
  { id: 'banned-gets', re: rx('\\bgets\\s*\\('), hint: 'gets 已废弃且不安全，请用 fgets' },
  { id: 'banned-conio', re: rx('#\\s*include\\s*[<"]conio\\.h'), hint: 'conio.h 非标准' },
  { id: 'banned-getch', re: rx('\\bgetch(?:e)?\\s*\\('), hint: 'getch/getche 非标准' },
  { id: 'banned-kbhit', re: rx('\\bkbhit\\b'), hint: 'kbhit 非标准' },
  { id: 'banned-system', re: rx('\\bsystem\\s*\\(\\s*"pause"\\s*\\)'), hint: 'system("pause") 非标准且依赖 shell', raw: true },
  { id: 'banned-bios', re: rx('#\\s*include\\s*[<"](?:bios|io|process|direct|winsock|windows|graphics|mouse)\\.h'), hint: 'DOS/Windows 专有头，不可移植' },
]

const APOS = String.fromCharCode(39)
const BACKSLASH = String.fromCharCode(92)

/** 把一段区间内的非换行字符替换为空格：保留行号、列号与词边界 */
const blank = (s: string): string => s.replace(/[^\n]/g, ' ')

/** 一遍扫描；keepStrings=false 时连字符串/字符字面量一起剥掉 */
function scrub(src: string, keepStrings: boolean): string {
  const out: string[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j += 1
      out.push(blank(src.slice(i, j)))
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j += 1
      j = Math.min(n, j + 2)
      out.push(blank(src.slice(i, j)))
      i = j
      continue
    }
    if (!keepStrings && (c === '"' || c === APOS)) {
      let j = i + 1
      while (j < n) {
        if (src[j] === BACKSLASH) { j += 2; continue }
        if (src[j] === c) { j += 1; break }
        if (src[j] === '\n' && c === APOS) break
        j += 1
      }
      out.push(blank(src.slice(i, j)))
      i = j
      continue
    }
    out.push(c)
    i += 1
  }
  return out.join('')
}

/** 剥注释 + 剥字面量（多数规则用它，避免字符串里的词误报） */
export function stripNonCode(src: string): string {
  return scrub(src, false)
}

/** 只剥注释、保留字符串（banned-system 用，因为它的证据本身在字符串里） */
export function stripCommentsOnly(src: string): string {
  return scrub(src, true)
}

interface Finding { rule: string; where: string; line: number; hint: string; snippet: string }

function lineOf(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line += 1
  return line
}

/** 扫一段代码；返回命中列表（空数组即通过） */
export function lintSource(src: string, where: string): Finding[] {
  const stripped = stripNonCode(src)
  const rawish = stripCommentsOnly(src)
  const hits: Finding[] = []
  const lines = src.split('\n')
  for (const rule of RULES) {
    const hay = rule.raw ? rawish : stripped
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(hay)) !== null) {
      if (m[0].length === 0) { rule.re.lastIndex += 1; continue }
      const ln = lineOf(src, m.index)
      hits.push({
        rule: rule.id,
        where,
        line: ln,
        hint: rule.hint,
        snippet: (lines[ln - 1] ?? '').trim().slice(0, 100),
      })
    }
  }
  return hits
}

/** 递归收集对象里所有代码字段的字符串值；key 记录当前值所属的字段名（数组元素继承父字段名） */
function collectCode(value: unknown, path: string, out: Array<{ where: string; src: string }>, key = ''): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectCode(v, path + '[' + i + ']', out, key))
    return
  }
  if (typeof value === 'string') {
    if (CODE_KEYS.has(key)) out.push({ where: path, src: value })
    return
  }
  if (!value || typeof value !== 'object') return
  const o = value as Record<string, unknown>
  for (const k of Object.keys(o)) collectCode(o[k], path + '.' + k, out, k)
}

function docFile(prefix: string): string | null {
  const name = readdirSync(ROOT).find((f) => f.startsWith(prefix) && f.endsWith('.md'))
  return name ? join(ROOT, name) : null
}

/** 取 markdown 里指定语言围栏的内容（05/06 的 C 示例） */
function cFences(md: string): string[] {
  const F = String.fromCharCode(96, 96, 96)
  const out: string[] = []
  let cur: string[] | null = null
  let tag = ''
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim()
    if (cur === null) {
      if (t.indexOf(F) === 0) { tag = t.slice(F.length).toLowerCase(); if (tag === 'c' || tag === 'c99') cur = [] }
    } else if (t === F) {
      if (tag === 'c' || tag === 'c99') out.push(cur.join('\n'))
      cur = null
    } else cur.push(line)
  }
  return out
}

interface Case { src: string; rule: string; why: string; minHits?: number }

function selfTest(): number {
  const mustCatch: Case[] = [
    { src: '#include <stdio.h>\nint f(int &x)\n{\n    x += 1;\n}', rule: 'cpp-ref-param', why: '引用形参' },
    { src: 'int *p = new int[10];', rule: 'cpp-new', why: 'new' },
    { src: 'free(p);\ndelete q;', rule: 'cpp-delete', why: 'delete' },
    { src: '#include <iostream>\nusing namespace std;\nint main(){ cout << 1 << endl; return 0; }', rule: 'cpp-stream', why: 'cout/endl' },
    { src: '#include <vector>\nint v;', rule: 'cpp-header', why: 'C++ 头' },
    { src: 'char buf[10];\ngets(buf);', rule: 'banned-gets', why: 'gets' },
    { src: '#include <conio.h>\nint main(){ getch(); return 0; }', rule: 'banned-conio', why: 'conio.h + getch' },
    { src: 'system("pause");', rule: 'banned-system', why: 'system("pause")' },
    { src: '#include <windows.h>\nint x;', rule: 'banned-bios', why: '专有头' },
    { src: 'void swap(int &a, int &b)\n{\n    int t = a; a = b; b = t;\n}', rule: 'cpp-ref-param', minHits: 2, why: '同一条规则命中多处（漏 g 标志会死循环或只报第一处）' },
  ]
  const mustNotCatch: Array<{ src: string; why: string }> = [
    { src: 'scanf("%d", &n);', why: 'scanf 取地址是合法 C，不该报引用形参' },
    { src: 'scanf("%d %d", &a[i], &b);', why: '数组元素取地址' },
    { src: 'int *p = &x; *p = 1;', why: '指针初始化取地址' },
    { src: 'if (a & b) { sum += 1; } if (x && y) { z = 1; }', why: '按位与与逻辑与' },
    { src: 'int x = 6, y = 3, m;\n    m = x & y;\n    y = x | y;', why: '变量间按位与' },
    { src: '// 这里写 int &x 只是注释里的反例\nprintf("%d\\n", v);', why: '注释里的反例不该算' },
    { src: 'printf("new delete cin cout gets\\n");', why: '字符串字面量里的禁用词不该算' },
    { src: 'p->next = q; a = b - c; x = y ^ z;', why: '箭头与减号异或' },
    { src: '// 别写 system("pause")，用 return 0 结束\nint main(void){ return 0; }', why: '注释里的 system("pause") 反例不该算' },
  ]
  let fails = 0
  for (const c of mustCatch) {
    const hits = lintSource(c.src, 'fixture')
    const got = hits.filter((h) => h.rule === c.rule).length
    const need = c.minHits ?? 1
    const ok = got >= need
    if (!ok) fails += 1
    console.log('[self-test] ' + (ok ? 'PASS' : 'FAIL') + ' 应抓到 ' + c.rule + ' x' + need + '（' + c.why + '）' + (ok ? '' : '，实得 ' + (got > 0 ? String(got) : '无命中：' + (hits.map((h) => h.rule).join(',') || '无'))))
  }
  for (const c of mustNotCatch) {
    const hits = lintSource(c.src, 'fixture')
    const ok = hits.length === 0
    if (!ok) fails += 1
    console.log('[self-test] ' + (ok ? 'PASS' : 'FAIL') + ' 不应误报：' + c.why + (ok ? '' : ' → 误报 ' + hits.map((h) => h.rule + '@' + h.line).join(',')))
  }
  console.log(fails === 0 ? '[self-test] lint 规则集有效（' + (mustCatch.length + mustNotCatch.length) + ' 条对照全过）' : '[self-test] ' + fails + ' 条失效')
  return fails
}

if (process.argv.includes('--self-test')) {
  const f = selfTest()
  process.exit(f === 0 ? 0 : 1)
}

const targets: Array<{ where: string; src: string }> = []
for (const name of readdirSync(PROBLEM_DIR).sort()) {
  if (!name.endsWith('.json') || NON_SHARD.has(name)) continue
  const parsed = JSON.parse(readFileSync(join(PROBLEM_DIR, name), 'utf8')) as unknown
  collectCode(parsed, name, targets)
}
const p04 = docFile('04_')
if (p04) {
  for (const s of readDocSamples(readFileSync(p04, 'utf8'))) {
    collectCode(s as unknown, '04#' + s.id + '.json', targets)
  }
}

let findings: Finding[] = []
for (const t of targets) findings = findings.concat(lintSource(t.src, t.where))

console.log('扫描范围：public/data 分片 + 04 样例代码')
console.log('扫描代码段：' + targets.length + ' 处（每道题的 code / solution / fixed_code / reference / code_starter / lines）')
if (findings.length === 0) {
  console.log('结果：0 命中，禁用清单全部通过')
} else {
  for (const f of findings) console.log('✗ [' + f.rule + '] ' + f.where + ' 第 ' + f.line + ' 行：' + f.snippet + '\n    原因：' + f.hint)
  console.log('结果：' + findings.length + ' 处违规')
}

if (process.argv.includes('--all')) {
  console.log('\n--- 参考口径：05 / 06 规范文档里的 C 代码围栏（其中可能含故意展示的反例，只报不计罪）---')
  for (const prefix of ['05_', '06_']) {
    const file = docFile(prefix)
    if (!file) continue
    const blocks = cFences(readFileSync(file, 'utf8'))
    let hits = 0
    blocks.forEach((b, i) => {
      const found = lintSource(b, file.split(/[\\/]/).pop() + '#' + (i + 1))
      hits += found.length
      for (const f of found) console.log('! [' + f.rule + '] ' + f.where + ' 第 ' + f.line + ' 行：' + f.snippet)
    })
    console.log(file.split(/[\\/]/).pop() + '：' + blocks.length + ' 个 C 围栏，' + hits + ' 处提示')
  }
}

process.exit(findings.length === 0 ? 0 : 1)
