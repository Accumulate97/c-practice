/**
 * 程序改错渲染器（阶段 4 模块 4）：展示带 bug 的代码 → 学生在编辑器里改 → 逐组串行跑 stdin 用例判分。
 *
 * 判分**复用模块 1 的 stdin-run.ts**（用户明令：改错题本质是「跑代码比对输出」，不新写一套）：
 *   createJudgeClient / runStdinTests / toProblemTestCases → src/modules/problems/grading/stdin-run.ts
 *   串行 / 缓存 / 降级 / 看门狗 → JudgeClient（src/judge/client.ts）与 stdin-run 的看门狗
 *   事实分类 / 归一化比对 / 结论文案 → src/judge（阶段 2）
 * 本文件只负责呈现与教学提示阶梯，一行判分规则都不写。
 *
 * 教学口径（2026-09-09 用户裁决）：改错题的价值在「自己找 bug」，bugs 字段默认不展示；
 * 三级提示只在学生主动点击后展开：1 有几处错 → 2 错在哪几行 → 3 错误原因（bugs 原文）。
 * 答对（全组 accepted）后才揭示 fixed_code 与完整解析。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CodeEditor, MONO_FONT } from '../../../components/common/CodeEditor'
import { firstDiffLine, formatDiagnostics } from '../../../judge/backends/base'
import type { JudgeClient } from '../../../judge/client'
import { backendIdForCode } from '../../../judge/math-lib'
import type { BatchReport, TestCaseResult } from '../../../judge/types'
import type { ProblemRecord } from '../data/loader'
import { createJudgeClient, runStdinTests, toProblemTestCases } from '../grading/stdin-run'
import type { RunProgress } from '../grading/stdin-run'
import { STATE_COLOR, STATE_LABEL, isInconclusive } from '../verdict-meta'
import { recordBatchAttempt } from '../progress/store'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

const TONE_COLOR = {
  good: 'var(--fg-ok)',
  bad: 'var(--fg-bad)',
  unknown: 'var(--fg-warn)',
} as const

interface Overall {
  tone: keyof typeof TONE_COLOR
  label: string
  detail: string
}

interface DebugFields {
  code: string
  bugs: string[]
  fixedCode: string
}

/** 分片字段是索引签名（unknown），这里按 schema debug 分支收窄：code / bugs / fixed_code 均 required */
function readDebug(problem: ProblemRecord): DebugFields {
  const code = typeof problem.code === 'string' ? problem.code : ''
  const rawBugs = Array.isArray(problem.bugs) ? problem.bugs : []
  const bugs = rawBugs.filter((b): b is string => typeof b === 'string')
  const fixedCode = typeof problem.fixed_code === 'string' ? problem.fixed_code : ''
  return { code, bugs, fixedCode }
}

/**
 * 第 2 级提示的行号**不采信 bugs 文本里的「第 N 行」**。
 * 2026-09-09 全量扫描（15 道 debug 题，逐行大小写敏感比对 code 与 fixed_code）发现
 * 14 道的 prose 行号与真实差异行不符：普遍偏移 ±1~±2（dbg-005 说 9/10 实为 7/8、
 * dbg-007 说 9/11 实为 7/10、dbg-014 说 4/11 实为 5/12），个别甚至指向非错误行。
 * 把 prose 行号直接给学生等于给错答案，所以这里改为现算真实差异行并折叠连续区间；
 * prose 只留在第 3 级讲「为什么错」。缺陷本身登记在 docs/待办-backlog.md（TODO 3），
 * 属内容阶段返工，渲染器不替它背锅。
 * 注：一处逻辑错误可能牵动多行（如形参改指针后函数体内所有解引用都要跟着改），
 * 故区间数可能多于 bugs 的处数，这是事实而非 bug。
 */
function diffLineRanges(buggy: string, fixed: string): [number, number][] {
  if (fixed.trim() === '') return []
  const a = buggy.split('\n')
  const b = fixed.split('\n')
  const n = Math.max(a.length, b.length)
  const out: [number, number][] = []
  for (let i = 0; i < n; i += 1) {
    const x = i < a.length ? a[i] : null
    const y = i < b.length ? b[i] : null
    if (x === y) continue
    const line = i + 1
    const last = out[out.length - 1]
    if (last && line === last[1] + 1) last[1] = line
    else out.push([line, line])
  }
  return out
}

/** 整批结论。优先级与 ProgrammingRenderer 同口径：全对 > 有真实失败 > 全部未判定 */
function summarize(report: BatchReport): Overall {
  const total = report.results.length
  const states = report.results.map((r) => r.response.state)
  const idle = `串行执行总耗时 ${report.totalMs} ms，缓存命中 ${report.cacheHits} 组`
  if (total > 0 && states.every((s) => s === 'accepted')) {
    return { tone: 'good', label: `判分通过：${total}/${total} 组用例输出正确`, detail: idle }
  }
  const firstBad = report.results.find((r) => !isInconclusive(r.response.state) && r.response.state !== 'accepted')
  const unknownCount = states.filter((s) => isInconclusive(s)).length
  if (firstBad) {
    const suffix = unknownCount > 0 ? `；另有 ${unknownCount} 组未判定（后端不可用）` : ''
    return {
      tone: 'bad',
      label: `未通过：${report.acceptedCount}/${total} 组正确，首个失败是第 ${firstBad.index} 组`,
      detail: `${STATE_LABEL[firstBad.response.state]} —— ${firstBad.response.summary}${suffix}`,
    }
  }
  return {
    tone: 'unknown',
    label: `本次未判定：${unknownCount}/${total} 组无法判分`,
    detail: '判分后端不可用，这属「未判定」而非「答错」，不计正确率、不置 verified。',
  }
}

interface Props {
  problem: ProblemRecord
}

export function DebugRenderer({ problem }: Props) {
  const fields = useMemo(() => readDebug(problem), [problem])
  const cases = useMemo(() => toProblemTestCases(problem.testCases), [problem.testCases])
  const [code, setCode] = useState<string>(fields.code)
  const [hintLevel, setHintLevel] = useState(0)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [report, setReport] = useState<BatchReport | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  /**
   * 阶段 5 · R5：按源码分流后端 —— 含 sqrt 一类数学函数的代码走 libm 支路
   * （默认 cg132 链不上 libm，选型证据见 src/judge/math-lib.ts 文件头）。
   * client.ts 的结果缓存键与跨标签页锁名都含 backend.id，所以每条支路必须各持一个
   * client 实例：这里用 Map 按后端 id 分桶，而不是单个 ref。
   */
  const clientsRef = useRef<Map<string, JudgeClient> | null>(null)

  /** 按修正后的全文挑后端（口径同 ProgrammingRenderer） */
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

  const submit = useCallback(async () => {
    if (running || cases.length === 0) return
    setRunning(true)
    setFatal(null)
    setReport(null)
    setProgress({ caseIndex: 1, total: cases.length, status: { running: 0, waiting: 0, ahead: 0, concurrency: 0 } })
    const outcome = await runStdinTests(getClient(code), code, cases, (p) => setProgress(p))
    setRunning(false)
    setProgress(null)
    if (outcome.kind === 'done') {
      setReport(outcome.report)
      // 模块 5：判分结论落盘（口径同 ProgrammingRenderer，未判定不写记录）
      // 阶段 5：存修正后的全文，回看时能看到自己当时怎么改的
      recordBatchAttempt(problem.id, outcome.report.results, { text: code, kind: 'code' })
    } else setFatal(outcome.summary)
  }, [cases, code, getClient, problem.id, running])

  const reset = useCallback(() => {
    if (running) return
    setCode(fields.code)
    setReport(null)
    setFatal(null)
  }, [fields.code, running])

  const overall = report ? summarize(report) : null
  const unknownCount = report ? report.results.filter((r) => isInconclusive(r.response.state)).length : 0
  const solved = overall?.tone === 'good'
  const diffRanges = useMemo(() => diffLineRanges(fields.code, fields.fixedCode), [fields.code, fields.fixedCode])
  const lineText = diffRanges.length === 0
    ? '本题未提供参考修正代码，无法自动定位行号，请直接看提示 3'
    : diffRanges.map(([a, b]) => (a === b ? `第 ${a} 行` : `第 ${a}–${b} 行`)).join('、')

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4" style={panel}>
        <h2 className="text-sm font-semibold" style={muted}>题目要求</h2>
        <p className="mt-2 text-sm whitespace-pre-wrap">{problem.stem}</p>
        <p className="mt-2 text-xs" style={muted}>
          下方编辑器里是带错误的代码，直接在其中修改；改完点「提交判分」，系统会把你的代码逐组运行并与期望输出比对。
        </p>
      </section>

      <section className="rounded-xl border p-4" style={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold" style={muted}>程序代码（整段可编辑）</h2>
          <span className="ml-auto text-xs" style={muted}>
            找不出错时可以逐级展开提示；提示不改变判分口径
          </span>
        </div>

        <div className="mt-3">
          <CodeEditor
            value={code}
            onChange={setCode}
            rows={Math.max(12, fields.code.split('\n').length + 2)}
            ariaLabel="程序改错代码编辑器（直接修改错误）"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={running || cases.length === 0}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent, #2563eb)' }}
          >
            {running ? '判分中…' : `提交判分（${cases.length} 组）`}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={running}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            恢复原始代码
          </button>
          {running && progress && (
            <span className="text-xs" style={muted}>
              正在串行执行第 {progress.caseIndex}/{progress.total} 组…
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border p-4" style={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold" style={muted}>自查提示（默认全隐藏）</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            {hintLevel === 0 && (
              <button
                type="button"
                onClick={() => setHintLevel(1)}
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{ borderColor: 'var(--border)' }}
              >
                卡住了？提示 1：有几处错误
              </button>
            )}
            {hintLevel === 1 && (
              <button
                type="button"
                onClick={() => setHintLevel(2)}
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{ borderColor: 'var(--border)' }}
              >
                提示 2：错在哪几行
              </button>
            )}
            {hintLevel === 2 && (
              <button
                type="button"
                onClick={() => setHintLevel(3)}
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{ borderColor: 'var(--border)' }}
              >
                提示 3：错误原因
              </button>
            )}
          </div>
        </div>

        {hintLevel >= 1 && (
          <p data-hint="1" className="mt-3 text-sm">
            本题共有 <strong>{fields.bugs.length}</strong> 处错误。
          </p>
        )}
        {hintLevel >= 2 && (
          <p data-hint="2" className="mt-2 text-sm">
            需要改动的行：{lineText}。行号对应编辑器里<strong>原始带错代码</strong>的行；
            一处逻辑错误可能牵动多行（例如形参改成指针后函数体内的解引用都要跟着改），
            所以行数可能多于提示 1 里的处数。
          </p>
        )}
        {hintLevel >= 3 && (
          <ol data-hint="3" className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            {fields.bugs.map((b, i) => (
              <li key={i} className="whitespace-pre-wrap">{b}</li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs" style={muted}>
          提示只服务于自查：展开与否不影响判分，也不计入进度；先自己读代码再开提示，收获更大。
        </p>
      </section>

      {fatal && (
        <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR.unknown }}>
          <p className="text-sm" style={{ color: TONE_COLOR.unknown }}>{fatal}</p>
        </section>
      )}

      {overall && report && (
        <>
          <section role="status" aria-live="polite" className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR[overall.tone] }}>
            <p className="text-base font-semibold" style={{ color: TONE_COLOR[overall.tone] }}>{overall.label}</p>
            <p className="mt-1 text-sm" style={muted}>{overall.detail}</p>
            {unknownCount > 0 && (
              <p className="mt-2 text-xs" style={{ color: TONE_COLOR.unknown }}>
                其中 {unknownCount} 组走的是降级 / 未判定路径：不计正确率、不置 verified。
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold" style={muted}>
              用例级判分结果（{report.acceptedCount}/{report.results.length} 组通过）
            </h2>
            {report.results.map((r) => (
              <CaseCard key={r.index} result={r} />
            ))}
          </section>
        </>
      )}

      {solved && (
        <section className="rounded-xl border p-4" style={{ ...panel, borderColor: TONE_COLOR.good }}>
          <h2 className="text-sm font-semibold" style={{ color: TONE_COLOR.good }}>
            答对了！参考修正代码与完整解析
          </h2>
          <div className="mt-2 text-xs" style={muted}>参考修正代码（fixed_code）</div>
          <pre
            className="mt-1 overflow-x-auto rounded-lg border p-3 text-xs"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: MONO_FONT }}
          >
            {fields.fixedCode}
          </pre>
          <div className="mt-3 text-xs" style={muted}>完整解析</div>
          <p className="mt-1 text-sm whitespace-pre-wrap">{problem.explanation ?? '（本题暂无解析）'}</p>
        </section>
      )}
    </div>
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
        <p className="mt-2 text-xs" style={{ color: TONE_COLOR.bad }}>
          首处差异在第 {diff} 行。归一化规则：CRLF→LF、逐行剥行尾空白、剥末尾换行；行中空行与行尾空格保留后再剥。
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