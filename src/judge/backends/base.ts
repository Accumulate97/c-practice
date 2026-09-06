/**
 * 后端无关的公共件：输出归一化、比对、ANSI 剥离、诊断文本化。
 *
 * 归一化规则的唯一真源是 04_题型规范与样例.md 第〇节：
 *   CRLF/CR -> LF -> 逐行剥离行尾空白 -> 剥离整体末尾的全部换行 -> 逐行比对。
 * 数据里的 expected 一律不写末尾换行，但判分侧仍必须归一化：printf 的输出
 * 必然带末尾 \n（05 规范也如此要求），差异在这里吸收，不写进数据文件。
 */
import type { CompileDiag } from '../types'

// Godbolt 的编译输出带 ANSI 色码，进 UI 前必须剥掉
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

// 后端把 Array<{text}> 一行一项的 stdout 拼成文本；元素本身不含换行
export function joinTextLines(rows: unknown): string {
  if (!Array.isArray(rows)) return ''
  return rows
    .map((r) => (typeof r === 'string' ? r : ((r as { text?: unknown }).text ?? '')))
    .join('\n')
}
/** 判分归一化：换行统一 -> 逐行去行尾空白 -> 去整体末尾换行 */
export function normalizeOutput(text: string): string {
  return stripTrailingBlankLines(toLF(text).split('\n').map((line) => trimEnd(line)).join('\n'))
}

/** expected 用同一套规则，避免「数据里多写了个空格」判成答案错误 */
export const normalizeExpected = normalizeOutput

export function toLF(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function trimEnd(line: string): string {
  return line.replace(/[ \t]+$/, '')
}

function stripTrailingBlankLines(text: string): string {
  let end = text.length
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === ' ')) end -= 1
  return text.slice(0, end)
}

/** 逐行比对（两侧都已归一化） */
export function matchOutput(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeExpected(expected)
}

/** 给 UI 用的差异摘要：只报第一个不一致的行号 */
export function firstDiffLine(actual: string, expected: string): number | null {
  const a = normalizeOutput(actual).split('\n')
  const e = normalizeExpected(expected).split('\n')
  const n = Math.max(a.length, e.length)
  for (let i = 0; i < n; i++) if (a[i] !== e[i]) return i + 1
  return null
}

export function formatDiagnostics(diags: CompileDiag[]): string {
  return diags
    .map((d) => `${d.line}:${d.column}: ${d.severity === 'error' ? '错误' : '警告'}: ${d.message}`)
    .join('\n')
}

/** 归一化 + 截断预览，日志和 UI 都用它，避免整段 8KB stdout 糊进 DOM */
export function preview(text: string, max = 400): string {
  const t = normalizeOutput(text)
  return t.length <= max ? t : `${t.slice(0, max)}\n……（共 ${t.length} 字符，已截断预览）`
}