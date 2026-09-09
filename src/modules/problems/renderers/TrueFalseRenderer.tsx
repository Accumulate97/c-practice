/**
 * 判断题（true_false）渲染器 —— 即时判定，纯前端（阶段 5）。
 *
 * 【库内现状：0 道】整个题库 518 题里没有一道 true_false（提取阶段的原书体例只有
 * 选择 / 填空 / 简答 / 程序题四族）。渲染器按 schema 完整实现并挂在详情页的分派表上，
 * 将来数据一进来立刻能用；列表页的题型 chip 因为 count=0 会自动禁用，不会让学生点到空页。
 *
 * 判分口径：schema 规定 answer 是 boolean，判定就是「学生选的 === answer」。
 * answer 不是布尔值 → 数据缺陷、禁用作答（不猜「默认正确」）。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordAttempt } from '../progress/store'
import {
  ActionRow, Button, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  TONE, muted, panel,
} from './concept-shared'

type TfTarget =
  | { kind: 'ok'; answer: boolean }
  | { kind: 'defect'; reason: string }

export function trueFalseTarget(problem: ProblemRecord): TfTarget {
  const answer = problem.answer
  if (typeof answer === 'boolean') return { kind: 'ok', answer }
  return {
    kind: 'defect',
    reason: `schema 规定判断题的 answer 是 boolean，本题拿到的是 ${answer === undefined ? '缺失' : `${typeof answer}（${String(JSON.stringify(answer))}）`}：没有确定的正确答案就无法判分，交白卷也不该被判「通过」，故禁用作答。`,
  }
}

const CHOICES: { value: boolean; label: string; short: string }[] = [
  { value: true, label: '正确（这条叙述成立）', short: '正确' },
  { value: false, label: '错误（这条叙述不成立）', short: '错误' },
]

interface Props {
  problem: ProblemRecord
}

export function TrueFalseRenderer({ problem }: Props) {
  const target = useMemo(() => trueFalseTarget(problem), [problem])
  const gradeable = target.kind === 'ok'
  const answer = target.kind === 'ok' ? target.answer : null
  const [picked, setPicked] = useState<boolean | null>(null)
  const [passed, setPassed] = useState<boolean | null>(null)

  const choose = useCallback((value: boolean) => {
    if (!gradeable || answer === null) return
    const ok = value === answer
    setPicked(value)
    setPassed(ok)
    recordAttempt(problem.id, ok, { text: `我的判断：${value ? '正确' : '错误'}`, kind: 'choice' })
  }, [answer, gradeable, problem.id])

  const reset = useCallback(() => {
    setPicked(null)
    setPassed(null)
  }, [])

  const answered = picked !== null && passed !== null

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      {target.kind === 'defect' && <DefectPanel title="本题无法在线判分（数据缺陷）" body={target.reason} />}

      <section className="rounded-xl border p-4" style={panel} data-role="tf-options" data-answerable={gradeable ? 'true' : 'false'}>
        <h2 className="text-sm font-semibold" style={muted}>判断对错{gradeable ? '（点下去即时判定）' : '（本题不可判分）'}</h2>
        <ul className="mt-3 space-y-2">
          {CHOICES.map((c) => {
            const isPicked = picked === c.value
            const isCorrect = answered && answer === c.value
            const wrongPick = answered && isPicked && !isCorrect
            return (
              <li key={String(c.value)}>
                <label
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: isCorrect ? TONE.good : wrongPick ? TONE.bad : 'var(--border)', cursor: gradeable ? 'pointer' : 'not-allowed' }}
                  data-role="tf-option"
                  data-value={String(c.value)}
                  data-picked={isPicked ? 'true' : 'false'}
                  data-correct={isCorrect ? 'true' : 'false'}
                >
                  <input
                    type="radio"
                    name={`tf-${problem.id}`}
                    checked={isPicked}
                    disabled={!gradeable}
                    onChange={() => choose(c.value)}
                    aria-label={c.short}
                  />
                  <span>{c.label}</span>
                  {isCorrect && <span className="ml-auto text-xs" style={{ color: TONE.good }}>✓ 正确答案</span>}
                  {wrongPick && <span className="ml-auto text-xs" style={{ color: TONE.bad }}>✗ 你选的</span>}
                </label>
              </li>
            )
          })}
        </ul>
        {gradeable && (
          <div className="mt-3">
            <ActionRow>
              {/* 与 SingleChoiceRenderer 同一口径：没作答时不渲染灰掉的死按钮 */}
              {answered && <Button onClick={reset} role="tf-reset">重做本题</Button>}
            </ActionRow>
          </div>
        )}
      </section>

      {answered && passed !== null && answer !== null && (
        <VerdictBanner
          tone={passed ? 'good' : 'bad'}
          title={passed ? `✓ 答对了（${picked === true ? '正确' : '错误'}）` : `✗ 答错了：你选「${picked === true ? '正确' : '错误'}」，正确判断是「${answer ? '正确' : '错误'}」`}
          detail={passed ? '已记入进度：本题标记为「已通过」。' : '已记入错题本，去「📈 我的进度」可以复习。'}
        />
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
