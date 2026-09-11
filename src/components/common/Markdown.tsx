/**
 * 迷你 Markdown 渲染器（阶段 10-1）：只覆盖知识卡片语料里真实出现的构造。
 *
 * 为什么不用 react-markdown / marked：全站语料实测（345 张卡片 content 逐行扫描）只用到
 * 二三级标题、段落、有序/无序列表、表格、围栏代码、引用、以及 `code` **粗** *斜* 三种行内标记，
 * 没有链接、图片、HTML 内联。为一个子集引入 20–40 KB 的解析器不划算，
 * 而且第三方渲染器默认吐 dangerouslySetInnerHTML 或 <a>，反而要多做一层白名单。
 *
 * 本实现全程只产出 ReactNode（文本节点由 React 转义），不接受任何原始 HTML —— 语料是仓库内自产的，
 * 但渲染路径不留 XSS 面仍是硬要求。
 *
 * 已知边界（如实说明，不做静默兜底）：
 *   · 嵌套列表会被拍平（语料里只有 7 行，缩进层级不影响语义）
 *   · 表格单元格里的竖线会切断单元格（语料里没有这种写法）
 *   · 围栏行必须独占一行；```| xxx | 这种「代码围栏与表格挤在一行」的写法不切换围栏状态，
 *     按普通文本渲染（ds-ch05-03 一张卡片的历史写法，见 docs/阶段10最终验收报告.md 已知缺口）
 */
import type { CSSProperties, ReactNode } from 'react'
import { CodeBlock } from './CodeBlock'

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; head: string[]; rows: string[][] }

/** 围栏必须独占一行：``` 后面只允许跟语言标记。语料里有 ```| 表格行 | 的混写，不能当围栏 */
const FENCE = /^```([A-Za-z0-9_+-]*)[\t ]*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const UL = /^[\t ]*[-*+]\s+/
const OL = /^[\t ]*\d+[.)]\s+/
const TABLE_SEP = /^[\t ]*:?-{2,}:?[\t ]*$/

const isBlockStart = (line: string): boolean =>
  FENCE.test(line) || HEADING.test(line) || line.startsWith('|') || UL.test(line) || OL.test(line) || line.startsWith('>')

function splitRow(line: string): string[] {
  const cells = line.split('|')
  if ((cells[0] ?? '').trim() === '') cells.shift()
  if ((cells[cells.length - 1] ?? '').trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    const fence = FENCE.exec(line)
    if (fence) {
      const buf: string[] = []
      i += 1
      // 没有收尾围栏就吃到底：i 每轮必进，绝不原地打转
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      out.push({ kind: 'code', lang: fence[1] || 'text', code: buf.join('\n') })
      continue
    }

    if (line.trim() === '') {
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      out.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: (heading[2] ?? '').trim() })
      i += 1
      continue
    }

    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        rows.push(splitRow(lines[i] ?? ''))
        i += 1
      }
      let head: string[] = []
      let body = rows
      if (rows.length >= 2 && (rows[1] ?? []).length > 0 && (rows[1] ?? []).every((c) => TABLE_SEP.test(c))) {
        head = rows[0] ?? []
        body = rows.slice(2)
      }
      out.push({ kind: 'table', head, rows: body })
      continue
    }

    if (UL.test(line)) {
      const items: string[] = []
      while (i < lines.length && UL.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(UL, ''))
        i += 1
      }
      out.push({ kind: 'ul', items })
      continue
    }

    if (OL.test(line)) {
      const items: string[] = []
      while (i < lines.length && OL.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(OL, ''))
        i += 1
      }
      out.push({ kind: 'ol', items })
      continue
    }

    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''))
        i += 1
      }
      out.push({ kind: 'quote', text: buf.join(' ') })
      continue
    }

    const buf: string[] = [line]
    i += 1
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? '')) {
      buf.push(lines[i] ?? '')
      i += 1
    }
    out.push({ kind: 'para', text: buf.join('\n') })
  }
  return out
}

/**
 * 行内标记：`code`、**粗体**、*斜体*。
 * 反引号分支放在最前，所以 `int *p;` 里的星号不会被当成斜体（语料里这种写法非常多，
 * 顺序错了整段指针讲解都会被撕成 <em>）。斜体要求两侧非空白，避免 a * b * c 这类算式误伤。
 */
// 链接放在最前面，且 href 只认 `#` / `/` / `http(s)://` 开头 —— 这样 C 代码里的
// `int *op[3](int,int)`、`a[i](x)` 不会被当成 [文本](url) 撕开。
const INLINE = /(\[[^\]\n]+\]\((?:#|\/|https?:\/\/)[^)\s]*\)|`[^`]+`|\*\*(?!\s)[\s\S]+?(?<!\s)\*\*|\*(?!\s)[^*\n]+?(?<!\s)\*)/g

const inlineCodeStyle: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
}

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const token = m[0]
    if (token.startsWith('[')) {
      // 站内链接（HashRouter）：href="#/problems/p/xxx" 直接改 hash，路由自己接住
      const lm = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token)
      out.push(
        <a key={key++} href={lm?.[2] ?? '#'} className="underline decoration-dotted" style={{ color: 'var(--color-brand)' }}>
          {lm?.[1] ?? token}
        </a>,
      )
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key++} className="rounded px-1 py-0.5 font-mono text-[0.92em]" style={inlineCodeStyle}>
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const tableStyle: CSSProperties = { borderColor: 'var(--border)' }
const thStyle: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }

/** 把 Markdown 文本渲染成 React 节点。source 为空时返回 null（调用方自己决定是否显示空状态） */
export function Markdown({ source }: { source: string }) {
  if (!source || source.trim().length === 0) return null
  const blocks = parseMarkdown(source)
  return (
    <div className="space-y-3 text-sm leading-7" data-role="markdown">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm']
            const cls = sizes[Math.min(Math.max(block.level, 1), 6) - 1] ?? 'text-base'
            return (
              <h3 key={i} className={`${cls} mt-4 font-semibold`} style={{ color: 'var(--fg)' }}>
                {renderInline(block.text)}
              </h3>
            )
          }
          case 'para':
            return (
              <p key={i} className="whitespace-pre-wrap">
                {renderInline(block.text)}
              </p>
            )
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol className="list-decimal space-y-1 pl-5" key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote
                key={i}
                className="rounded-r border-l-4 py-1 pl-3 text-sm"
                style={{ borderColor: 'var(--color-viz-compare)', background: 'var(--bg-elev)', color: 'var(--fg-muted)' }}
              >
                {renderInline(block.text)}
              </blockquote>
            )
          case 'code':
            return <CodeBlock key={i} code={block.code} lang={block.lang || 'text'} />
          case 'table': {
            const cols = Math.max(block.head.length, ...block.rows.map((r) => r.length), 1)
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-xs" data-role="md-table">
                  {block.head.length > 0 && (
                    <thead>
                      <tr>
                        {Array.from({ length: cols }, (_, c) => (
                          <th key={c} className="border px-2 py-1 text-left font-semibold" style={thStyle}>
                            {renderInline(block.head[c] ?? '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {Array.from({ length: cols }, (_, c) => (
                          <td key={c} className="border px-2 py-1 align-top" style={tableStyle}>
                            {renderInline(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          default:
            return null
        }
      })}
    </div>
  )
}
