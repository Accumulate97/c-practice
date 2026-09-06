/**
 * 判分模块实测台（阶段 2 的验收页面，不是面向学习者的功能）。
 * 用途：在真实浏览器环境里验证 Godbolt 后端的四类行为 ——
 *   正常输出比对 / 编译错误 / 运行期崩溃 / 运行超时，
 *   以及「一道编程题 4 组用例串行」的端到端耗时与降级路径。
 * 访问路径：#/judge-lab
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { getBackend } from '../judge'
import { JudgeClient, type ProblemTestCase } from '../judge/client'
import { JudgeTransportError } from '../judge/types'
import type { BatchReport, JudgeBackend, JudgeProgress, JudgeResponse, QueueStatus, RunRequest } from '../judge/types'
import { normalizeOutput } from '../judge/backends/base'

const REF_PROGRAM = [
  '#include <stdio.h>',
  'int main(void) {',
  '    int n, i, j, sum, found = 0;',
  '    scanf("%d", &n);',
  '    for (i = 2; i <= n; i++) {',
  '        sum = 1;',
  '        for (j = 2; j * j <= i; j++)',
  '            if (i % j == 0) {',
  '                sum += j;',
  '                if (j != i / j) sum += i / j;',
  '            }',
  '        if (sum == i) { printf("%d\\n", i); found = 1; }',
  '    }',
  '    if (!found) printf("None\\n");',
  '    return 0;',
  '}',
].join('\n')

/** 构建期预存的真实输出（已于 2026-09-06 用 Godbolt 跑通，见 ADR-0001 第 8 节） */
const PRECOMPUTED: Record<string, string> = {
  '10': '6',
  '1000': '6\n28\n496',
  '2': 'None',
  '6': '6',
}

const REF_CASES: ProblemTestCase[] = [
  { stdin: '10', expected: '6', note: '典型输入' },
  { stdin: '1000', expected: '6\n28\n496', note: '多结果' },
  { stdin: '2', expected: 'None', note: '边界：无解' },
  { stdin: '6', expected: '6', note: '边界：刚好等于' },
]

interface Preset {
  key: string
  label: string
  code: string
  stdin: string
  expected: string
  multi?: boolean
}

const PRESETS: Preset[] = [
  { key: 'ref', label: '① 参考程序（4 组用例）', code: REF_PROGRAM, stdin: '10', expected: '6', multi: true },
  {
    key: 'wrong', label: '② 答案不全（判 wrong-answer）', code: REF_PROGRAM, stdin: '1000', expected: '6\n28',
  },
  {
    key: 'compile', label: '③ 漏分号（判 compile-error）',
    code: '#include <stdio.h>\nint main(void) {\n    int n = 3\n    printf("%d\\n", n);\n    return 0;\n}',
    stdin: '', expected: '3',
  },
  {
    key: 'runtime', label: '④ scanf 漏 &（判 runtime-error）',
    code: '#include <stdio.h>\nint main(void) {\n    int n;\n    scanf("%d", n);\n    printf("%d\\n", n);\n    return 0;\n}',
    stdin: '5', expected: '5',
  },
  {
    // 注意：先前版本用 while (i < 10) i = i - 1; 制造「死循环」，实测有 bug——
    // 有符号溢出在此编译选项下回绕，循环会结束并打印 2147483647，判成 wrong-answer。
    // 下面换成真正不会退出的忙等（volatile 阻止优化掉循环），用来验证 timeout 分类。
    key: 'timeout', label: '⑤ 死循环（判 timeout；Godbolt 在 20 s 处 SIGKILL，约 21 s 才返回）',
    code: '#include <stdio.h>\nint main(void) {\n    volatile int spin = 0;\n    while (1) spin = spin + 1;\n    printf("%d\\n", spin);\n    return 0;\n}',
    stdin: '', expected: '0',
  },
]

/** 只用于验证降级路径的后端替身 —— 顺便证明 JudgeBackend 契约 10 行就能实现 */
const OFFLINE_BACKEND: JudgeBackend = {
  id: 'offline-sim',
  maxConcurrency: 1,
  minIntervalMs: 0,
  timeoutMs: 1_000,
  async execute(): Promise<never> {
    throw new JudgeTransportError('network', '（模拟）判分后端不可达')
  },
}

const STATE_LABEL: Record<JudgeResponse['state'], string> = {
  accepted: '✓ 通过',
  'wrong-answer': '✗ 输出不符',
  'compile-error': '✗ 编译错误',
  'runtime-error': '✗ 运行崩溃',
  timeout: '✗ 运行超时',
  truncated: '✗ 输出截断',
  degraded: '⚠ 降级自评',
  'backend-unavailable': '⚠ 后端不可用',
}

const STATE_COLOR: Record<JudgeResponse['state'], string> = {
  accepted: 'var(--color-viz-sorted)',
  'wrong-answer': 'var(--color-viz-swap)',
  'compile-error': 'var(--color-viz-swap)',
  'runtime-error': 'var(--color-viz-swap)',
  timeout: 'var(--color-viz-swap)',
  truncated: 'var(--color-viz-swap)',
  degraded: 'var(--color-viz-compare)',
  'backend-unavailable': 'var(--color-viz-compare)',
}
/** 降级时的预存输出查询：只认参考程序，其它代码一律不编造 */
function lookupPrecomputed(code: string, stdin: string): string | null {
  if (normalizeOutput(code) !== normalizeOutput(REF_PROGRAM)) return null
  return PRECOMPUTED[stdin.trim()] ?? null
}

export function JudgeLabPage() {
  const [presetKey, setPresetKey] = useState('ref')
  const [code, setCode] = useState(PRESETS[0]?.code ?? '')
  const [stdin, setStdin] = useState(PRESETS[0]?.stdin ?? '')
  const [expected, setExpected] = useState(PRESETS[0]?.expected ?? '')
  const [single, setSingle] = useState<JudgeResponse | null>(null)
  const [singleMs, setSingleMs] = useState<number | null>(null)
  const [batch, setBatch] = useState<BatchReport | null>(null)
  const [progress, setProgress] = useState<JudgeProgress | null>(null)
  const [status, setStatus] = useState<QueueStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const startedAt = useRef(0)

  const client = useMemo(
    () =>
      new JudgeClient(offline ? OFFLINE_BACKEND : getBackend(), {
        precomputed: lookupPrecomputed,
        onStatus: (s) => setStatus(s),
      }),
    [offline],
  )

  const note = useCallback((msg: string) => {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLog((prev) => [`${stamp}  ${msg}`, ...prev].slice(0, 12))
  }, [])

  function applyPreset(key: string): void {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    setPresetKey(key)
    setCode(p.code)
    setStdin(p.stdin)
    setExpected(p.expected)
    setSingle(null)
    setBatch(null)
    setProgress(null)
  }

  async function runSingle(compileOnly: boolean): Promise<void> {
    setBusy(true)
    setBatch(null)
    setSingle(null)
    setProgress(null)
    const req: RunRequest = { code, stdin, compileOnly }
    startedAt.current = performance.now()
    note(compileOnly ? '提交：仅编译' : '提交：编译并运行（单组用例）')
    try {
      const res = await client.run(req, expected)
      setSingleMs(Math.round(performance.now() - startedAt.current))
      setSingle(res)
      note(`${STATE_LABEL[res.state]} · ${res.summary}`)
    } finally {
      setBusy(false)
    }
  }

  async function runBatch(): Promise<void> {
    setBusy(true)
    setSingle(null)
    setBatch(null)
    setProgress(null)
    note('提交：4 组用例串行（每请求一个执行任务，不用并发）')
    try {
      const rep = await client.runTests(code, REF_CASES, setProgress)
      setBatch(rep)
      note(`串行完成：${rep.acceptedCount}/${rep.results.length} 通过，总耗时 ${rep.totalMs} ms`)
    } finally {
      setBusy(false)
    }
  }
  const verdictText =
    batch === null
      ? null
      : batch.totalMs < 5000
        ? `总耗时 ${batch.totalMs} ms < 5000 ms → 采纳串行方案，刷题页 UI 显示「第 N/M 组」进度`
        : batch.totalMs <= 8000
          ? `总耗时 ${batch.totalMs} ms 落在 5–8 s 灰区 → 串行仍可用，但需持续观察`
          : `总耗时 ${batch.totalMs} ms > 8000 ms → 已达上报条件，需重新评估批处理 runner`

  const box = { borderColor: 'var(--border)' } as const

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">🧪 判分实测台 JudgeLab</h1>
      <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
        阶段 2 交付物 <code>src/judge/</code> 的验收页面。后端：
        <b>{client.backend.id}</b>（并发上限 {status?.concurrency ?? client.backend.maxConcurrency}，
        最小间隔 {client.backend.minIntervalMs} ms，软超时 {client.backend.timeoutMs} ms）。
        这里跑的是真实网络请求，不是 mock。判分口径见 <code>04_题型规范与样例.md</code> 第〇节。
      </p>

      <section className="rounded-xl border p-4" style={box}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor="preset">样例</label>
          <select id="preset" value={presetKey} onChange={(e) => applyPreset(e.target.value)}
            className="rounded-md border bg-transparent px-2 py-1" style={box}>
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
            模拟后端不可用（验证降级路径）
          </label>
          {busy && <span style={{ color: 'var(--color-viz-compare)' }}>
            {progress ? `第 ${progress.caseIndex}/${progress.total} 组进行中…` : '请求进行中…'}
          </span>}
        </div>

        <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} rows={14}
          aria-label="C 代码" className="mt-3 w-full rounded-md border bg-transparent p-3 font-mono text-xs" style={box} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">stdin
            <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false} rows={3}
              className="mt-1 w-full rounded-md border bg-transparent p-2 font-mono text-xs" style={box} />
          </label>
          <label className="text-sm">expected（不写末尾换行）
            <textarea value={expected} onChange={(e) => setExpected(e.target.value)} spellCheck={false} rows={3}
              className="mt-1 w-full rounded-md border bg-transparent p-2 font-mono text-xs" style={box} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void runSingle(false)} className={BTN} style={box}>编译并运行</button>
          <button type="button" disabled={busy} onClick={() => void runSingle(true)} className={BTN} style={box}>仅编译</button>
          <button type="button" disabled={busy} onClick={() => void runBatch()} className={BTN} style={box}>
            4 组用例串行 + 耗时报告
          </button>
          <span className="self-center text-xs" style={{ color: 'var(--fg-muted)' }}>
            队列 running={status?.running ?? 0} waiting={status?.waiting ?? 0} 缓存 {client.cacheSize} 条
            {client.inCooldown > 0 ? ` · 冷却中 ${Math.ceil(client.inCooldown / 1000)}s` : ''}
          </span>
        </div>
      </section>
      {single && (
        <section className="rounded-xl border p-4" style={box}>
          <div className="flex flex-wrap items-center gap-3">
            <b style={{ color: STATE_COLOR[single.state] }}>{STATE_LABEL[single.state]}</b>
            <span className="text-sm">{single.summary}</span>
            {singleMs !== null && <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>端到端 {singleMs} ms</span>}
            {single.source === 'precomputed' && <span className="text-xs" style={{ color: 'var(--color-viz-compare)' }}>数据来自构建期预存</span>}
          </div>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <pre className="overflow-auto rounded-md border p-2 font-mono" style={box}>实际输出：{single.actual || '(空)'}</pre>
            <pre className="overflow-auto rounded-md border p-2 font-mono" style={box}>期望输出：{single.expected || '(空)'}</pre>
          </div>
          {single.diagnostics.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <thead><tr className="text-left" style={{ color: 'var(--fg-muted)' }}>
                <th className="py-1">位置</th><th>级别</th><th>信息</th></tr></thead>
              <tbody>
                {single.diagnostics.map((d, i) => (
                  <tr key={`${d.line}:${d.column}:${i}`}>
                    <td className="py-1 font-mono">{d.line}:{d.column}</td>
                    <td style={{ color: d.severity === 'error' ? 'var(--color-viz-swap)' : 'var(--color-viz-compare)' }}>
                      {d.severity === 'error' ? '错误' : '警告'}
                    </td>
                    <td className="font-mono">{d.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {batch && (
        <section className="rounded-xl border p-4" style={box}>
          <h2 className="text-sm font-semibold">4 组用例串行实测报告</h2>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="text-left" style={{ color: 'var(--fg-muted)' }}>
              <th className="py-1">组</th><th>stdin</th><th>判定</th><th>耗时</th><th>缓存</th><th>说明</th></tr></thead>
            <tbody>
              {batch.results.map((r) => (
                <tr key={r.index} className="border-t" style={box}>
                  <td className="py-1 font-mono">{r.index}</td>
                  <td className="font-mono">{r.stdin || '(空)'}</td>
                  <td style={{ color: STATE_COLOR[r.response.state] }}>{STATE_LABEL[r.response.state]}</td>
                  <td className="font-mono">{r.ms} ms</td>
                  <td>{r.cacheHit ? '命中' : '—'}</td>
                  <td style={{ color: 'var(--fg-muted)' }}>{r.note ? `${r.note} · ` : ''}{r.response.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm">
            各请求耗时：{batch.timings.join(' / ')} ms；
            总耗时 <b>{batch.totalMs} ms</b>；通过 {batch.acceptedCount}/{batch.results.length}；缓存命中 {batch.cacheHits} 次。
          </p>
          {verdictText && <p className="mt-1 text-sm font-medium" style={{ color: 'var(--color-brand)' }}>{verdictText}</p>}
        </section>
      )}

      <section className="rounded-xl border p-4" style={box}>
        <h2 className="text-sm font-semibold">操作日志</h2>
        <ul className="mt-2 space-y-1 font-mono text-xs" style={{ color: 'var(--fg-muted)' }}>
          {log.length === 0 ? <li>（暂无）</li> : log.map((l, i) => <li key={`${l}:${i}`}>{l}</li>)}
        </ul>
      </section>

      <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
        说明：④ 与 ⑤ 两个样例是故意写错的学生代码，用来验证错误分类，不是题目内容；
        ⑤ 的等待时长由后端自身的执行时限决定，不是本站软超时。
      </p>
    </div>
  )
}

const BTN =
  'rounded-md border px-3 py-1.5 text-sm disabled:opacity-50'