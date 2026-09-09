/**
 * 七个概念题渲染器的公共外壳（阶段 5）。
 *
 * ── 为什么要有这一层 ─────────────────────────────────────────────────
 * 概念题（选择 / 判断 / 填空 / 排序 / 复杂度 / 简答 / 匹配）没有编译、没有 stdout，
 * 但它们的页面骨架高度重合：题干（可能含 ```c 代码围栏）→ 作答控件 → 结论横幅 →
 * 数据缺陷面板 → 详解。七个文件各写一遍必然漂移（颜色、data-role、文案口径都会分家），
 * 所以骨架收敛在这里，各渲染器只写自己那部分作答控件与判分调用。
 *
 * ── 与代码题渲染器的边界 ─────────────────────────────────────────────
 * 本文件不含任何判分逻辑，也不 import judge/ 与 grading/stdin-run —— 概念题不联网、
 * 不消耗 Godbolt 额度（AGENTS.md 二·5 的额度是稀缺资源）。判分一律由
 * grading/text-match.ts 的纯函数给出，本文件只负责把结论渲染成人话。
 *
 * ── data-role 是验收契约 ─────────────────────────────────────────────
 * scripts/acceptance-progress-ui.mjs 直接按 data-role 读这些节点，改名要同步改脚本。
 */
import type { CSSProperties, ReactNode } from 'react'
import { MONO_FONT } from '../../../components/common/CodeEditor'

export const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
export const muted: CSSProperties = { color: 'var(--fg-muted)' }
export const control: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }

export const TONE = {
  good: 'var(--color-viz-sorted)',
  bad: 'var(--color-viz-swap)',
  warn: 'var(--color-viz-compare)',
} as const

export type Tone = keyof typeof TONE

/** 题干片段：正文（可能含【1】这类空位记号）或代码围栏 */
export interface StemPart {
  kind: 'text' | 'code'
  lang: string
  body: string
}

/**
 * 按 ``` 围栏切题干。43 道概念题的题干里嵌着 C 代码（简答题尤其多），
 * 直接 whitespace-pre-wrap 渲染会把围栏符号原样打在屏幕上，学生看到的是一堆反引号。
 * 未闭合的围栏（数据里手抄漏了收尾）按「一直到结尾都是代码」处理，不吞掉正文。
 */
export function splitStem(stem: string): StemPart[] {
  const out: StemPart[] = []
  const re = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  for (const m of stem.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', lang: '', body: stem.slice(last, at) })
    out.push({ kind: 'code', lang: (m[1] ?? '').trim(), body: (m[2] ?? '').replace(/\s+$/, '') })
    last = at + m[0].length
  }
  if (last < stem.length) out.push({ kind: 'text', lang: '', body: stem.slice(last) })
  return out.filter((p) => p.kind === 'code' || p.body.trim().length > 0)
}

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <div>
      {title !== undefined && title.length > 0 && (
        <div className="text-xs" style={muted}>{title}</div>
      )}
      <pre
        className="mt-1 overflow-x-auto rounded-lg border p-3 text-xs"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
        data-role="code-block"
      >
        {code}
      </pre>
    </div>
  )
}

/** 题干区：文本段保留换行，代码段等宽渲染 */
export function StemBlock({ stem }: { stem: string }) {
  const parts = splitStem(stem)
  return (
    <section className="rounded-xl border p-4" style={panel} data-role="stem">
      {parts.map((part, i) =>
        part.kind === 'code' ? (
          <div key={i} className={i > 0 ? 'mt-3' : undefined}>
            <CodeBlock code={part.body} />
          </div>
        ) : (
          <p key={i} className={`text-sm whitespace-pre-wrap${i > 0 ? ' mt-3' : ''}`}>{part.body}</p>
        ),
      )}
    </section>
  )
}

/**
 * 结论横幅。概念题即时判定，所以横幅出现的时机就是判分完成的时机，
 * 这里不做 loading 态（没有任何网络请求可等）。
 */
export function VerdictBanner({
  tone, title, detail, children,
}: { tone: Tone; title: string; detail?: string; children?: ReactNode }) {
  return (
    <section
      className="rounded-xl border p-4"
      style={{ ...panel, borderColor: TONE[tone] }}
      data-role="verdict"
      data-tone={tone}
    >
      <p className="text-sm font-semibold" style={{ color: TONE[tone] }}>{title}</p>
      {detail !== undefined && detail.length > 0 && (
        <p className="mt-1 text-sm" style={muted}>{detail}</p>
      )}
      {children}
    </section>
  )
}

/**
 * 数据缺陷面板：题目缺答案（例如 89 道填空题的 blanks[].answer 全是空串）时显示。
 * 红线是「宁可判不出来，也不判通过」——所以这些题的提交按钮一律禁用，
 * 绝不用空串当期望答案（否则交白卷会被判成「通过」，与 exact.ts 对空 answer 的处置同源）。
 */
export function DefectPanel({ title, body, extra }: { title: string; body: string; extra?: ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE.warn }} data-role="defect">
      <p className="text-sm font-semibold" style={{ color: TONE.warn }}>{title}</p>
      <p className="mt-2 text-sm" style={muted}>{body}</p>
      {extra}
    </section>
  )
}

/** 详解区：概念题的 explanation 大量为空串，空就不占版面（不显示「（无详解）」这种噪声） */
export function ExplanationBlock({ text }: { text: string }) {
  if (text.trim().length === 0) return null
  return (
    <section className="rounded-xl border p-4" style={panel} data-role="explanation">
      <h2 className="text-sm font-semibold" style={muted}>详解</h2>
      <div className="mt-2 text-sm whitespace-pre-wrap">{text}</div>
    </section>
  )
}

/** 按钮排：概念题普遍只有「重做 / 显示答案」这类小动作，统一一处样式 */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

export function Button({
  children, onClick, disabled = false, tone = 'plain', role, title,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'plain' | 'good' | 'bad'
  role?: string
  title?: string
}) {
  const color = tone === 'good' ? TONE.good : tone === 'bad' ? TONE.bad : undefined
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-role={role}
      className="rounded-lg border px-3 py-1.5 text-sm"
      style={{ ...control, ...(color === undefined ? {} : { borderColor: color, color }), ...(disabled ? { opacity: 0.5 } : {}) }}
    >
      {children}
    </button>
  )
}
