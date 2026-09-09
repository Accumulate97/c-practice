/**
 * 程序填空（code_completion）渲染器（阶段 4 模块 3）。
 *
 * 判分两层，分工明确（一行判分规则都不在这里重写，全部转调既有层）：
 *   ① 文本比对（离线、纯函数、逐空位即时反馈）-> grading/blank-match.ts 的 gradeBlanks
 *      精确命中 answer / 命中 accepted 等价写法 / 都不命中（带差异提示）。
 *      这只是「与参考写法是否一致」的提示，不是最终结论。
 *   ② 实机判分（联网、最终裁定）-> assembleCompletion 把学生填写拼成完整程序，
 *      经 grading/stdin-run.ts 的 runStdinTests 逐组串行执行，归一化 / 比对 / 事实分类
 *      全部走 src/judge（base.ts / godbolt.ts / client.ts），与编程题共用同一套判分内核。
 *
 * 为什么最终结论必须以实机为准（坑 1，2026-09-09 立项时用户点名）：
 *   等价写法必须连同上下文一起编译验证，不能只看字符串是否匹配。三个真实反例——
 *   c-ch06-cc-002 空位 3 上下文是 if(【3】==0)：填 i%3 正确，填 i%3==0 变成 ((i%3==0)==0) 语义翻转；
 *   c-ch06-cc-001 空位 3 后面没有分号：填 printf("\n") 缺分号直接语法错；
 *   c-ch06-cc-004 空位 2 上下文是 for(【2】i++)：填 i=16;i<=31 缺末尾分号语法错。
 *   所以学生写出参考解之外的正确等价写法时，实机运行会判通过并说明（文本比对只作参考）。
 *
 * 拼装空格包裹（坑 2，上轮真实缺陷）：c-ch04-cc-006 的 else【3】直接贴会得到 elselen=28。
 *   assembleCompletion 一律用 " " + 答案 + " " 包裹，从根上杜绝词法粘连（空白即分隔符，不影响 C 词法）。
 *
 * 诚实性红线（AGENTS.md 二·5）：后端抖动 = 「未判定」不是「答错」；降级自评不计正确率、
 *   不置 verified，绝不显示「通过」。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BlankCodeEditor } from '../../../components/common/BlankCodeEditor'
import type { BlankEditorHandle, BlankSlotValues } from '../../../components/common/BlankCodeEditor'
import { MONO_FONT } from '../../../components/common/CodeEditor'
import { judge } from '../../../app/config'
import { firstDiffLine, formatDiagnostics } from '../../../judge/backends/base'
import type { JudgeClient } from '../../../judge/client'
import { backendIdForCode } from '../../../judge/math-lib'
import type { BatchReport, TestCaseResult } from '../../../judge/types'
import type { ProblemRecord } from '../data/loader'
import { createJudgeClient, runStdinTests, toProblemTestCases } from '../grading/stdin-run'
import type { RunProgress } from '../grading/stdin-run'
import { STATE_COLOR, STATE_LABEL, isInconclusive } from '../verdict-meta'
import { recordBatchAttempt } from '../progress/store'
import { assembleCompletion, completionTarget, gradeBlanks } from '../grading/blank-match'
import type { BlankGrade, BlankMatch } from '../grading/blank-match'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

const TONE_COLOR = {
  good: 'var(--color-viz-sorted)',
  bad: 'var(--color-viz-swap)',
  unknown: 'var(--color-viz-compare)',
} as const

const KIND_META: Record<BlankMatch['kind'], { label: string; icon: string; tone: keyof typeof TONE_COLOR }> = {
  exact: { label: '与参考答案一致', icon: '✓', tone: 'good' },
  accepted: { label: '命中等价写法', icon: '✓', tone: 'good' },
  mismatch: { label: '与参考写法不同', icon: '✗', tone: 'bad' },
  empty: { label: '未填写', icon: '○', tone: 'unknown' },
}

interface Overall {
  tone: keyof typeof TONE_COLOR
  label: string
  detail: string
}

/**
 * 整题结论。优先级：全部用例 accepted > 有真实失败 > 全部未判定（后端抖动不算答错）。
 * 文本比对只用来给结论补一句说明（尤其「文本不同但实机正确」的等价写法），绝不喧宾夺主。
 */
function summarizeCompletion(report: BatchReport, grade: BlankGrade | null): Overall {
  const total = report.results.length
  const states = report.results.map((r) => r.response.state)
  const inconclusiveCount = states.filter((s) => isInconclusive(s)).length
  const textNote = grade
    ? `文本比对：${grade.exactCount} 精确 / ${grade.acceptedCount} 等价写法 / ${grade.mismatchCount} 与参考不同`
    : `串行执行总耗时 ${report.totalMs} ms，缓存命中 ${report.cacheHits} 组`
  if (total > 0 && states.every((s) => s === 'accepted')) {
    const novel = grade !== null && !grade.allMatched
    const extra = novel ? '（部分空位写法与参考不同，但拼装后程序在所有用例上输出正确 —— 仍判通过）' : ''
    return { tone: 'good', label: `判分通过：${total}/${total} 组用例输出正确${extra}`, detail: textNote }
  }
  const firstBad = report.results.find((r) => !isInconclusive(r.response.state) && r.response.state !== 'accepted')
  if (firstBad) {
    const suffix = inconclusiveCount > 0 ? `；另有 ${inconclusiveCount} 组未判定（后端不可用）` : ''
    return {
      tone: 'bad',
      label: `未通过：${report.acceptedCount}/${total} 组正确，首个失败是第 ${firstBad.index} 组`,
      detail: `${STATE_LABEL[firstBad.response.state]} —— ${firstBad.response.summary}${suffix}`,
    }
  }
  return {
    tone: 'unknown',
    label: `本次未判定：${inconclusiveCount}/${total} 组无法判分`,
    detail: '判分后端不可用，这属「未判定」而非「答错」，不计正确率、不置 verified。',
  }
}

interface Props {
  problem: ProblemRecord
}

export function CodeCompletionRenderer({ problem }: Props) {
  const target = useMemo(() => completionTarget(problem), [problem])
  const cases = useMemo(() => toProblemTestCases(problem.testCases), [problem.testCases])
  const [values, setValues] = useState<BlankSlotValues>({})
  const [activeSlot, setActiveSlot] = useState<number | null>(null)
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)
  const [textGrade, setTextGrade] = useState<BlankGrade | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [report, setReport] = useState<BatchReport | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const editorRef = useRef<BlankEditorHandle>(null)
  /**
   * 阶段 5 · R5：按源码分流后端 —— 含 sqrt 一类数学函数的代码走 libm 支路
   * （默认 cg132 链不上 libm，选型证据见 src/judge/math-lib.ts 文件头）。
   * client.ts 的结果缓存键与跨标签页锁名都含 backend.id，所以每条支路必须各持一个
   * client 实例：这里用 Map 按后端 id 分桶，而不是单个 ref。
   */
  const clientsRef = useRef<Map<string, JudgeClient> | null>(null)

  /** 按空位拼装出的完整程序挑后端（不是按单个空位的值） */
  const getClient = useCallback((source: string): JudgeClient => {
    const buckets = (clientsRef.current ??= new Map<string, JudgeClient>())
    const key = backendIdForCode(source)
    let client = buckets.get(key)
    if (!client) {
      client = createJudgeClient({ code: source })
      buckets.set(key, client)
    }
    return client
  }, [])

  const blocked = target.blocking
  const canRun = blocked === null && cases.length > 0
  const filledCount = target.blanks.filter((b) => {
    const v = values[b.index]
    return typeof v === 'string' && v.trim().length > 0
  }).length

  const handleChange = useCallback((next: BlankSlotValues) => {
    setValues(next)
    setBlockedMsg(null)
  }, [])

  const submit = useCallback(async () => {
    if (running || blocked !== null) return
    // 从编辑器 handle 取最新值，避免「刚打完字就点提交」时 state 还没落地的竞态
    const current = editorRef.current?.values() ?? values
    const grade = gradeBlanks(current, target.blanks)
    setTextGrade(grade)
    setValues(current)
    setAttempted(true)
    setFatal(null)
    setReport(null)
    // 有空位没填：拼装出的程序必然编译失败，UI 已逐一点名拦住，不打网络
    if (!grade.allFilled) return
    // 没有测试用例：只能做本地文本比对，无法实机判分
    if (cases.length === 0) return
    setRunning(true)
    const assembled = assembleCompletion(target.template, current)
    setProgress({ caseIndex: 1, total: cases.length, status: { running: 0, waiting: 0, ahead: 0, concurrency: 0 } })
    const outcome = await runStdinTests(getClient(assembled), assembled, cases, (p) => setProgress(p))
    setRunning(false)
    setProgress(null)
    if (outcome.kind === 'done') {
      setReport(outcome.report)
      // 模块 5：判分结论落盘。空位没填 / 没有测试用例时上面已 return，不产生「未判定」记录
      // 阶段 5：存拼装后的完整程序（不是单个空位的值），回看时才能直接读
      recordBatchAttempt(problem.id, outcome.report.results, { text: assembled, kind: 'code' })
    } else setFatal(outcome.summary)
  }, [running, blocked, values, target, cases, getClient, problem.id])

  const reset = useCallback(() => {
    setValues({})
    setTextGrade(null)
    setAttempted(false)
    setReport(null)
    setFatal(null)
    setBlockedMsg(null)
    setActiveSlot(null)
    // 换 key 强制重挂编辑器：BlankCodeEditor 只在挂载时吃 initialValues，重置走重挂最干净
    setResetKey((k) => k + 1)
  }, [])

  const overall = useMemo(() => (report ? summarizeCompletion(report, textGrade) : null), [report, textGrade])
  const inconclusiveCount = useMemo(
    () => (report ? report.results.filter((r) => isInconclusive(r.response.state)).length : 0),
    [report],
  )

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4" style={panel}>
        <h2 className="text-sm font-semibold" style={muted}>题目要求</h2>
        <p className="mt-2 text-sm whitespace-pre-wrap">{problem.stem}</p>
        {typeof problem.source === 'string' && problem.source.length > 0 && (
          <p className="mt-2 text-xs" style={muted}>出处：{problem.source}</p>
        )}
        <p className="mt-2 text-xs" style={muted}>
          共 {target.blanks.length} 个空位。填好后系统把你的答案拼成完整程序，逐组串行运行 {cases.length} 个测试用例判分。
          Tab / Shift-Tab 在空位间跳转；空位以外的代码只读。
        </p>
      </section>

      {blocked !== null && <DefectPanel title="本题暂无法作答（数据缺陷）" body={blocked} />}

      {blocked === null && (
        <>
          {target.warnings.length > 0 && (
            <section className="rounded-xl border p-3" style={{ ...panel, borderColor: TONE_COLOR.unknown }}>
              <div className="text-xs font-semibold" style={{ color: TONE_COLOR.unknown }}>提示</div>
              <ul className="mt-1 list-disc pl-5 text-xs" style={muted}>
                {target.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border p-4" style={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold" style={muted}>程序代码（只有编号空位可以编辑）</h2>
              <span className="text-xs" style={muted}>
                {judge.godboltCompiler} · {judge.userArguments} · 软超时 {judge.timeoutMs / 1000} s
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {target.blanks.map((b) => {
                const v = values[b.index]
                const filled = typeof v === 'string' && v.trim().length > 0
                const active = activeSlot === b.index
                return (
                  <button
                    key={b.index}
                    type="button"
                    onClick={() => editorRef.current?.focusSlot(b.index)}
                    className="rounded-md border px-2 py-0.5 text-xs"
                    style={{
                      borderColor: active ? 'var(--color-brand)' : 'var(--border)',
                      color: filled ? 'var(--color-viz-sorted)' : 'var(--fg-muted)',
                      background: active ? 'var(--code-selection)' : 'transparent',
                    }}
                    title={b.hint ?? `跳到空位 ${b.index}`}
                  >
                    空位 {b.index}
                    {filled ? ' ✓' : ''}
                  </button>
                )
              })}
              <span className="ml-auto text-xs" style={muted}>
                已填 {filledCount}/{target.blanks.length}
              </span>
            </div>

            <div className="mt-2">
              <BlankCodeEditor
                key={resetKey}
                ref={editorRef}
                template={target.template}
                slots={target.slots}
                disabled={running}
                onChange={handleChange}
                onActiveSlot={setActiveSlot}
                onBlockedEdit={() =>
                  setBlockedMsg('空位以外的代码是只读的：请把答案写进编号空位里（判分需要题目给定代码保持原样）')
                }
                ariaLabel="程序填空代码编辑器"
              />
            </div>

            {blockedMsg && (
              <p className="mt-2 text-xs" style={{ color: TONE_COLOR.unknown }}>{blockedMsg}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={running || blocked !== null}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--color-brand)', color: '#fff' }}
              >
                {running ? '判分中…' : canRun ? `提交判分（${cases.length} 组）` : '提交判分'}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={running}
                className="rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
              >
                清空重填
              </button>
              {attempted && textGrade && !textGrade.allFilled && (
                <span className="text-xs" style={{ color: TONE_COLOR.bad }}>
                  还有 {textGrade.emptyIndexes.length} 个空位没填：空位 {textGrade.emptyIndexes.join('、')} —— 请填完再提交
                </span>
              )}
              {!canRun && (
                <span className="text-xs" style={{ color: TONE_COLOR.unknown }}>
                  本题没有测试用例，只能做本地文本比对（不计正确率）
                </span>
              )}
            </div>
          </section>

          {progress && (
            <section className="rounded-xl border p-4" style={panel}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">第 {progress.caseIndex}/{progress.total} 组用例执行中…</span>
                <span className="text-xs" style={muted}>
                  并发上限 {progress.status.concurrency} · 队列前方 {progress.status.ahead} 个 · 运行中 {progress.status.running}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
                <div
                  style={{
                    width: `${Math.min(100, (progress.caseIndex / Math.max(1, progress.total)) * 100)}%`,
                    height: '100%',
                    background: 'var(--color-brand)',
                    transition: 'width 200ms ease-out',
                  }}
                />
              </div>
            </section>
          )}

          {fatal && (
            <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR.unknown }}>
              <p className="text-sm font-semibold" style={{ color: TONE_COLOR.unknown }}>⚠ 本次未判定</p>
              <p className="mt-1 text-sm">{fatal}</p>
              {textGrade && <TextGradePanel grade={textGrade} />}
              <SelfCheck cases={cases} />
            </section>
          )}

          {textGrade && attempted && !fatal && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold" style={muted}>
                逐空位文本比对（{textGrade.exactCount + textGrade.acceptedCount}/{textGrade.total} 命中参考写法）
              </h2>
              <TextGradePanel grade={textGrade} />
              <p className="text-xs" style={muted}>
                文本比对只是「与参考写法是否一致」的提示；最终结论以下面拼装后程序的实机运行为准 ——
                参考解之外的正确等价写法同样判通过。
              </p>
            </section>
          )}

          {overall && report && (
            <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR[overall.tone] }}>
              <p className="text-base font-semibold" style={{ color: TONE_COLOR[overall.tone] }}>{overall.label}</p>
              <p className="mt-1 text-sm" style={muted}>{overall.detail}</p>
              {inconclusiveCount > 0 && (
                <p className="mt-2 text-xs" style={{ color: TONE_COLOR.unknown }}>
                  其中 {inconclusiveCount} 组走的是降级 / 未判定路径：不计正确率、不置 verified。
                </p>
              )}
              {inconclusiveCount > 0 && <SelfCheck cases={cases} />}
            </section>
          )}

          {report && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold" style={muted}>
                用例级判分结果（{report.acceptedCount}/{report.results.length} 组通过）
              </h2>
              {report.results.map((r) => (
                <CaseCard key={r.index} result={r} />
              ))}
            </section>
          )}

          {target.solution.trim().length > 0 && (
            <details className="rounded-xl border p-3 text-xs" style={panel}>
              <summary className="cursor-pointer" style={muted}>查看参考答案（补全后的完整程序）</summary>
              <pre
                className="mt-2 overflow-x-auto rounded-lg border p-2"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
              >
                {target.solution}
              </pre>
            </details>
          )}
        </>
      )}

      {problem.explanation && problem.explanation.trim().length > 0 && (
        <section className="rounded-xl border p-4" style={panel}>
          <h2 className="text-sm font-semibold" style={muted}>详解</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap">{problem.explanation}</p>
        </section>
      )}
    </div>
  )
}

function TextGradePanel({ grade }: { grade: BlankGrade }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {grade.perBlank.map((m) => (
        <BlankCard key={m.index} match={m} />
      ))}
    </div>
  )
}

function BlankCard({ match }: { match: BlankMatch }) {
  const meta = KIND_META[match.kind]
  const color = TONE_COLOR[meta.tone]
  return (
    <article className="rounded-xl border p-3" style={{ ...panel, borderColor: color }}>
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold" style={{ color }}>
          {meta.icon} 空位 {match.index} · {meta.label}
        </span>
        {match.whitespaceOnly && <span className="text-xs" style={muted}>（仅空白差异，视为等价）</span>}
        {match.matchedVariant && <span className="text-xs" style={muted}>命中：{match.matchedVariant}</span>}
      </header>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
        <Field label="你的填写" text={match.givenRaw} />
        <Field
          label={match.expected.length === 0 ? '参考答案（本空位未存 answer）' : '参考答案'}
          text={match.expected}
        />
      </div>
      {match.accepted.length > 0 && (
        <p className="mt-1 text-xs" style={muted}>
          可接受的等价写法：{match.accepted.map((a) => `"${a}"`).join(' / ')}
        </p>
      )}
      {match.diff && (
        <div className="mt-2 rounded-lg border p-2 text-xs" style={{ borderColor: color, background: 'var(--bg)' }}>
          <div style={{ color: TONE_COLOR.bad }}>差异：{match.diff.hint}</div>
          <div className="mt-1 grid gap-1 md:grid-cols-2">
            <Field
              label={`最接近的参考（${match.diff.closestFrom === 'answer' ? 'answer' : '等价写法'}）`}
              text={match.diff.closest}
            />
            <Field label="你的填写（归一化）" text={match.diff.given} />
          </div>
          <div className="mt-1" style={muted}>
            {match.diff.distance !== null ? `编辑距离 ${match.diff.distance}` : '答案过长，未计算编辑距离'}
            {match.diff.firstDiffColumn !== null ? ` · 首处差异在第 ${match.diff.firstDiffColumn} 列` : ''}
          </div>
        </div>
      )}
      {match.hint && <p className="mt-1 text-xs" style={muted}>提示：{match.hint}</p>}
    </article>
  )
}

function CaseCard({ result }: { result: TestCaseResult }) {
  const res = result.response
  const color = STATE_COLOR[res.state]
  const diff = res.state === 'wrong-answer' ? firstDiffLine(res.actual, res.expected) : null
  const diags = res.diagnostics.length > 0 ? formatDiagnostics(res.diagnostics) : ''
  return (
    <article className="rounded-xl border p-4" style={{ ...panel, borderColor: color }}>
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold" style={{ color }}>第 {result.index} 组 · {STATE_LABEL[res.state]}</span>
        {result.note && <span className="text-xs" style={muted}>{result.note}</span>}
        <span className="ml-auto text-xs" style={muted}>
          {result.ms} ms{result.cacheHit ? ' · 缓存命中' : ''}
          {typeof res.execTimeMs === 'number' ? ` · 执行 ${res.execTimeMs} ms` : ''}
          {typeof res.exitCode === 'number' ? ` · 退出码 ${res.exitCode}` : ''}
        </span>
      </header>

      <p className="mt-2 text-sm">{res.summary}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Block title="输入 stdin" body={result.stdin} />
        <Block title="期望输出（已归一化）" body={res.expected} />
        <Block title={res.degraded ? '预存输出（降级自评）' : '实际输出（已归一化）'} body={res.actual} tone={color} />
      </div>

      {diff !== null && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-viz-swap)' }}>
          首处差异在第 {diff} 行。归一化：CRLF→LF、逐行剥行尾空白、剥末尾换行；行中空行与行尾空格保留后再剥。
        </p>
      )}

      {res.degraded && (
        <p className="mt-2 text-xs" style={{ color: TONE_COLOR.unknown }}>
          降级自评：上面「预存输出」来自构建期存档的真实 stdout，不是本次运行结果，不计正确率、不置 verified。
        </p>
      )}

      {(diags || res.compilerMessage) && (
        <div className="mt-3">
          <div className="text-xs" style={muted}>编译诊断 / 后端说明</div>
          <pre
            className="mt-1 overflow-x-auto rounded-lg border p-2 text-xs"
            style={{ ...muted, borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
          >
            {[diags, res.compilerMessage].filter((s) => s.trim().length > 0).join('\n') || '（无）'}
          </pre>
        </div>
      )}
    </article>
  )
}

/** 后端不可用时的自评材料：只给题目自带的期望输出，不伪造运行结果、不给「通过」 */
function SelfCheck({ cases }: { cases: { stdin: string; expected: string; note?: string }[] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer" style={{ color: 'var(--color-viz-compare)' }}>
        判分后端不可用：展开查看本题各组的输入与期望输出，自行在本地比对（不计正确率、不置 verified）
      </summary>
      <ol className="mt-2 space-y-3">
        {cases.map((c, i) => (
          <li key={i}>
            <div className="font-medium">第 {i + 1} 组{c.note ? `（${c.note}）` : ''}</div>
            <Block title="输入 stdin" body={c.stdin} />
            <Block title="期望输出（题目自带，非本次运行结果）" body={c.expected} />
          </li>
        ))}
      </ol>
    </details>
  )
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div style={muted}>{label}</div>
      <code
        className="mt-0.5 block overflow-x-auto whitespace-pre rounded border px-1.5 py-1"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
      >
        {text.length === 0 ? <span style={muted}>（空）</span> : text}
      </code>
    </div>
  )
}

function Block({ title, body, tone }: { title: string; body: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs" style={muted}>{title}</div>
      <pre
        className="mt-1 overflow-x-auto rounded-lg border p-2 text-xs whitespace-pre-wrap"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: tone ?? 'var(--fg)', fontFamily: MONO_FONT }}
      >
        {body.length === 0 ? <span style={muted}>（空）</span> : body}
      </pre>
    </div>
  )
}

function DefectPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR.unknown }}>
      <p className="text-sm font-semibold" style={{ color: TONE_COLOR.unknown }}>{title}</p>
      <p className="mt-2 text-sm" style={muted}>{body}</p>
    </section>
  )
}