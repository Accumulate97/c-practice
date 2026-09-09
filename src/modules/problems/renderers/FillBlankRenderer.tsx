/**
 * 概念填空题（fill_blank）渲染器 —— 文本比对、即时判定，不编译不联网（阶段 5）。
 *
 * ── 与程序填空（code_completion）的分界 ─────────────────────────────────
 * code_completion 补的是 C 代码里的空位，判分要把整份程序拼起来送 Godbolt 跑测试用例；
 * fill_blank 补的是「一个词 / 一句话」（例如「C语言的源程序必须通过【1】和【2】后才能执行」），
 * 判分是文本比对，走 grading/text-match.ts 的 conceptMatches，一次网络请求都不发。
 *
 * ── 全库 89 道填空题的 blanks[].answer 目前都是空串 ──────────────────────
 * 这是提取阶段的既成数据缺口。红线是「宁可判不出来，也不判通过」：
 * 任何一空缺答案就整题标为数据缺陷、禁用提交按钮，绝不用空串当期望值
 * （否则学生什么都不填、点提交，143 个空会全部「匹配」成通过）。
 * 缺口在 UI 上如实说明，学生仍能看到题干与空位，只是不能在线判分。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordAttempt } from '../progress/store'
import { conceptMatches } from '../grading/text-match'
import {
  ActionRow, Button, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  TONE, control, muted, panel,
} from './concept-shared'

interface BlankSpec {
  /** schema 里 1 起 */
  index: number
  answer: string
  accepted?: string[]
}

type BlankTarget =
  | { kind: 'ok'; blanks: BlankSpec[] }
  | { kind: 'defect'; blanks: BlankSpec[]; missing: number[]; reason: string }

function blanksOf(problem: ProblemRecord): BlankSpec[] {
  const raw = problem.blanks
  if (!Array.isArray(raw)) return []
  const out: BlankSpec[] = []
  for (const [i, item] of raw.entries()) {
    const o = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const idx = typeof o.index === 'number' && Number.isInteger(o.index) && o.index >= 1 ? o.index : i + 1
    out.push({
      index: idx,
      answer: typeof o.answer === 'string' ? o.answer : '',
      accepted: Array.isArray(o.accepted) ? o.accepted.filter((a): a is string => typeof a === 'string') : undefined,
    })
  }
  return out
}

export function blankTarget(problem: ProblemRecord): BlankTarget {
  const blanks = blanksOf(problem)
  if (blanks.length === 0) {
    return { kind: 'defect', blanks, missing: [], reason: '分片里没有 blanks 数组：既不知道该挖几个空，也没有任何期望答案，无法作答也无法判分。' }
  }
  const missing = blanks.filter((b) => b.answer.trim().length === 0).map((b) => b.index)
  if (missing.length > 0) {
    return {
      kind: 'defect',
      blanks,
      missing,
      reason: `本题 ${blanks.length} 个空里有 ${missing.length} 个在数据中没有答案（第 ${missing.join('、')} 空）。用空串当期望会把「什么都没填」判成通过，所以整题禁用在线判分，只保留阅读。`,
    }
  }
  return { kind: 'ok', blanks }
}

interface BlankResult {
  index: number
  given: string
  expected: string
  matched: boolean
}

interface Props {
  problem: ProblemRecord
}

export function FillBlankRenderer({ problem }: Props) {
  const target = useMemo(() => blankTarget(problem), [problem])
  const blanks = target.blanks
  const gradeable = target.kind === 'ok'

  const [values, setValues] = useState<Record<number, string>>({})
  const [results, setResults] = useState<BlankResult[] | null>(null)

  const setValue = useCallback((index: number, text: string) => {
    setValues((prev) => ({ ...prev, [index]: text }))
  }, [])

  const filled = blanks.every((b) => (values[b.index] ?? '').trim().length > 0)

  const submit = useCallback(() => {
    if (!gradeable || !filled) return
    const next: BlankResult[] = blanks.map((b) => {
      const given = values[b.index] ?? ''
      return {
        index: b.index,
        given,
        expected: b.answer,
        matched: conceptMatches(given, b.answer, b.accepted),
      }
    })
    setResults(next)
    const ok = next.every((r) => r.matched)
    recordAttempt(problem.id, ok, {
      text: next.map((r) => `【${r.index}】${r.given.trim()}`).join('\n'),
      kind: 'text',
    })
  }, [blanks, filled, gradeable, problem.id, values])

  const reset = useCallback(() => {
    setValues({})
    setResults(null)
  }, [])

  const correctCount = results === null ? 0 : results.filter((r) => r.matched).length

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      {target.kind === 'defect' && (
        <DefectPanel
          title="本题无法在线判分（数据缺陷：答案为空）"
          body={target.reason}
          extra={
            <p className="mt-2 text-xs" style={muted}>
              题干里的【1】【2】就是要填的空位。想核对答案，请对照教材或问老师；这一题不会计入你的正确率与错题本。
            </p>
          }
        />
      )}

      <section className="rounded-xl border p-4" style={panel} data-role="blank-inputs" data-count={String(blanks.length)} data-answerable={gradeable ? 'true' : 'false'}>
        <h2 className="text-sm font-semibold" style={muted}>
          填 {blanks.length} 个空{gradeable ? '（大小写、全半角、首尾标点都不计较）' : '（本题不可判分，输入框只作草稿）'}
        </h2>
        <div className="mt-3 space-y-2">
          {blanks.map((b) => {
            const result = results?.find((r) => r.index === b.index) ?? null
            return (
              <div key={b.index} className="flex flex-wrap items-center gap-2" data-role="blank-row" data-index={String(b.index)}>
                <label className="w-16 shrink-0 text-xs" style={muted} htmlFor={`blank-${problem.id}-${b.index}`}>
                  第 {b.index} 空
                </label>
                <input
                  id={`blank-${problem.id}-${b.index}`}
                  className="min-w-40 flex-1 rounded-lg border px-2 py-1.5 text-sm outline-none"
                  style={control}
                  value={values[b.index] ?? ''}
                  disabled={!gradeable}
                  placeholder="填一个词或一句话"
                  onChange={(e) => setValue(b.index, e.target.value)}
                  data-role="blank-input"
                  data-index={String(b.index)}
                />
                {result !== null && (
                  <span className="text-xs" style={{ color: result.matched ? TONE.good : TONE.bad }} data-role="blank-mark">
                    {result.matched ? '✓' : `✗ 期望「${result.expected}」`}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {gradeable && (
          <div className="mt-3">
            <ActionRow>
              <Button onClick={submit} disabled={!filled} role="blank-submit" tone="good">提交判分</Button>
              <Button onClick={reset} role="blank-reset">清空重做</Button>
              {!filled && <span className="text-xs" style={muted}>还有空没填（空着提交等于交白卷，不予判分）。</span>}
            </ActionRow>
          </div>
        )}
      </section>

      {results !== null && (
        <VerdictBanner
          tone={correctCount === results.length ? 'good' : 'bad'}
          title={correctCount === results.length
            ? `✓ 全部 ${results.length} 空都填对了`
            : `✗ ${results.length} 空里对了 ${correctCount} 空`}
          detail={correctCount === results.length
            ? '已记入进度：本题标记为「已通过」。'
            : '只要有一空不符就整题算未通过（填空题的空是同一个答案的几个部分）。已记入错题本。'}
        >
          <ul className="mt-2 space-y-1 text-xs" style={muted} data-role="blank-results">
            {results.map((r) => (
              <li key={r.index} style={{ color: r.matched ? TONE.good : TONE.bad }}>
                【{r.index}】你填「{r.given.trim()}」{r.matched ? '✓' : `，期望「${r.expected}」`}
              </li>
            ))}
          </ul>
        </VerdictBanner>
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
