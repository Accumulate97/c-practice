/**
 * 程序排序题（code_ordering）渲染器 —— 顺序比对，纯前端、不联网（阶段 5）。
 *
 * 【库内现状：0 道】518 题里没有一道 code_ordering；渲染器按 schema 完整实现，数据一到即可用。
 *
 * ── schema 的形状 ───────────────────────────────────────────────────
 *   lines[]         已经打乱的代码行（数据侧负责打乱，前端不再随机，否则每次刷新顺序都变）
 *   correct_order[] 正确顺序，元素是 lines 的下标
 *   testCases[]     schema 要求存在，但本渲染器**不跑它**：排序题的判分结论完全由
 *                   「行的相对顺序」决定，顺序对了拼出来的程序就是数据里那一份（构建期
 *                   已经 judge:verify 实机验证过），再打一次 Godbolt 只是白耗额度。
 *                   将来若出现「顺序对但拼不出可编译程序」的数据，应改用实机对照，
 *                   口径参照 code_reading 的 runReadingSelfCheck（可选、结论不覆盖主判分）。
 *
 * ── 交互 ───────────────────────────────────────────────────────────
 * 拖拽（HTML5 原生 drag & drop，零依赖）与「上移 / 下移」按钮并存：
 * 触屏与键盘用户拖不动，按钮是无障碍兜底，两者操作同一个 order 数组。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordAttempt } from '../progress/store'
import {
  ActionRow, Button, CodeBlock, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  TONE, control, muted, panel,
} from './concept-shared'
import { MONO_FONT } from '../../../components/common/CodeEditor'

type OrderingTarget =
  | { kind: 'ok'; lines: string[]; correctOrder: number[] }
  | { kind: 'defect'; reason: string }

export function orderingTarget(problem: ProblemRecord): OrderingTarget {
  const lines = Array.isArray(problem.lines) ? problem.lines.map((l) => (typeof l === 'string' ? l : '')) : []
  const raw = problem.correct_order
  const order = Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : []
  if (lines.length === 0) {
    return { kind: 'defect', reason: 'lines 字段为空：没有任何可排的行（数据缺陷）。' }
  }
  if (order.length !== lines.length) {
    return { kind: 'defect', reason: `correct_order 有 ${order.length} 项，lines 有 ${lines.length} 行：两者必须一一对应，否则「正确顺序」本身不成立（数据缺陷）。` }
  }
  const seen = new Set<number>()
  for (const n of order) {
    if (!Number.isInteger(n) || n < 0 || n >= lines.length || seen.has(n)) {
      return { kind: 'defect', reason: `correct_order 不是 0–${lines.length - 1} 的一个排列（出现越界或重复下标 ${String(n)}），无法判分（数据缺陷）。` }
    }
    seen.add(n)
  }
  return { kind: 'ok', lines, correctOrder: order }
}

interface Props {
  problem: ProblemRecord
}

export function CodeOrderingRenderer({ problem }: Props) {
  const target = useMemo(() => orderingTarget(problem), [problem])
  const gradeable = target.kind === 'ok'
  const lines = target.kind === 'ok' ? target.lines : []
  const [order, setOrder] = useState<number[]>(() => lines.map((_, i) => i))
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [passed, setPassed] = useState<boolean | null>(null)

  const move = useCallback((pos: number, delta: number) => {
    setOrder((prev) => {
      const to = pos + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const a = next[pos] ?? 0
      next[pos] = next[to] ?? 0
      next[to] = a
      return next
    })
    setPassed(null)
  }, [])

  const dropAt = useCallback((pos: number) => {
    setOrder((prev) => {
      if (dragFrom === null || dragFrom === pos) return prev
      const next = [...prev]
      const [moved] = next.splice(dragFrom, 1)
      next.splice(pos, 0, moved ?? 0)
      return next
    })
    setDragFrom(null)
    setPassed(null)
  }, [dragFrom])

  const reset = useCallback(() => {
    setOrder(lines.map((_, i) => i))
    setPassed(null)
  }, [lines])

  const submit = useCallback(() => {
    if (!gradeable || target.kind !== 'ok') return
    const ok = order.length === target.correctOrder.length && order.every((v, i) => v === target.correctOrder[i])
    setPassed(ok)
    recordAttempt(problem.id, ok, {
      text: order.map((lineIdx) => lines[lineIdx] ?? '').join('\n'),
      kind: 'code',
    })
  }, [gradeable, lines, order, problem.id, target])

  const assembled = order.map((lineIdx) => lines[lineIdx] ?? '').join('\n')

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      {target.kind === 'defect' && <DefectPanel title="本题无法在线判分（数据缺陷）" body={target.reason} />}

      {gradeable && (
        <>
          <section className="rounded-xl border p-4" style={panel} data-role="ordering-lines" data-count={String(lines.length)}>
            <h2 className="text-sm font-semibold" style={muted}>把下面的行排成正确的程序（可拖拽，或用 ↑ ↓ 按钮）</h2>
            <ul className="mt-3 space-y-1">
              {order.map((lineIdx, pos) => (
                <li
                  key={lineIdx}
                  draggable
                  onDragStart={() => setDragFrom(pos)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropAt(pos)}
                  className="flex items-center gap-2 rounded-lg border px-2 py-1"
                  style={{ borderColor: dragFrom === pos ? TONE.warn : 'var(--border)', background: 'var(--bg)', cursor: 'grab' }}
                  data-role="ordering-row"
                  data-pos={String(pos)}
                  data-line={String(lineIdx)}
                >
                  <span className="w-6 shrink-0 text-right text-xs" style={muted}>{pos + 1}</span>
                  <code className="flex-1 overflow-x-auto whitespace-pre text-xs" style={{ fontFamily: MONO_FONT }}>
                    {(lines[lineIdx] ?? '').length === 0 ? <span style={muted}>（空行）</span> : lines[lineIdx]}
                  </code>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => move(pos, -1)} disabled={pos === 0} className="rounded border px-1.5 text-xs" style={control} aria-label="上移">↑</button>
                    <button type="button" onClick={() => move(pos, 1)} disabled={pos === order.length - 1} className="rounded border px-1.5 text-xs" style={control} aria-label="下移">↓</button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <ActionRow>
                <Button onClick={submit} tone="good" role="ordering-submit">提交判分</Button>
                <Button onClick={reset} role="ordering-reset">恢复初始顺序</Button>
              </ActionRow>
            </div>
          </section>

          <section className="rounded-xl border p-4" style={panel}>
            <CodeBlock code={assembled} title="按你当前顺序拼出来的程序（实时预览）" />
          </section>
        </>
      )}

      {passed !== null && target.kind === 'ok' && (
        <VerdictBanner
          tone={passed ? 'good' : 'bad'}
          title={passed ? '✓ 顺序完全正确' : '✗ 顺序还不对'}
          detail={passed
            ? '拼出来的程序与数据里那一份逐行相同（那一份构建期已实机验证过）。已记入进度：标记为「已通过」。'
            : `共 ${lines.length} 行，其中 ${order.filter((v, i) => v === target.correctOrder[i]).length} 行在正确位置上。已记入错题本。`}
        />
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
