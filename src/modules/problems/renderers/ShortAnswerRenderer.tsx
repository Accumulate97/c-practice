/**
 * 简答题（short_answer）渲染器 —— **不自动判分**，给参考答案让学生自评（阶段 5）。
 *
 * ── 为什么这一型不判分 ───────────────────────────────────────────────
 * 简答的答案是一段自然语言（「以下程序的功能是求 1!…5!」），文本比对只会把
 * 「说法不同但对」的答案判成错，把「抄了参考答案关键词但没懂」的判成对 ——
 * 两种错误都比不判分更有害。所以这一型的机器结论只有「学生自己点的自评」，
 * 落盘走 store.selfAssess()：它只写结论字段、不动 attempts / wrongCount，
 * 因此自评永远不会污染 stats.ts 里的「机器判分正确率」，UI 上也会标明来源。
 *
 * ── 数据现状（如实告知，不假装完整）────────────────────────────────────
 * 18 道简答题里只有 1 道（c-ch09-sa-004）带 reference_answer，grading_points 全库为空。
 * 缺参考答案时明说「题库没有给出参考答案」，并提示对照教材/题干里的程序自己推，
 * 绝不显示一个空框让学生以为「参考答案是空白」。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordSelfAssessment } from '../progress/store'
import {
  ActionRow, Button, CodeBlock, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  TONE, control, muted, panel, splitStem,
} from './concept-shared'

interface Props {
  problem: ProblemRecord
}

interface ShortAnswerTarget {
  reference: string
  points: string[]
}

function targetOf(problem: ProblemRecord): ShortAnswerTarget {
  const reference = typeof problem.reference_answer === 'string' ? problem.reference_answer : ''
  const raw = problem.grading_points
  const points = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
  return { reference, points }
}

export function ShortAnswerRenderer({ problem }: Props) {
  const target = useMemo(() => targetOf(problem), [problem])
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [verdict, setVerdict] = useState<'pass' | 'fail' | null>(null)

  const hasReference = target.reference.trim().length > 0
  const hasPoints = target.points.length > 0

  const reveal = useCallback(() => setRevealed(true), [])

  const selfAssess = useCallback((ok: boolean) => {
    setVerdict(ok ? 'pass' : 'fail')
    recordSelfAssessment(problem.id, ok, {
      text: `自评：${ok ? '我答对了' : '还没答对'}\n\n我的作答：\n${draft.trim().length > 0 ? draft.trim() : '（没有写下作答内容）'}`,
      kind: 'self',
    })
  }, [draft, problem.id])

  const reset = useCallback(() => {
    setDraft('')
    setRevealed(false)
    setVerdict(null)
  }, [])

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      <section className="rounded-xl border p-4" style={panel} data-role="sa-answer">
        <h2 className="text-sm font-semibold" style={muted}>我的作答（只存在本机，不上传、不自动判分）</h2>
        <textarea
          className="mt-2 w-full resize-y rounded-lg border p-3 text-sm outline-none"
          style={control}
          rows={6}
          value={draft}
          placeholder="先自己写一遍，再点下面的「显示参考答案与评分要点」对照。简答题不联网判分，写不写都不影响判题额度。"
          onChange={(e) => setDraft(e.target.value)}
          data-role="sa-input"
          aria-label="简答题作答区"
        />
        <div className="mt-2 text-xs" style={muted}>
          <ActionRow>
            <Button onClick={reveal} disabled={revealed} role="sa-reveal">显示参考答案与评分要点</Button>
            <Button onClick={reset} role="sa-reset">清空重来</Button>
            <span>{draft.trim().length > 0 ? `已写 ${draft.trim().length} 字` : '还没有作答内容'}</span>
          </ActionRow>
        </div>
      </section>

      {!hasReference && !hasPoints && (
        <DefectPanel
          title="题库没有给出这一题的参考答案（数据缺口）"
          body="18 道简答题里只有 1 道带参考答案，本题的 reference_answer 与 grading_points 都是空的。请对照教材或题干里的程序自己推一遍，再用下面的自评按钮记录结论。自评不计入机器判分正确率。"
        />
      )}

      {revealed && (
        <section className="rounded-xl border p-4" style={panel} data-role="sa-reference" data-has-reference={hasReference ? 'true' : 'false'} data-points={String(target.points.length)}>
          <h2 className="text-sm font-semibold" style={{ color: TONE.warn }}>参考答案（供自评，不是机器判分依据）</h2>
          {hasReference ? (
            <div className="mt-2 space-y-3">
              {splitStem(target.reference).map((part, i) =>
                part.kind === 'code' ? <CodeBlock key={i} code={part.body} /> : (
                  <p key={i} className="text-sm whitespace-pre-wrap">{part.body}</p>
                ),
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm" style={muted}>（数据里没有参考答案正文）</p>
          )}
          {hasPoints && (
            <div className="mt-3">
              <div className="text-xs" style={muted}>评分要点（逐条对照，缺一条就还没答全）</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" data-role="sa-points">
                {target.points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <ActionRow>
              <Button onClick={() => selfAssess(true)} role="sa-self-pass" tone="good">✓ 对照后我答对了</Button>
              <Button onClick={() => selfAssess(false)} role="sa-self-fail" tone="bad">✗ 还没答对</Button>
              <span className="text-xs" style={muted}>自评结论会记进进度，但标注为「来自你的自评」，不计入机器判分正确率。</span>
            </ActionRow>
          </div>
        </section>
      )}

      {verdict !== null && (
        <VerdictBanner
          tone={verdict === 'pass' ? 'good' : 'bad'}
          title={verdict === 'pass' ? '✓ 你自评「答对了」' : '◐ 你自评「还没答对」'}
          detail={verdict === 'pass'
            ? '本题在「📈 我的进度」里会显示为已通过，并标注结论来自自评。'
            : '本题会进错题本并标注为自评结论；重新自评一次即可更新。'}
        />
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
