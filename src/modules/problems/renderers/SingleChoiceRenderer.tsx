/**
 * 选择题（single_choice）渲染器 —— 即时判定，纯前端、不联网（阶段 5）。
 *
 * 判分口径：schema 规定 options 恰为 4 项、answer 是 0–3 的下标，所以判定就是
 * 「学生点的下标 === answer」，没有任何模糊空间，也就不需要 grading/text-match 的归一化。
 * 点下去的那一刻即出结论并落盘（recordAttempt），学生不必再找「提交」按钮 ——
 * 这是本阶段验收明确要求的手感（"选择题点击选项即时判定"）。
 *
 * 诚实性红线：options 缺失 / 不足 4 项 / answer 越界，一律判为数据缺陷并禁用作答，
 * 绝不用「第一个选项」之类的猜测当正确答案。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordAttempt } from '../progress/store'
import {
  ActionRow, Button, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  TONE, muted, panel,
} from './concept-shared'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

type ChoiceTarget =
  | { kind: 'ok'; options: string[]; answer: number }
  | { kind: 'defect'; options: string[]; reason: string }

function letterOf(i: number): string {
  return LETTERS[i] ?? String(i + 1)
}

/** 选项文案里数据已自带「A) 」前缀，这里只在下标越界时才用 letterOf 兜底 */
function optionLabel(options: string[], i: number): string {
  const text = options[i] ?? ''
  return text.trim().length > 0 ? text.trim() : `${letterOf(i)})（这一项在数据里是空的 —— 数据缺陷）`
}

export function choiceTarget(problem: ProblemRecord): ChoiceTarget {
  const raw = problem.options
  const options = Array.isArray(raw) ? raw.map((o) => (typeof o === 'string' ? o : '')) : []
  if (!Array.isArray(raw) || options.length === 0) {
    return { kind: 'defect', options, reason: '分片里没有 options 数组，这题连选项都显示不出来，无法作答也无法判分。' }
  }
  if (options.length < 4) {
    return { kind: 'defect', options, reason: `schema 要求选择题恰有 4 个选项，本题只有 ${options.length} 个，属数据缺陷；判分会把「选项少了一个」当成学生答错，故禁用。` }
  }
  const answer = problem.answer
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
    const shown = answer === undefined ? '缺失' : String(JSON.stringify(answer))
    return { kind: 'defect', options, reason: `answer 字段是 ${shown}，不在 0–${options.length - 1} 的下标范围内：没有正确答案就无法判分，交白卷也不该被判「通过」，故禁用作答。` }
  }
  return { kind: 'ok', options, answer }
}

interface Props {
  problem: ProblemRecord
}

export function SingleChoiceRenderer({ problem }: Props) {
  const target = useMemo(() => choiceTarget(problem), [problem])
  const gradeable = target.kind === 'ok'
  const options = target.options
  const answer = target.kind === 'ok' ? target.answer : -1

  const [picked, setPicked] = useState<number | null>(null)
  const [passed, setPassed] = useState<boolean | null>(null)

  const choose = useCallback((i: number) => {
    if (!gradeable) return
    const ok = i === answer
    setPicked(i)
    setPassed(ok)
    // 落盘的是一行人类可读的摘要，不是下标：回看时才知道自己当时选了什么
    recordAttempt(problem.id, ok, { text: `我的选择：${optionLabel(options, i)}`, kind: 'choice' })
  }, [answer, gradeable, options, problem.id])

  const reset = useCallback(() => {
    setPicked(null)
    setPassed(null)
  }, [])

  const answered = picked !== null && passed !== null

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      {target.kind === 'defect' && (
        <DefectPanel title="本题无法在线判分（数据缺陷）" body={target.reason} />
      )}

      <section className="rounded-xl border p-4" style={panel} data-role="choice-options" data-count={String(options.length)} data-answerable={gradeable ? 'true' : 'false'}>
        <h2 className="text-sm font-semibold" style={muted}>选一个答案{gradeable ? '（点下去即时判定）' : '（本题不可判分，只能阅读）'}</h2>
        <ul className="mt-3 space-y-2">
          {options.map((_, i) => {
            const isPicked = picked === i
            const isCorrect = gradeable && i === answer
            const reveal = answered && isCorrect
            const wrongPick = answered && isPicked && !isCorrect
            return (
              <li key={i}>
                <label
                  className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: reveal ? TONE.good : wrongPick ? TONE.bad : 'var(--border)',
                    background: isPicked ? 'var(--bg)' : undefined,
                    cursor: gradeable ? 'pointer' : 'not-allowed',
                  }}
                  data-role="choice-option"
                  data-index={String(i)}
                  data-letter={letterOf(i)}
                  data-correct={reveal ? 'true' : 'false'}
                  data-picked={isPicked ? 'true' : 'false'}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    name={`choice-${problem.id}`}
                    checked={isPicked}
                    disabled={!gradeable}
                    onChange={() => choose(i)}
                    aria-label={`选项 ${letterOf(i)}`}
                  />
                  <span className="whitespace-pre-wrap">{optionLabel(options, i)}</span>
                  {reveal && <span className="ml-auto shrink-0 text-xs" style={{ color: TONE.good }}>✓ 正确答案</span>}
                  {wrongPick && <span className="ml-auto shrink-0 text-xs" style={{ color: TONE.bad }}>✗ 你选的</span>}
                </label>
              </li>
            )
          })}
        </ul>
        {gradeable && (
          <div className="mt-3">
            <ActionRow>
              {/* 「重做本题」只在本轮已作答后才渲染：没作答时它是个点了没反应的灰按钮；
                  而离开页面再回来时组件状态本就归零、直接点选项即可重做，两种情况都不该有它。
                  上次选了什么由 ProgressPanel 的「上次选择的选项」如实回看，不在这里重放。 */}
              {answered && <Button onClick={reset} role="choice-reset">重做本题</Button>}
              <span className="text-xs" style={muted}>每换一个选项就算一次提交，会记进尝试次数与错题本。</span>
            </ActionRow>
          </div>
        )}
      </section>

      {answered && passed !== null && picked !== null && (
        <VerdictBanner
          tone={passed ? 'good' : 'bad'}
          title={passed ? `✓ 答对了（选项 ${letterOf(picked)}）` : `✗ 答错了：你选 ${letterOf(picked)}，正确答案是 ${letterOf(answer)}`}
          detail={passed ? '已记入进度：本题标记为「已通过」。' : `正确答案是「${optionLabel(options, answer)}」。已记入错题本，去「📈 我的进度」可以复习。`}
        />
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
