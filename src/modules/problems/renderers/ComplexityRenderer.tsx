/**
 * 复杂度分析题（complexity）渲染器 —— 表达式归一化后比对，纯前端（阶段 5）。
 *
 * 【库内现状：0 道】518 题里没有一道 complexity；渲染器按 schema 完整实现，数据一到即可用。
 *
 * 判分口径：走 grading/text-match.ts 的 complexityMatches —— O(n^2) / o (n²) / O(n**2) /
 * 只写 n^2 都算同一个答案；但 O(n) 与 O(n²) 不会被归一成一个，不放宽到失去区分度。
 * answer 为空 → 数据缺陷、禁用提交（空期望会把交白卷判成通过）。
 *
 * askSpace=true 时问的是空间复杂度，题面文案与输入提示都要跟着变，
 * 否则学生会拿时间复杂度的答案去填空间复杂度的空。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordAttempt } from '../progress/store'
import { complexityMatches } from '../grading/text-match'
import {
  ActionRow, Button, CodeBlock, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  control, muted, panel,
} from './concept-shared'

type ComplexityTarget =
  | { kind: 'ok'; code: string; answer: string; accepted: string[]; askSpace: boolean }
  | { kind: 'defect'; code: string; askSpace: boolean; reason: string }

export function complexityTarget(problem: ProblemRecord): ComplexityTarget {
  const code = typeof problem.code === 'string' ? problem.code : ''
  const askSpace = problem.askSpace === true
  const rawAnswer = problem.answer
  const accepted = Array.isArray(problem.accepted) ? problem.accepted.filter((a): a is string => typeof a === 'string') : []
  if (typeof rawAnswer !== 'string' || rawAnswer.trim().length === 0) {
    return { kind: 'defect', code, askSpace, reason: 'answer 字段为空：没有期望的复杂度就无法判分（用空串当期望会把交白卷判成「通过」），故禁用提交。' }
  }
  if (code.trim().length === 0) {
    return { kind: 'defect', code, askSpace, reason: 'code 字段为空：没有可分析的程序，复杂度无从谈起（数据缺陷）。' }
  }
  return { kind: 'ok', code, answer: rawAnswer, accepted, askSpace }
}

interface Props {
  problem: ProblemRecord
}

export function ComplexityRenderer({ problem }: Props) {
  const target = useMemo(() => complexityTarget(problem), [problem])
  const gradeable = target.kind === 'ok'
  const askSpace = target.askSpace
  const label = askSpace ? '空间复杂度' : '时间复杂度'
  const [value, setValue] = useState('')
  const [passed, setPassed] = useState<boolean | null>(null)

  const submit = useCallback(() => {
    if (!gradeable || target.kind !== 'ok' || value.trim().length === 0) return
    const ok = complexityMatches(value, target.answer, target.accepted)
    setPassed(ok)
    recordAttempt(problem.id, ok, { text: `${label}：${value.trim()}`, kind: 'text' })
  }, [askSpace, gradeable, label, problem.id, target, value])

  const reset = useCallback(() => {
    setValue('')
    setPassed(null)
  }, [])

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      {target.kind === 'ok' ? (
        <section className="rounded-xl border p-4" style={panel}>
          <CodeBlock code={target.code} title="待分析的程序" />
        </section>
      ) : (
        <>
          {target.code.trim().length > 0 && (
            <section className="rounded-xl border p-4" style={panel}>
              <CodeBlock code={target.code} title="待分析的程序" />
            </section>
          )}
          <DefectPanel title="本题无法在线判分（数据缺陷）" body={target.reason} />
        </>
      )}

      <section className="rounded-xl border p-4" style={panel} data-role="complexity-input" data-ask={askSpace ? 'space' : 'time'} data-answerable={gradeable ? 'true' : 'false'}>
        <label className="text-sm font-semibold" style={muted} htmlFor={`cx-${problem.id}`}>
          写出这段程序的{label}
        </label>
        <input
          id={`cx-${problem.id}`}
          className="mt-2 w-full max-w-sm rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ ...control, fontFamily: 'var(--font-mono)' }}
          value={value}
          disabled={!gradeable}
          placeholder="例如 O(n^2)、O(n log n)、O(1)"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          data-role="complexity-field"
        />
        <p className="mt-1 text-xs" style={muted}>
          写法宽松：O(n^2) / o (n²) / O(n**2) / 只写 n^2 都算同一个答案；但 O(n) 与 O(n²) 不会混为一谈。
        </p>
        <div className="mt-3">
          <ActionRow>
            <Button onClick={submit} tone="good" disabled={!gradeable || value.trim().length === 0} role="complexity-submit">提交判分</Button>
            <Button onClick={reset} role="complexity-reset">清空重做</Button>
          </ActionRow>
        </div>
      </section>

      {passed !== null && target.kind === 'ok' && (
        <VerdictBanner
          tone={passed ? 'good' : 'bad'}
          title={passed ? `✓ 答对了：${label}是 ${target.answer}` : `✗ 答错了：你写「${value.trim()}」，正确的${label}是 ${target.answer}`}
          detail={passed ? '已记入进度：本题标记为「已通过」。' : '已记入错题本。想一想循环嵌套了几层、每层的次数与 n 是什么关系。'}
        />
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
