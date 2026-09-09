/**
 * 匹配题（matching）渲染器 —— 逐项配对后整题判定，纯前端、不联网（阶段 5）。
 *
 * 【库内现状：0 道】518 题里没有一道 matching；渲染器按 schema 完整实现，数据一到即可用。
 *
 * ── 判分口径 ───────────────────────────────────────────────────────
 * schema 的 pairs 是「已经配好的」左右对（left[i] 对应 right[i]），所以判分是
 * 「学生给每个 left 选的 right === 数据里那一项」，全对才算通过（匹配题的知识点是一个整体，
 * 配错一项就说明这一组关系没理清，与填空题同口径）。
 *
 * 右列的显示顺序用 seededOrder 按题目 id 确定性打乱：
 * 若照 pairs 原序显示，学生一眼就能看出「第 i 行配第 i 项」，题目当场失效；
 * 若用 Math.random，React 每次重渲染都会洗牌，选项会在学生眼皮底下跳位。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ProblemRecord } from '../data/loader'
import { recordAttempt } from '../progress/store'
import { seededOrder } from '../grading/text-match'
import {
  ActionRow, Button, DefectPanel, ExplanationBlock, StemBlock, VerdictBanner,
  TONE, control, muted, panel,
} from './concept-shared'

interface Pair {
  left: string
  right: string
}

type MatchingTarget =
  | { kind: 'ok'; pairs: Pair[] }
  | { kind: 'defect'; pairs: Pair[]; reason: string }

export function matchingTarget(problem: ProblemRecord): MatchingTarget {
  const raw = problem.pairs
  const pairs: Pair[] = Array.isArray(raw)
    ? raw.map((item) => {
        const o = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
        return { left: typeof o.left === 'string' ? o.left : '', right: typeof o.right === 'string' ? o.right : '' }
      })
    : []
  if (pairs.length === 0) {
    return { kind: 'defect', pairs, reason: 'pairs 字段为空：没有任何可配对的项（数据缺陷）。' }
  }
  const bad = pairs.findIndex((p) => p.left.trim().length === 0 || p.right.trim().length === 0)
  if (bad >= 0) {
    return { kind: 'defect', pairs, reason: `第 ${bad + 1} 对的 left/right 有空值：缺了任何一侧都无法判定配对是否正确（数据缺陷），禁用判分而不是拿空串当答案。` }
  }
  return { kind: 'ok', pairs }
}

interface Props {
  problem: ProblemRecord
}

export function MatchingRenderer({ problem }: Props) {
  const target = useMemo(() => matchingTarget(problem), [problem])
  const gradeable = target.kind === 'ok'
  const pairs = target.pairs
  /** 右列显示顺序：按题目 id 确定性打乱（见文件头注释） */
  const rightOrder = useMemo(() => seededOrder(problem.id, pairs.length), [pairs.length, problem.id])
  const rightOptions = useMemo(() => rightOrder.map((i) => pairs[i]?.right ?? ''), [pairs, rightOrder])

  const [picked, setPicked] = useState<Record<number, string>>({})
  const [results, setResults] = useState<boolean[] | null>(null)

  const setPick = useCallback((leftIdx: number, right: string) => {
    setPicked((prev) => ({ ...prev, [leftIdx]: right }))
    setResults(null)
  }, [])

  const allPicked = gradeable && pairs.every((_, i) => (picked[i] ?? '').length > 0)

  const submit = useCallback(() => {
    if (!gradeable || target.kind !== 'ok' || !allPicked) return
    const next = target.pairs.map((p, i) => (picked[i] ?? '') === p.right)
    setResults(next)
    const ok = next.every(Boolean)
    recordAttempt(problem.id, ok, {
      text: target.pairs.map((p, i) => `${p.left} → ${picked[i] ?? '（未选）'}${(picked[i] ?? '') === p.right ? '' : `（应为 ${p.right}）`}`).join('\n'),
      kind: 'choice',
    })
  }, [allPicked, gradeable, picked, problem.id, target])

  const reset = useCallback(() => {
    setPicked({})
    setResults(null)
  }, [])

  const correctCount = results === null ? 0 : results.filter(Boolean).length

  return (
    <div className="space-y-4">
      <StemBlock stem={problem.stem} />

      {target.kind === 'defect' && <DefectPanel title="本题无法在线判分（数据缺陷）" body={target.reason} />}

      <section className="rounded-xl border p-4" style={panel} data-role="matching-pairs" data-count={String(pairs.length)} data-answerable={gradeable ? 'true' : 'false'}>
        <h2 className="text-sm font-semibold" style={muted}>给左边每一项选出对应的右边项</h2>
        <ul className="mt-3 space-y-2">
          {pairs.map((p, i) => {
            const chosen = picked[i] ?? ''
            const ok = results?.[i] ?? null
            return (
              <li key={i} className="flex flex-wrap items-center gap-2" data-role="matching-row" data-index={String(i)}>
                <span className="min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>{p.left}</span>
                <span className="text-xs" style={muted}>→</span>
                <select
                  className="min-w-40 flex-1 rounded-lg border px-2 py-2 text-sm outline-none"
                  style={{ ...control, borderColor: ok === null ? 'var(--border)' : ok ? TONE.good : TONE.bad }}
                  value={chosen}
                  disabled={!gradeable}
                  onChange={(e) => setPick(i, e.target.value)}
                  aria-label={`第 ${i + 1} 项的配对`}
                  data-role="matching-select"
                  data-index={String(i)}
                >
                  <option value="">（请选择）</option>
                  {rightOptions.map((opt, k) => <option key={k} value={opt}>{opt}</option>)}
                </select>
                {ok !== null && (
                  <span className="w-40 shrink-0 text-xs" style={{ color: ok ? TONE.good : TONE.bad }}>
                    {ok ? '✓' : `✗ 应为「${p.right}」`}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {gradeable && (
          <div className="mt-3">
            <ActionRow>
              <Button onClick={submit} tone="good" disabled={!allPicked} role="matching-submit">提交判分</Button>
              <Button onClick={reset} role="matching-reset">清空重做</Button>
              {!allPicked && <span className="text-xs" style={muted}>还有项没选（留空提交等于交白卷，不予判分）。</span>}
            </ActionRow>
          </div>
        )}
      </section>

      {results !== null && (
        <VerdictBanner
          tone={correctCount === results.length ? 'good' : 'bad'}
          title={correctCount === results.length ? `✓ ${results.length} 项全部配对正确` : `✗ ${results.length} 项里对了 ${correctCount} 项`}
          detail={correctCount === results.length
            ? '已记入进度：本题标记为「已通过」。'
            : '匹配题全对才算通过：这几组对应关系是一个整体，配错一项就说明还没理清。已记入错题本。'}
        />
      )}

      <ExplanationBlock text={typeof problem.explanation === 'string' ? problem.explanation : ''} />
    </div>
  )
}
