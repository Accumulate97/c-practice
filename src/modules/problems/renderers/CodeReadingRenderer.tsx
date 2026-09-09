/**
 * 程序阅读写结果（code_reading）渲染器（阶段 4 模块 2）。
 *
 * 判分规则一行都不重写，全部转调既有层：
 *   归一化 / 逐行比对 / firstDiffLine  -> src/judge/backends/base.ts（经 grading/exact.ts 的 gradeExact）
 *   实机对照的事实分类 / didExecute 断言 -> src/judge/backends/godbolt.ts + client.ts 的 verdict()
 *   串行 / 节流 / 缓存 / 看门狗 / 降级   -> grading/stdin-run.ts 的 runStdinTests
 *
 * 诚实性红线（AGENTS.md 二·5）：
 *   · 主判分是纯文本比对、不联网，所以不存在「后端挂了就假装通过」的可能；
 *   · 实机对照失败一律显示「本次未判定」+ 降级自评材料，不计正确率、不置 verified；
 *   · answer 为空的题（构建期实测 defects.codeReadingNoAnswer，R3 之前文案硬编码「19 道」已过时）
 *     直接判「无法判分（数据缺陷）」，提交按钮禁用，绝不用空串当期望输出（否则交白卷会被判成「通过」）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { MONO_FONT } from '../../../components/common/CodeEditor'
import { judge } from '../../../app/config'
import type { JudgeClient } from '../../../judge/client'
import { backendIdForCode } from '../../../judge/math-lib'
import { loadDefectCount } from '../data/loader'
import type { ProblemRecord } from '../data/loader'
import { createJudgeClient } from '../grading/stdin-run'
import { gradeExact, readingTarget, runReadingSelfCheck } from '../grading/exact'
import type { ExactGrade, SelfCheckOutcome } from '../grading/exact'
import { recordAttempt } from '../progress/store'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

const TONE_COLOR = {
  good: 'var(--color-viz-sorted)',
  bad: 'var(--color-viz-swap)',
  unknown: 'var(--color-viz-compare)',
} as const

const TONE_OF_SELF_CHECK: Record<SelfCheckOutcome['kind'], keyof typeof TONE_COLOR> = {
  matched: 'good',
  mismatch: 'unknown',
  defect: 'bad',
  inconclusive: 'unknown',
}

const SELF_CHECK_LABEL: Record<SelfCheckOutcome['kind'], string> = {
  matched: '✓ 实机对照一致',
  mismatch: '⚠ 实机输出与预存答案不一致',
  defect: '✗ 题目代码自身没跑通',
  inconclusive: '⚠ 本次未判定',
}

/** 阅读题的坑就是空格：%2d / %5d 的宽度差一个空格就是另一份输出，故默认把空格显形 */
function visible(text: string, showSpaces: boolean): string {
  if (!showSpaces) return text
  return text.replace(/ /g, '\u00b7').replace(/\t/g, '\u2192')
}

function answerRows(expected: string): number {
  const n = expected.split('\n').length
  return Math.min(16, Math.max(4, n + 2))
}

interface Props {
  problem: ProblemRecord
}

export function CodeReadingRenderer({ problem }: Props) {
  const target = useMemo(() => readingTarget(problem), [problem])
  const [answer, setAnswer] = useState('')
  const [grade, setGrade] = useState<ExactGrade | null>(null)
  const [showSpaces, setShowSpaces] = useState(true)
  const [checking, setChecking] = useState(false)
  const [selfCheck, setSelfCheck] = useState<SelfCheckOutcome | null>(null)
  /**
   * 阶段 5 · R5：按源码分流后端 —— 含 sqrt 一类数学函数的代码走 libm 支路
   * （默认 cg132 链不上 libm，选型证据见 src/judge/math-lib.ts 文件头）。
   * client.ts 的结果缓存键与跨标签页锁名都含 backend.id，所以每条支路必须各持一个
   * client 实例：这里用 Map 按后端 id 分桶，而不是单个 ref。
   */
  const clientsRef = useRef<Map<string, JudgeClient> | null>(null)

  /**
   * R3：全站有多少道同类缺陷题，从 index.json 的 defects 动态读，不写死数字。
   * 只有真落到「缺 answer」分支才发这次读取（复用 loadIndex 的单飞缓存，实际不多一个请求）。
   */
  const needsDefectCount = target.kind === 'no-answer' && !target.isDescription
  const [defectCount, setDefectCount] = useState<number | null>(null)
  useEffect(() => {
    if (!needsDefectCount) return
    let alive = true
    loadDefectCount('codeReadingNoAnswer').then(
      (n) => {
        if (alive) setDefectCount(n)
      },
      () => {
        // 索引读不到就保持 null，文案会说「查不到确切数字」，绝不假装是 0
        if (alive) setDefectCount(null)
      },
    )
    return () => {
      alive = false
    }
  }, [needsDefectCount])

  /** 按题目自带的只读代码挑后端：实机对照是可选的二次结论，也不能因链不上 libm 而报假编译错误 */
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

  const gradeable = target.kind === 'ok'
  const expected = target.kind === 'ok' ? target.expected : ''

  const submit = useCallback(() => {
    if (!gradeable) return
    const next = gradeExact(answer, expected)
    setGrade(next)
    // 模块 5：本地归一化比对（无网络）也算一次有结论的判分，落盘后列表页才有三色状态
    // 阶段 5：存学生写的预测输出，错题本里能直接对照「我当时以为输出什么」
    recordAttempt(problem.id, next.state === 'accepted', { text: answer, kind: 'text' })
  }, [answer, expected, gradeable, problem.id])

  const reset = useCallback(() => {
    setAnswer('')
    setGrade(null)
    setSelfCheck(null)
  }, [])

  const runSelfCheck = useCallback(async () => {
    if (!gradeable || target.kind !== 'ok' || !target.runnableLive || checking) return
    setChecking(true)
    setSelfCheck(null)
    const outcome = await runReadingSelfCheck(getClient(target.code), target.code, target.expected, target.stdin)
    setChecking(false)
    setSelfCheck(outcome)
  }, [checking, getClient, gradeable, target])

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4" style={panel}>
        <p className="text-sm whitespace-pre-wrap">{problem.stem}</p>
      </section>

      {target.kind === 'no-code' && (
        <DefectPanel
          title="本题没有可显示的程序代码（数据缺陷）"
          body="分片里 code 字段为空，无法作答也无法判分。已登记进 judge:verify 报告，等人工修补。"
        />
      )}

      {target.kind === 'no-answer' && (
        <DefectPanel
          title={target.isDescription ? '本题的答案是文字描述，不是程序输出（answerIsDescription）' : '本题缺少预存输出（answer 为空，数据缺陷）'}
          body={
            target.isDescription
              ? '这类题问的是结论/理由而不是 stdout，逐字符比对没有意义，故不提供自动判分；请自行作答后对照教材。'
              : `没有 expected 就无法判分。绝不用空串当期望输出 —— 那样交白卷也会被判成「通过」。${
                  defectCount === null
                    ? '全站还有若干道阅读题属此类（索引里查不到确切数字）'
                    : `全站阅读题里有 ${defectCount} 道属此类`
                }，已登记进 judge:verify 报告，等人工补 answer。`
          }
          code={target.code}
        />
      )}

      {target.kind === 'ok' && (
        <>
          <section className="rounded-xl border p-4" style={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold" style={muted}>题目代码（只读）</h2>
              <span className="text-xs" style={muted}>自己心算输出，别指望编译器</span>
            </div>
            <pre
              className="mt-2 overflow-x-auto rounded-lg border p-3 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
            >
              {target.code}
            </pre>
          </section>

          <section className="rounded-xl border p-4" style={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold" style={muted}>你写出的运行结果</h2>
              <label className="flex items-center gap-1 text-xs" style={muted}>
                <input
                  type="checkbox"
                  checked={showSpaces}
                  onChange={(e) => setShowSpaces(e.target.checked)}
                />
                空格显形（· 代表一个空格）
              </label>
            </div>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={answerRows(target.expected)}
              spellCheck={false}
              aria-label="程序阅读题运行结果输入框"
              placeholder={'把程序运行的输出逐行写在这里…' + String.fromCharCode(10) + '多行输出请一行一行对齐，空格数量要与 printf 的格式一致'}
              className="mt-2 w-full rounded-lg border p-3 text-sm"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg)',
                color: 'var(--fg)',
                fontFamily: MONO_FONT,
                resize: 'vertical',
              }}
            />
            <p className="mt-2 text-xs" style={muted}>
              归一化规则：CRLF→LF、逐行剥行尾空白、剥整体末尾换行；<b>行内</b>空格必须完全一致
              （%2d / %5d 的宽度就是考点）。预存期望输出共 {target.expected.split('\n').length} 行。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={submit}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--color-brand)', color: '#fff' }}
              >
                提交判分
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
              >
                清空重填
              </button>
              <button
                type="button"
                onClick={() => void runSelfCheck()}
                disabled={!target.runnableLive || checking}
                title={target.blockedReason ?? `Godbolt ${judge.godboltCompiler} · ${judge.userArguments} · 软超时 ${judge.timeoutMs / 1000} s`}
                className="rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
              >
                {checking ? '实机对照中…' : '实机对照（Godbolt 跑一遍题目代码）'}
              </button>
            </div>
            {!target.runnableLive && target.blockedReason && (
              <p className="mt-2 text-xs" style={{ color: TONE_COLOR.unknown }}>{target.blockedReason}</p>
            )}
          </section>
        </>
      )}

      {grade && (
        <section
          className="rounded-xl border p-4"
          style={{ ...panel, borderColor: grade.state === 'accepted' ? TONE_COLOR.good : TONE_COLOR.bad }}
        >
          <p
            className="text-base font-semibold"
            style={{ color: grade.state === 'accepted' ? TONE_COLOR.good : TONE_COLOR.bad }}
          >
            {grade.state === 'accepted'
              ? '判分通过：你的输出与预存实机 stdout 逐行一致（归一化后）'
              : `未通过：首处差异在第 ${grade.firstDiffLine ?? '?'} 行，共 ${grade.diffCount} 行不一致`}
          </p>
          <p className="mt-1 text-xs" style={muted}>
            你写了 {grade.actualLineCount} 行，期望 {grade.expectedLineCount} 行。
            {grade.state === 'accepted' && grade.byteIdentical ? '（连归一化都不需要，逐字符相同）' : ''}
            {grade.state === 'accepted' && !grade.byteIdentical ? '（差异只在行尾空白或末尾空行，已被归一化吸收）' : ''}
            期望输出来自提取阶段的 Godbolt 实机取证（_judge-evidence.json 的 runtimeStdout），不是人手抄的书末答案。
          </p>

          {grade.state === 'wrong-answer' && (
            <>
              <div className="mt-3 space-y-1">
                {grade.diffs.map((d) => (
                  <div key={d.line} className="rounded-lg border p-2 text-xs" style={{ borderColor: 'var(--border)' }}>
                    <div className="font-medium" style={{ color: TONE_COLOR.bad }}>
                      第 {d.line} 行 ·{' '}
                      {d.kind === 'mismatch' ? '内容不同' : d.kind === 'actual-missing' ? '你少写了这一行' : '你多写了这一行'}
                    </div>
                    <DiffRow label="期望" text={d.expected} showSpaces={showSpaces} />
                    <DiffRow label="你的" text={d.actual} showSpaces={showSpaces} />
                  </div>
                ))}
                {grade.diffCount > grade.diffs.length && (
                  <p className="text-xs" style={muted}>
                    另有 {grade.diffCount - grade.diffs.length} 行差异未列出（最多显示 {grade.diffs.length} 行）。
                  </p>
                )}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Block title="期望输出（已归一化）" body={visible(grade.expected, showSpaces)} />
                <Block title="你的答案（已归一化）" body={visible(grade.actual, showSpaces)} tone={TONE_COLOR.bad} />
              </div>
            </>
          )}
        </section>
      )}

      {selfCheck && (
        <section
          className="rounded-xl border p-4"
          style={{ ...panel, borderColor: TONE_COLOR[TONE_OF_SELF_CHECK[selfCheck.kind]] }}
        >
          <p className="text-sm font-semibold" style={{ color: TONE_COLOR[TONE_OF_SELF_CHECK[selfCheck.kind]] }}>
            {SELF_CHECK_LABEL[selfCheck.kind]}
          </p>
          <p className="mt-1 text-sm">{selfCheck.summary}</p>
          <p className="mt-1 text-xs" style={muted}>
            {selfCheck.totalMs} ms{selfCheck.cacheHit ? ' · 缓存命中' : ''}
            {selfCheck.firstDiffLine !== null ? ` · 首处差异在第 ${selfCheck.firstDiffLine} 行` : ''}
            {selfCheck.kind === 'inconclusive' ? ' · 不计正确率、不置 verified' : ''}
          </p>
          {selfCheck.state !== null && selfCheck.kind !== 'inconclusive' && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Block title="预存答案（已归一化）" body={visible(selfCheck.expected, showSpaces)} />
              <Block
                title="实机 stdout（已归一化）"
                body={visible(selfCheck.actual, showSpaces)}
                tone={TONE_COLOR[TONE_OF_SELF_CHECK[selfCheck.kind]]}
              />
            </div>
          )}
          {selfCheck.kind === 'inconclusive' && (
            <details className="mt-3 text-xs" open>
              <summary className="cursor-pointer" style={{ color: TONE_COLOR.unknown }}>
                降级自评：展开查看本题的预存实机 stdout，自行在本地跑一遍比对（不计正确率、不置 verified）
              </summary>
              <div className="mt-2">
                <Block title="预存输出（构建期取证，非本次运行结果）" body={visible(selfCheck.expected, showSpaces)} />
              </div>
            </details>
          )}
        </section>
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

function DiffRow({ label, text, showSpaces }: { label: string; text: string; showSpaces: boolean }) {
  return (
    <div className="mt-1 flex gap-2">
      <span className="shrink-0" style={muted}>{label}</span>
      <code className="overflow-x-auto whitespace-pre" style={{ fontFamily: MONO_FONT }}>
        {text.length === 0 ? <span style={muted}>（空行）</span> : visible(text, showSpaces)}
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

/**
 * data-role="defect" 是阶段 5 起全站统一的验收契约（concept-shared 的 DefectPanel 同名同义），
 * 阅读题这块是自己写的一份，缺了这个钩子 R3「缺陷文案动态读 index.json」就验不到。
 * 只加属性，判分与渲染逻辑一行没动。
 */
function DefectPanel({ title, body, code }: { title: string; body: string; code?: string }) {
  return (
    <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR.unknown }} data-role="defect">
      <p className="text-sm font-semibold" style={{ color: TONE_COLOR.unknown }}>{title}</p>
      <p className="mt-2 text-sm" style={muted}>{body}</p>
      {code && code.trim().length > 0 && (
        <pre
          className="mt-3 overflow-x-auto rounded-lg border p-3 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
        >
          {code}
        </pre>
      )}
    </section>
  )
}