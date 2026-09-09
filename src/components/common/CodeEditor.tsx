import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

interface Props {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** 可视行数，决定高度（每行 20px） */
  rows?: number
  ariaLabel?: string
}

const INDENT = '    '
const LINE_HEIGHT = 20
export const MONO_FONT = "ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, 'Courier New', monospace"

/**
 * 共享代码编辑器（阶段 4 模块 1 的最简实现：受控 textarea + 行号槽 + Tab 缩进）。
 *
 * 用户裁决 (a)：模块 1 不上 CodeMirror 6，等模块 3 需要把 BLANK 占位符渲染成
 * 可 Tab 跳转的行内输入槽（Decoration）时再 npm i。届时替换本组件内部实现即可，
 * 对外仍是 value / onChange 受控接口，调用方（各 Renderer）一行都不用改。
 */
export function CodeEditor({ value, onChange, disabled = false, rows = 16, ariaLabel = 'C 代码编辑器' }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const lineCount = value.split('\n').length

  const syncScroll = useCallback(() => {
    const area = areaRef.current
    const gutter = gutterRef.current
    if (area && gutter) gutter.scrollTop = area.scrollTop
  }, [])

  useEffect(() => {
    syncScroll()
  }, [syncScroll, value])

  // Tab 默认会把焦点移出编辑器（键盘用户直接掉出答题区），拦下来改成插入 4 空格。
  // 教材代码风格约定用 4 空格缩进，不用制表符。
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled || event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const area = event.currentTarget
    const start = area.selectionStart
    const end = area.selectionEnd
    onChange(value.slice(0, start) + INDENT + value.slice(end))
    // 受控组件的值要等 React 重渲染后才落到 DOM，光标位置只能在下一帧设
    requestAnimationFrame(() => {
      area.selectionStart = start + INDENT.length
      area.selectionEnd = start + INDENT.length
    })
  }

  return (
    <div
      className="flex overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
    >
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="shrink-0 overflow-hidden select-none py-2 text-right"
        style={{
          width: 52,
          fontFamily: MONO_FONT,
          fontSize: 13,
          lineHeight: `${LINE_HEIGHT}px`,
          color: 'var(--fg-muted)',
          background: 'var(--bg)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="pr-2">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={areaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        disabled={disabled}
        rows={rows}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        className="w-full resize-y bg-transparent px-3 py-2 outline-none"
        style={{
          fontFamily: MONO_FONT,
          fontSize: 13,
          lineHeight: `${LINE_HEIGHT}px`,
          color: 'var(--fg)',
          tabSize: 4,
          minHeight: rows * LINE_HEIGHT + 16,
        }}
      />
    </div>
  )
}