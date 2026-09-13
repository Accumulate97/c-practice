/**
 * 游乐场代码编辑器（任务 3-1）。
 *
 * 为什么不用现成的 CodeEditor（受控 textarea）：游乐场的核心诉求是「错误诊断高亮」——
 * Godbolt 回来的 CompileDiag 带 line/column，必须能把出错行在编辑器里标出来、
 * 点一下诊断条目就能跳过去。textarea 只能整块变色，做不到按行标注，所以这里上 CodeMirror 6
 * （依赖已经在 package.json 里，程序填空题的 BlankCodeEditor 已经在用，不新增体积来源）。
 *
 * 与 BlankCodeEditor 的分工：那个是「只让改空位」的答题编辑器，这个是「随便改」的自由编辑器，
 * 两者的语法高亮配色走同一组 CSS 变量，所以深浅主题下观感一致。
 *
 * 诊断高亮的实现口径：诊断是**外部数据**（来自后端），不是文档内容，
 * 所以用 StateEffect/StateField 存，不进文档；重跑覆盖、清空即撤，不会把标记写进用户代码里。
 */
import { useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { cpp } from '@codemirror/lang-cpp'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as T } from '@lezer/highlight'
import type { CompileDiag } from '../../judge/types'
import { MONO_FONT } from './CodeEditor'

export interface PlaygroundEditorHandle {
  /** 把某一行滚到视野中间（点诊断条目时用） */
  revealLine: (line: number) => void
  focus: () => void
}

interface Props {
  value: string
  onChange: (next: string) => void
  /** Ctrl/Cmd+Enter 运行：与判分页、JudgeLab 同一个肌肉记忆 */
  onRun?: () => void
  /** 后端回来的编译诊断，直接画在对应行上 */
  diagnostics?: readonly CompileDiag[]
  disabled?: boolean
  ariaLabel?: string
  /** 编辑器最小高度（px）。窄屏上给小一点，别把输出面板挤到屏幕外 */
  minHeight?: number
  ref?: React.Ref<PlaygroundEditorHandle>
}

/** 诊断集合走 effect 注入：StateField 只认 effect，不做「值变了就 dispatch」的隐式同步 */
const setDiags = StateEffect.define<readonly CompileDiag[]>()

const diagField = StateField.define<readonly CompileDiag[]>({
  create: () => [],
  update(value, tr) {
    let next = value
    for (const e of tr.effects) if (e.is(setDiags)) next = e.value
    return next
  },
})

/** 行底色：错误用 --fg-bad 的低透明版本，警告用 --fg-warn；不覆盖选中色 */
const diagLineDecorations = EditorView.decorations.compute([diagField], (state) => {
  const diags = state.field(diagField)
  if (diags.length === 0) return Decoration.none
  const perLine = new Map<number, 'error' | 'warning'>()
  for (const d of diags) {
    if (!Number.isFinite(d.line) || d.line < 1) continue
    const prev = perLine.get(d.line)
    // 同一行既有 error 又有 warning 时按 error 画（红比黄更要紧）
    if (d.severity === 'error' || prev === undefined) perLine.set(d.line, d.severity)
  }
  const ranges: Range<Decoration>[] = []
  for (const [line, sev] of perLine) {
    if (line > state.doc.lines) continue
    const pos = state.doc.line(line)
    ranges.push(
      Decoration.line({
        class: sev === 'error' ? 'cm-diag-line-error' : 'cm-diag-line-warn',
        attributes: { 'data-diag-severity': sev },
      }).range(pos.from),
    )
  }
  return Decoration.set(ranges, true)
})

class DiagGutterMark extends GutterMarker {
  constructor(readonly sev: 'error' | 'warning') {
    super()
    this.elementClass = sev === 'error' ? 'cm-diag-gutter-error' : 'cm-diag-gutter-warn'
  }

  toDOM(): Node {
    // 行号槽是 aria-hidden 的装饰区，符号只给视力正常的人看；
    // 屏幕阅读器读的是下面诊断列表里的完整文字（含行列号）
    return document.createTextNode(this.sev === 'error' ? '✕' : '!')
  }
}

const ERROR_MARK = new DiagGutterMark('error')
const WARN_MARK = new DiagGutterMark('warning')

const diagGutter = gutter({
  class: 'cm-diag-gutter',
  // lineMarker 收到的是 BlockInfo（没有 .number），行号得自己从文档里问
  lineMarker(view, line) {
    const diags = view.state.field(diagField)
    const no = view.state.doc.lineAt(line.from).number
    let hit: 'error' | 'warning' | null = null
    for (const d of diags) {
      if (d.line !== no) continue
      if (d.severity === 'error') { hit = 'error'; break }
      hit = 'warning'
    }
    return hit === null ? null : hit === 'error' ? ERROR_MARK : WARN_MARK
  },
})

const cHighlight = HighlightStyle.define([
  { tag: T.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [T.keyword, T.modifier, T.controlKeyword], color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: [T.string, T.character], color: 'var(--code-string)' },
  { tag: [T.number, T.bool, T.null], color: 'var(--code-number)' },
  { tag: [T.typeName, T.standard(T.typeName)], color: 'var(--code-type)' },
  { tag: [T.function(T.variableName), T.function(T.propertyName)], color: 'var(--code-func)' },
  { tag: [T.propertyName, T.variableName], color: 'var(--fg)' },
  { tag: [T.operator, T.punctuation, T.operatorKeyword], color: 'var(--code-op)' },
  { tag: T.processingInstruction, color: 'var(--code-preproc)' },
  { tag: T.invalid, color: 'var(--fg-bad)' },
])

const baseTheme = EditorView.theme({
  '&': {
    color: 'var(--fg)',
    backgroundColor: 'var(--bg-elev)',
    fontSize: '13px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  '&.cm-focused': { outline: '2px solid var(--color-brand)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: MONO_FONT, lineHeight: '20px', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--color-brand)', padding: '6px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg-muted)',
    borderRight: '1px solid var(--border)',
    fontFamily: MONO_FONT,
    fontSize: '12px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-line-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-line-active)', color: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-selection)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-brand)' },
  // 诊断高亮：底色用 color-mix 从语义色派生，深浅主题都自动适配，不写死 rgba
  '.cm-diag-line-error': { backgroundColor: 'color-mix(in srgb, var(--fg-bad) 14%, transparent)' },
  '.cm-diag-line-warn': { backgroundColor: 'color-mix(in srgb, var(--fg-warn) 16%, transparent)' },
  '.cm-diag-gutter': { minWidth: '14px', textAlign: 'center' },
  '.cm-diag-gutter-error': { color: 'var(--fg-bad)', fontWeight: '700' },
  '.cm-diag-gutter-warn': { color: 'var(--fg-warn)', fontWeight: '700' },
})

export function PlaygroundEditor(props: Props) {
  const {
    value,
    onChange,
    onRun,
    diagnostics = [],
    disabled = false,
    ariaLabel = 'C 代码编辑器（游乐场）',
    minHeight = 320,
  } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 回调放 ref：EditorView 只在挂载时建一次，闭包里必须读到最新的 onRun/onChange
  const cbRef = useRef({ onChange, onRun, disabled })
  cbRef.current = { onChange, onRun, disabled }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        baseTheme,
        syntaxHighlighting(cHighlight),
        cpp(),
        lineNumbers(),
        diagGutter,
        diagField,
        diagLineDecorations,
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(disabled),
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => { cbRef.current.onRun?.(); return true },
          },
          indentWithTab,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange(u.state.doc.toString())
        }),
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
        EditorView.editable.of(!disabled),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // 只在挂载时建一次。value 的外部变更由下面那个同步 effect 负责，
    // 依赖里放 value 会导致「每敲一个字就重建编辑器」，输入直接卡死。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部换内容（载入示例 / 从题目载入 / 清空）时同步进编辑器；用户自己打字不触发
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  // 诊断同步：重跑覆盖，清空即撤
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setDiags.of(diagnostics) })
  }, [diagnostics])

  useImperativeHandle(props.ref, () => ({
    revealLine(line: number) {
      const view = viewRef.current
      if (!view || !Number.isFinite(line) || line < 1 || line > view.state.doc.lines) return
      const pos = view.state.doc.line(line)
      view.dispatch({ selection: { anchor: pos.from }, effects: EditorView.scrollIntoView(pos.from, { y: 'center' }) })
      view.focus()
    },
    focus() { viewRef.current?.focus() },
  }), [])

  return <div ref={hostRef} data-role="playground-editor" className="min-w-0 overflow-hidden" style={{ minHeight }} />
}

