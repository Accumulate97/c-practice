/**
 * 只读代码块（阶段 10-1）：C 语法高亮 + 一键复制。
 *
 * 为什么不用 CodeMirror：知识卡片详情页一个页面可能有 3–5 段示例代码，
 * CodeMirror 6 那套（state/view/language/commands/autocomplete + lang-cpp）是给「可编辑空位槽」用的，
 * 展示型代码用它等于把编辑器内核拖进知识板块。这里用一个 ~70 行的单遍扫描着色器，
 * 颜色全部走 global.css 里已有的 --code-* 令牌，深浅色主题自动跟随，零依赖、零额外 chunk。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

const KEYWORDS = new Set(
  'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Alignas _Alignof _Noreturn'.split(' '),
)
/** 标准库里的常见类型名与常量：不是关键字，但按类型着色更易读 */
const TYPE_NAMES = new Set(
  'size_t ptrdiff_t time_t clock_t FILE va_list div_t ldiv_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t NULL EOF true false bool SqList LinkList SeqStack SeqQueue BinaryTree'.split(' '),
)

/**
 * 单遍扫描：注释 → 字符串/字符常量 → 预处理行 → 数字 → 标识符 → 运算符。
 * 分支顺序就是优先级（同一位置从左往右试），所以字符串里的 # 与 // 不会被误判成预处理/注释。
 * 预处理行整行吃掉（含 <stdio.h>），与主流高亮器口径一致。
 */
const TOKEN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[\t ]*#[^\n]*)|(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?[uUlL]*\b)|([A-Za-z_]\w*)|([+\-*/%=&|^!~<>?:]+|[{}()[\];,.])/gm

const COLOR: Record<string, string> = {
  comment: 'var(--code-comment)',
  string: 'var(--code-string)',
  preproc: 'var(--code-preproc)',
  number: 'var(--code-number)',
  keyword: 'var(--code-keyword)',
  type: 'var(--code-type)',
  func: 'var(--code-func)',
  op: 'var(--code-op)',
}

/** 把一段 C 源码切成带色 span。返回 ReactNode 数组，交给 <code> 直接渲染（React 自动转义，无 XSS 面） */
export function highlightC(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  const push = (text: string, kind?: string): void => {
    if (text.length === 0) return
    if (kind === undefined) {
      out.push(text)
      return
    }
    out.push(
      <span key={key++} style={{ color: COLOR[kind] }}>
        {text}
      </span>,
    )
  }
  TOKEN.lastIndex = 0
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) push(code.slice(last, at))
    const text = m[0]
    let kind = 'op'
    if (m[1] !== undefined) kind = 'comment'
    else if (m[2] !== undefined) kind = 'string'
    else if (m[3] !== undefined) kind = 'preproc'
    else if (m[4] !== undefined) kind = 'number'
    else if (m[5] !== undefined) {
      if (KEYWORDS.has(text)) kind = 'keyword'
      else if (TYPE_NAMES.has(text)) kind = 'type'
      else if (/^\s*\(/.test(code.slice(at + text.length))) kind = 'func'
      else if (/^[A-Z][A-Z0-9_]*$/.test(text)) kind = 'type'
      else kind = 'plain'
    }
    push(text, kind === 'plain' ? undefined : kind)
    last = at + text.length
  }
  if (last < code.length) push(code.slice(last))
  return out
}

interface Props {
  code: string
  /** 展示在标题条上的语言标记，仅用于说明，不参与解析 */
  lang?: string
  title?: string
  showCopy?: boolean
  dataRole?: string
}

export function CodeBlock({ code, lang = 'c', title, showCopy = true, dataRole = 'code-block' }: Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const onCopy = useCallback(() => {
    const done = (ok: boolean): void => {
      if (!ok) return
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    // Clipboard API 只在安全上下文可用（https / localhost）；file:// 或旧浏览器走 execCommand 兜底
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => done(true),
        () => done(fallbackCopy(code)),
      )
      return
    }
    done(fallbackCopy(code))
  }, [code])

  return (
    <div className="overflow-hidden rounded-lg border" style={panel} data-role={dataRole}>
      <div
        className="flex items-center gap-2 border-b px-3 py-1.5 text-xs"
        style={{ borderColor: 'var(--border)', ...muted }}
      >
        <span className="font-mono">{lang}</span>
        {title && <span className="truncate">{title}</span>}
        {showCopy && (
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? '已复制到剪贴板' : '复制这段代码'}
            data-role="copy-code"
            data-copied={copied ? 'true' : 'false'}
            className="ml-auto shrink-0 rounded border px-2 py-0.5 text-xs hover:underline"
            style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
        )}
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-5">
        <code className="font-mono" style={{ color: 'var(--fg)' }}>
          {highlightC(code.replace(/\n$/, ''))}
        </code>
      </pre>
    </div>
  )
}

/** execCommand 兜底：选中一个临时 textarea 再复制。失败返回 false，按钮不谎报「已复制」 */
function fallbackCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'readonly')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const doc = document as Document & { execCommand?: (command: string) => boolean }
    const ok = doc.execCommand?.('copy') === true
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
