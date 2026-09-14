/**
 * CodeMirror 6 空位编辑器（阶段 4 模块 3）：把程序填空题里的空位标记渲染成行内输入槽。
 *
 * 用户裁决：模块 1 的 CodeEditor 先用受控 textarea，等模块 3 需要 Decoration 行内空位槽时再
 * npm i CodeMirror 6 —— 本组件就是那次安装的产物（@codemirror/state|view|language|commands|
 * lang-cpp + @lezer/highlight；不引入 clang-format WASM，也不引入 codemirror 元包里的多余套件）。
 *
 * 四条设计决定，改之前先读：
 *   1. 空位是**文档里的真实区间**，不是覆盖层。挂载时把标记替换成初始填写（通常为空串），
 *      用 StateField 记住每个空位的 [from,to)，随文档变更 mapPos 跟随。学生在槽里打字即改文档，
 *      取值 = state.sliceDoc(from,to)，不存在「显示与数据两套真相」。
 *   2. 槽外只读。transactionFilter 拒绝任何不是完整落在某个空位内的改动，
 *      也拒绝往空位里塞换行（空位保持单行）。理由：判分是「按空位拼装后实机运行」，
 *      学生若改了题目给定的代码，判分结果就不再描述他填的答案 —— 与其静默忽略，不如不许改。
 *      被拒绝时回调 onBlockedEdit，UI 给一句人话提示，不做静默吞键。
 *   3. Tab / Shift-Tab 在空位间循环跳转（Prec.high 抢在默认缩进键位之前）。
 *      跳转时把整个空位选中，接着打字即整体替换 —— 这是填空题最常见的操作序列。
 *   4. 空位视觉：常驻编号徽标（WidgetType）+ 有内容时的底色下划线（mark Decoration），
 *      光标落在哪个空位就加 cm-blank-focus 高亮。徽标用 widget 而不是 mark，
 *      因为空位没填时区间长度为 0，mark 装饰画不出任何东西。
 */
import { useEffect, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import { Compartment, EditorState, Prec, StateField } from '@codemirror/state'
import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import type { Command, DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as T } from '@lezer/highlight'
import { cpp } from '@codemirror/lang-cpp'
import { MONO_FONT } from './CodeEditor'
import { useMobileEditor } from './useMobileEditor'

/** 与 grading/blank-match.ts 的 SlotMark 同构；这里自带一份，避免 components 反向依赖 modules */
export interface BlankSlotSpec {
  index: number
  start: number
  end: number
}

/** 键为 blank.index，值为该空位当前的文本 */
export type BlankSlotValues = Record<number, string>

export interface BlankEditorHandle {
  /** 把光标移到指定编号的空位并整体选中，用于「空位清单」里的定位按钮 */
  focusSlot(index: number): void
  focus(): void
  /** 当前文档里各空位的取值（与 onChange 抛出的同一份口径） */
  values(): BlankSlotValues
}

interface Props {
  /** 含空位标记的原始代码 */
  template: string
  /** 标记在 template 里的区间（文档顺序） */
  slots: BlankSlotSpec[]
  /** 仅挂载时使用；重置请让父组件换 React key 重挂，避免受控/非受控两套状态打架 */
  initialValues?: BlankSlotValues
  onChange?: (values: BlankSlotValues) => void
  onActiveSlot?: (index: number | null) => void
  onBlockedEdit?: () => void
  disabled?: boolean
  ariaLabel?: string
  ref?: Ref<BlankEditorHandle>
}

/** 编辑器内部跟踪的空位区间（文档坐标） */
interface Slot {
  index: number
  from: number
  to: number
}

/** 每个编辑器实例一份：imperative handle 靠它拿到本实例的 StateField，不搞模块级共享 */
interface Internals {
  view: EditorView | null
  slotsField: StateField<Slot[]> | null
}

/** disabled 的热切换通道。Compartment 是设计成可共享的单例：每个 EditorState 各存一份配置 */
const disabledCompartment = new Compartment()
const readOnlyExt: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false)]

/** 把标记换成初始填写，同时算出每个空位在新文档里的区间 */
function buildInitialDoc(template: string, specs: BlankSlotSpec[], values: BlankSlotValues | undefined): { doc: string; slots: Slot[] } {
  const ordered = specs.slice().sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  const slots: Slot[] = []
  for (const s of ordered) {
    if (s.start < cursor) continue // 区间重叠属数据缺陷，completionTarget 已在上游拦过
    out += template.slice(cursor, s.start)
    const raw = values ? values[s.index] : undefined
    const text = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n') : ''
    const from = out.length
    out += text
    slots.push({ index: s.index, from, to: out.length })
    cursor = s.end
  }
  out += template.slice(cursor)
  return { doc: out, slots }
}

/** 编号徽标。eq 必须实现，否则每次重建装饰都会换 DOM 节点：闪烁且可能丢焦点 */
class BlankBadge extends WidgetType {
  private readonly index: number
  private readonly active: boolean

  constructor(index: number, active: boolean) {
    super()
    this.index = index
    this.active = active
  }

  eq(other: BlankBadge): boolean {
    return other.index === this.index && other.active === this.active
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.active ? 'cm-blank-badge cm-blank-badge-active' : 'cm-blank-badge'
    span.textContent = String(this.index)
    span.title = '空位 ' + String(this.index)
    return span
  }

  // 交给 CM 处理点击：点徽标等于把光标落到该空位起点
  ignoreEvent(): boolean {
    return false
  }
}

/** 语法高亮配色走 CSS 变量：深浅色主题切换时不必重建编辑器 */
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
    fontSize: 'var(--cp-code-fs, 13px)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden',
    maxHeight: '62vh',
  },
  '&.cm-focused': { outline: '2px solid var(--color-brand)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: MONO_FONT, lineHeight: 'var(--cp-code-lh, 20px)', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--color-brand)', padding: '6px 0 var(--cp-code-pad-b, 0px)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg-muted)',
    borderRight: '1px solid var(--border)',
    fontFamily: MONO_FONT,
    fontSize: 'var(--cp-gutter-fs, 12px)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-line-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-line-active)', color: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-selection)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-brand)' },
})

export function BlankCodeEditor(props: Props) {
  const { template, slots, initialValues, disabled = false, ariaLabel = '程序填空代码编辑器' } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const internals = useRef<Internals>({ view: null, slotsField: null })
  // useMobileEditor 要在软键盘弹起时把光标滚回可视区，得能拿到 view；
  // internals.current.view 是给命令式 API 用的，两者在同一个 effect 里同步赋值/清空。
  const viewRef = useRef<EditorView | null>(null)
  // 任务 4-2：移动端字号 / 行高 / 键盘遮挡适配（口径与游乐场编辑器完全一致，见 useMobileEditor）
  useMobileEditor(viewRef, hostRef)
  // 回调放进 ref：EditorView 只在挂载时建一次，闭包里读到的必须是最新的 onChange
  const cbRef = useRef({ onChange: props.onChange, onActiveSlot: props.onActiveSlot, onBlockedEdit: props.onBlockedEdit })
  cbRef.current = { onChange: props.onChange, onActiveSlot: props.onActiveSlot, onBlockedEdit: props.onBlockedEdit }
  const initRef = useRef<BlankSlotValues | undefined>(initialValues)
  const disabledRef = useRef(disabled)

  // 用「模板 + 标记区间」的内容签名做依赖：父组件每次渲染都可能给出新的数组身份，
  // 直接依赖数组会让编辑器反复销毁重建（打到一半被清空）。
  const signature =
    template + '\u0000' + slots.map((s) => String(s.index) + ':' + String(s.start) + ':' + String(s.end)).join(',')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const built = buildInitialDoc(template, slots, initRef.current)
    const extensions = createExtensions(built.slots, cbRef, internals, disabledRef.current)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: built.doc, extensions }),
    })
    internals.current.view = view
    viewRef.current = view
    return () => {
      view.destroy()
      internals.current.view = null
      viewRef.current = null
      internals.current.slotsField = null
    }
    // 只认内容签名：template / slots 的身份变化但内容相同时不重建
  }, [signature])

  useEffect(() => {
    const view = internals.current.view
    if (!view || disabledRef.current === disabled) return
    disabledRef.current = disabled
    // 热切换而不是重建：重建会丢光标位置与 undo 历史
    view.dispatch({ effects: disabledCompartment.reconfigure(disabled ? readOnlyExt : []) })
  }, [disabled])

  useImperativeHandle(
    props.ref,
    (): BlankEditorHandle => ({
      focusSlot(index: number) {
        const { view, slotsField } = internals.current
        if (!view || !slotsField) return
        const target = view.state.field(slotsField).find((s) => s.index === index)
        if (!target) return
        view.dispatch({
          selection: { anchor: target.from, head: target.to },
          scrollIntoView: true,
          userEvent: 'select.blank',
        })
        view.focus()
      },
      focus() {
        internals.current.view?.focus()
      },
      values() {
        const { view, slotsField } = internals.current
        if (!view || !slotsField) return {}
        return readValues(view, slotsField)
      },
    }),
    [],
  )

  return (
    <div
      ref={hostRef}
      className="cm-host"
      role="group"
      aria-label={ariaLabel}
      data-readonly={disabled ? 'true' : 'false'}
    />
  )
}

function readValues(view: EditorView, slotsField: StateField<Slot[]>): BlankSlotValues {
  const out: BlankSlotValues = {}
  for (const s of view.state.field(slotsField)) out[s.index] = view.state.sliceDoc(s.from, s.to)
  return out
}

type CbRef = {
  current: {
    onChange?: Props['onChange']
    onActiveSlot?: Props['onActiveSlot']
    onBlockedEdit?: Props['onBlockedEdit']
  }
}

function createExtensions(initialSlots: Slot[], cbRef: CbRef, internals: { current: Internals }, startDisabled: boolean): Extension[] {
  const slotsField = StateField.define<Slot[]>({
    create: () => initialSlots.map((s) => ({ ...s })),
    update: (slots, tr) => {
      if (!tr.docChanged) return slots
      // from 用 -1、to 用 +1：在空位边界处打字算「写进空位」，区间跟着长大
      return slots.map((s) => ({ index: s.index, from: tr.changes.mapPos(s.from, -1), to: tr.changes.mapPos(s.to, 1) }))
    },
  })
  internals.current.slotsField = slotsField

  const decoField = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, slotsField),
    update: (deco, tr) => {
      // 文档与选区都没动就不必重算（装饰不依赖视口）
      if (!tr.docChanged && tr.selection === undefined) return deco
      return buildDecorations(tr.state, slotsField)
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  const jumpSlot = (dir: 1 | -1): Command => (view) => {
    const slots = view.state.field(slotsField)
    if (slots.length === 0) return false
    const target = pickSlot(slots, view.state.selection.main.head, dir)
    if (!target) return false
    view.dispatch({
      selection: { anchor: target.from, head: target.to },
      scrollIntoView: true,
      userEvent: 'select.blank',
    })
    cbRef.current.onActiveSlot?.(target.index)
    return true
  }

  return [
    slotsField,
    decoField,
    baseTheme,
    syntaxHighlighting(cHighlight),
    cpp(),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    EditorView.lineWrapping,
    disabledCompartment.of(startDisabled ? readOnlyExt : []),
    // 槽外只读：拒绝不完整落在某个空位内的改动，也拒绝把换行塞进空位
    Prec.high(
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged) return tr
        const slots = tr.startState.field(slotsField)
        let allowed = true
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          if (inserted.toString().includes('\n')) allowed = false
          if (!slots.some((s) => fromA >= s.from && toA <= s.to)) allowed = false
        })
        if (allowed) return tr
        // 过滤器里不能直接 setState（会在派发中途调 React），推到微任务里报信
        queueMicrotask(() => cbRef.current.onBlockedEdit?.())
        return []
      }),
    ),
    Prec.high(
      keymap.of([
        { key: 'Tab', run: jumpSlot(1), preventDefault: true },
        { key: 'Shift-Tab', run: jumpSlot(-1), preventDefault: true },
        { key: 'Alt-ArrowDown', run: jumpSlot(1) },
        { key: 'Alt-ArrowUp', run: jumpSlot(-1) },
      ]),
    ),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) cbRef.current.onChange?.(readValues(u.view, slotsField))
      const head = u.state.selection.main.head
      const active = u.state.field(slotsField).find((s) => head >= s.from && head <= s.to)
      cbRef.current.onActiveSlot?.(active ? active.index : null)
    }),
    EditorView.contentAttributes.of({
      'aria-label': '程序填空代码（只有空位可以编辑）',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
    }),
  ]
}

function buildDecorations(state: EditorState, slotsField: StateField<Slot[]>): DecorationSet {
  const slots = state.field(slotsField)
  const head = state.selection.main.head
  const ranges: Range<Decoration>[] = []
  for (const s of slots) {
    const active = head >= s.from && head <= s.to
    ranges.push(Decoration.widget({ widget: new BlankBadge(s.index, active), side: -1 }).range(s.from))
    if (s.to > s.from) {
      ranges.push(
        Decoration.mark({
          class: active ? 'cm-blank cm-blank-focus' : 'cm-blank',
          attributes: { 'data-blank': String(s.index) },
        }).range(s.from, s.to),
      )
    }
  }
  return Decoration.set(ranges, true)
}

/** Tab / Shift-Tab 的落点：光标在某空位里就取它的下一个/上一个（循环），否则取最近的一个 */
function pickSlot(slots: Slot[], head: number, dir: 1 | -1): Slot | null {
  if (slots.length === 0) return null
  const inside = slots.findIndex((s) => head >= s.from && head <= s.to)
  if (inside >= 0) {
    const n = slots.length
    return slots[(inside + dir + n) % n] ?? null
  }
  if (dir > 0) {
    const next = slots.find((s) => s.from >= head)
    return next ?? slots[0] ?? null
  }
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const s = slots[i]
    if (s && s.to <= head) return s
  }
  return slots[slots.length - 1] ?? null
}
