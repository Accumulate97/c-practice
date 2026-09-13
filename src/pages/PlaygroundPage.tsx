/**
 * 代码游乐场（任务 3-1）：/#/playground
 *
 * 定位：JudgeLab 从「阶段 2 的后端验收台」升级成面向学习者的正式板块。
 * JudgeLab 保留（#/judge-lab，页脚入口）—— 它验的是判分链路的四类结论，是开发工具；
 * 本页是学生自己写代码、自己看后果的地方，两者不合并，各自口径清晰。
 *
 * 四条设计红线：
 *   ① 编译/执行一律走 src/judge 的注册表后端（getBackendFor），页面里不出现任何 fetch。
 *      串行队列、跨标签页互斥、软超时 25 s、限流退避全部继承 JudgeClient，不另写一套。
 *   ② 后端故障必须**诚实**：抛 JudgeTransportError 就如实说「本次未判定：后端不可用」，
 *      绝不用缓存或预存输出冒充一次成功运行（AGENTS.md 二·5 的降级纪律同样适用于此）。
 *   ③ 换编译器不改判分口径：题目判分永远 cg132，本页顶部常驻这句话，避免
 *      「我在游乐场用 Clang 跑过了」被当成判分依据。
 *   ④ 代码会离开本机：Godbolt 是第三方公共服务，源码与 stdin 会被发到 godbolt.org。
 *      这条写在页面上，不藏在文档里。
 *
 * 体积：本页走路由级 lazy，CodeMirror 只有进来才下载，首页零负担。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { STORAGE_PREFIX, judge, playgroundCompilers, PLAYGROUND_DEFAULT_COMPILER } from '../app/config'
import { getBackendFor } from '../judge'
import { JudgeClient } from '../judge/client'
import { JudgeTransportError } from '../judge/types'
import type { CompileDiag, ExecutionResult, QueueStatus } from '../judge/types'
import { PlaygroundEditor } from '../components/common/PlaygroundEditor'
import type { PlaygroundEditorHandle } from '../components/common/PlaygroundEditor'
import { loadProblem, ProblemNotFound } from '../modules/problems/data/loader'

const PLAYGROUND_KEY = `${STORAGE_PREFIX}:playground:v1`

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const btn: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }
const btnPrimary: CSSProperties = { borderColor: 'var(--color-brand)', background: 'var(--color-brand)', color: '#fff' }

const DEFAULT_CODE = `#include <stdio.h>

/* 在右边「标准输入」里填两个整数，用空格或换行分开 */
int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) {
        printf("请输入两个整数\\n");
        return 1;
    }
    printf("%d + %d = %d\\n", a, b, a + b);
    return 0;
}
`

const DEFAULT_STDIN = '3 4'

interface Example {
  key: string
  label: string
  code: string
  stdin: string
  /** 这个例子想让人看见什么后果，写在按钮旁边，别让人点了才知道 */
  expect: string
}

const EXAMPLES: Example[] = [
  {
    key: 'sum', label: '① 读入两个整数求和', stdin: '3 4', expect: '正常输出 7',
    code: DEFAULT_CODE,
  },
  {
    key: 'pointer', label: '② 指针与数组：地址怎么算', stdin: '', expect: '打印各元素地址差与值',
    code: `#include <stdio.h>

int main(void) {
    int a[5] = { 10, 20, 30, 40, 50 };
    int *p = a;
    int i;
    printf("sizeof(int) = %zu\\n", sizeof(int));
    for (i = 0; i < 5; i++) {
        /* p + i 与 a[i] 是同一件事，地址每次前进 sizeof(int) 个字节 */
        printf("a[%d] = %d, *(p+%d) = %d, 地址差 = %ld 字节\\n",
               i, a[i], i, *(p + i), (long)((char *)(p + i) - (char *)a));
    }
    return 0;
}
`,
  },
  {
    key: 'recursion', label: '③ 递归：调用栈怎么堆起来', stdin: '6', expect: '逐层缩进的调用轨迹',
    code: `#include <stdio.h>

void trace(int n, int depth) {
    int i;
    for (i = 0; i < depth; i++) printf("  ");
    printf("enter fact(%d)\\n", n);
    if (n <= 1) {
        for (i = 0; i < depth; i++) printf("  ");
        printf("return 1\\n");
        return;
    }
    trace(n - 1, depth + 1);
    for (i = 0; i < depth; i++) printf("  ");
    printf("leave fact(%d)\\n", n);
}

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) n = 5;
    trace(n, 0);
    return 0;
}
`,
  },
  {
    key: 'malloc', label: '④ 堆内存：malloc / free 配对', stdin: '', expect: '分配与释放的成对日志',
    code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *p = malloc(5 * sizeof(int));
    int i;
    if (p == NULL) {
        printf("分配失败\\n");
        return 1;
    }
    printf("malloc 5 个 int 成功\\n");
    for (i = 0; i < 5; i++) p[i] = i * i;
    for (i = 0; i < 5; i++) printf("p[%d] = %d\\n", i, p[i]);
    free(p);
    p = NULL;   /* 释放后立刻置空，杜绝悬空指针 */
    printf("free 完成，p 已置 NULL\\n");
    return 0;
}
`,
  },
  {
    key: 'compile-error', label: '⑤ 故意漏分号（看诊断高亮）', stdin: '', expect: '编译失败，编辑器里标红出错行',
    code: `#include <stdio.h>

int main(void) {
    int n = 3
    printf("%d\\n", n);
    return 0;
}
`,
  },
  {
    key: 'warn', label: '⑥ 未使用变量 + 有符号比较（看 -Wall -Wextra）', stdin: '', expect: '能运行，但带警告',
    code: `#include <stdio.h>

int main(void) {
    int unused = 42;
    int i;
    for (i = 0; i < 5u; i++) printf("%d ", i);
    printf("\\n");
    return 0;
}
`,
  },
  {
    key: 'crash', label: '⑦ scanf 漏 &（运行期崩溃）', stdin: '7', expect: '段错误：非零退出码 + 空输出',
    code: `#include <stdio.h>

int main(void) {
    int n;
    /* 少写一个 & ：把 n 的**值**当成地址交给 scanf 去写，多半当场段错误 */
    scanf("%d", n);
    printf("%d\\n", n);
    return 0;
}
`,
  },
  {
    key: 'timeout', label: '⑧ 死循环（运行超时，约 20 秒）', stdin: '', expect: '后端 20 s 处 SIGKILL，判 timeout',
    code: `#include <stdio.h>

int main(void) {
    int i = 0;
    /* 没有出口的循环：Godbolt 会在约 20 秒处强杀，本站软超时 25 秒所以能等到结论 */
    for (;;) {
        i++;
        if (i < 0) printf("never\\n");
    }
    return 0;
}
`,
  },
]

/** errorClass → 一句人话。判分口径与 verdict() 一致，只是这里不比对期望输出 */
const CLASS_TEXT: Record<ExecutionResult['errorClass'], string> = {
  ok: '运行结束',
  'compile-error': '编译失败（未生成可执行文件）',
  'runtime-error': '运行期崩溃（进程被信号杀死或非零退出）',
  timeout: '运行超时（后端在约 20 秒处强杀）',
  truncated: '输出过长被截断',
}

interface Persisted {
  code?: unknown
  stdin?: unknown
  compiler?: unknown
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(PLAYGROUND_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Persisted) : null
  } catch {
    return null   // localStorage 被禁用 / 数据被写坏：当没有存过，用默认模板
  }
}

const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** 题目记录是宽类型（[key: string]: unknown），取代码字段必须逐个验类型 */
function pickCode(rec: Record<string, unknown>): string | null {
  for (const k of ['code', 'code_starter', 'fixed_code', 'solution', 'reference']) {
    const v = asText(rec[k])
    if (v && v.includes('#include')) return v
  }
  for (const k of ['code', 'code_starter', 'fixed_code', 'solution', 'reference']) {
    const v = asText(rec[k])
    if (v && v.trim().length > 0) return v
  }
  return null
}

export function PlaygroundPage() {
  const [params] = useSearchParams()
  const problemId = params.get('problem') ?? ''
  const savedRef = useRef<Persisted | null>(null)
  if (savedRef.current === null) savedRef.current = readPersisted() ?? {}
  // 取成局部常量再用：ref.current 在 useState 的初始化闭包里不参与 TS 的 null 收窄
  const saved: Persisted = savedRef.current

  const [code, setCode] = useState<string>(() => asText(saved.code) ?? DEFAULT_CODE)
  const [stdin, setStdin] = useState<string>(() => asText(saved.stdin) ?? DEFAULT_STDIN)
  const [compiler, setCompiler] = useState<string>(() => {
    const c = asText(saved.compiler) ?? ''
    return playgroundCompilers.some((x) => x.id === c) ? c : PLAYGROUND_DEFAULT_COMPILER
  })
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const [cacheHit, setCacheHit] = useState(false)
  const [wallMs, setWallMs] = useState<number | null>(null)
  const [mode, setMode] = useState<'exec' | 'build'>('exec')
  const [failure, setFailure] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [loadedFrom, setLoadedFrom] = useState<{ id: string; title: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const editorRef = useRef<PlaygroundEditorHandle>(null)

  const compilerMeta = useMemo(
    () => playgroundCompilers.find((c) => c.id === compiler) ?? playgroundCompilers[0],
    [compiler],
  )
  /** 每个编译器一个 JudgeClient（各自的缓存与跨标签页锁），换编译器就换一个 */
  const client = useMemo(
    () => new JudgeClient(getBackendFor(compiler), { onStatus: (s) => setQueue(s) }),
    [compiler],
  )

  // 本机存档：写坏也不影响使用，所以整段 try 包住，失败只在控制台说一声
  useEffect(() => {
    try {
      localStorage.setItem(PLAYGROUND_KEY, JSON.stringify({ code, stdin, compiler }))
    } catch {
      /* 隐私模式下 localStorage 可能不可用，忽略 */
    }
  }, [code, stdin, compiler])

  // 从题目载入：/#/playground?problem=<id>，题目详情页「在游乐场打开」走这条路
  useEffect(() => {
    if (!problemId) return
    let alive = true
    setLoadError(null)
    loadProblem(problemId).then(
      (loaded) => {
        if (!alive) return
        const rec = loaded.problem as unknown as Record<string, unknown>
        const picked = pickCode(rec)
        if (!picked) { setLoadError(`题目 ${problemId} 没有可直接运行的完整代码（可能是选择题或填空题）`); return }
        const cases = Array.isArray(rec.testCases) ? (rec.testCases as { stdin?: unknown }[]) : []
        setCode(picked)
        setStdin(asText(cases[0]?.stdin) ?? '')
        setLoadedFrom({ id: problemId, title: asText(rec.stem)?.slice(0, 40) ?? problemId })
        setResult(null)
        setFailure(null)
      },
      (error: unknown) => {
        if (!alive) return
        setLoadError(error instanceof ProblemNotFound ? error.message : `载入 ${problemId} 失败：${String(error)}`)
      },
    )
    return () => { alive = false }
  }, [problemId])

  const run = useCallback(async (only: 'exec' | 'build') => {
    if (running) return
    setRunning(true)
    setMode(only)
    setFailure(null)
    setResult(null)
    setCacheHit(false)
    setWallMs(null)
    const t0 = performance.now()
    try {
      // 只编译时 stdin 仍要给空串（RunRequest 的约定：无输入传 ''，不传 undefined）
      const res = await client.request({ code, stdin: only === 'exec' ? stdin : '', compileOnly: only === 'build' })
      setResult(res.result)
      setCacheHit(res.cacheHit)
    } catch (error) {
      // 传输层故障：如实报告，不伪造输出、不拿旧结果顶
      const msg = error instanceof JudgeTransportError
        ? `本次未判定：编译后端不可用（${error.kind}${error.status ? ` · HTTP ${error.status}` : ''}）—— ${error.message}`
        : `本次未判定：${String(error)}`
      setFailure(msg)
    } finally {
      setWallMs(Math.round(performance.now() - t0))
      setRunning(false)
      setQueue(null)
    }
  }, [client, code, running, stdin])

  const diagnostics: readonly CompileDiag[] = result?.diagnostics ?? []
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')
  const state = result?.errorClass ?? null

  return (
    <div className="space-y-4" data-role="playground-page">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">🧪 代码游乐场</h1>
        <p className="text-sm" style={muted}>
          自己写 C 代码、自己看后果：支持标准输入、可切换编译器、编译错误按行列出并高亮到编辑器里。
        </p>
        <p className="rounded-md border px-3 py-2 text-xs" style={{ ...panel, borderColor: 'var(--color-viz-compare)' }}>
          ⚠️ 两点如实说明：
          ① 代码与标准输入会发送到第三方公共服务 <strong>godbolt.org</strong> 在线编译执行，别贴隐私内容；
          ② 题目判分永远用 <strong>GCC 13.2（cg132）</strong>，本页换编译器只影响你自己的探索，不改判分结论。
        </p>
      </header>

      {loadError ? (
        <p className="rounded-md border px-3 py-2 text-sm" style={{ ...panel, borderColor: 'var(--fg-bad)', color: 'var(--fg-bad)' }} data-role="playground-load-error">
          {loadError}
        </p>
      ) : null}
      {loadedFrom ? (
        <p className="rounded-md border px-3 py-2 text-xs" style={panel} data-role="playground-loaded-from">
          已从题目 <Link to={`/problems/p/${loadedFrom.id}`} className="underline" style={{ color: 'var(--fg-link)' }}>{loadedFrom.id}</Link> 载入代码：{loadedFrom.title}…
        </p>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ── 左：编辑器 + 工具条 + stdin ── */}
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2" style={panel}>
            <label className="flex items-center gap-2 text-sm" htmlFor="pg-compiler">
              编译器
              <select
                id="pg-compiler"
                data-role="playground-compiler"
                value={compiler}
                onChange={(e) => setCompiler(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={btn}
              >
                {playgroundCompilers.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            <span className="text-xs" style={muted} data-role="playground-compiler-note">{compilerMeta.note}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-role="playground-run"
                aria-label="运行（Ctrl+Enter）"
                onClick={() => void run('exec')}
                disabled={running}
                className="rounded-md border px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                style={btnPrimary}
              >
                {running ? '⏳ 运行中…' : '▶ 运行'}
              </button>
              <button
                type="button"
                data-role="playground-compile"
                aria-label="只编译不运行"
                title="只要编译诊断，不执行程序（不打 20 秒的超时风险）"
                onClick={() => void run('build')}
                disabled={running}
                className="rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                style={btn}
              >
                🔨 只编译
              </button>
            </span>
          </div>

          <PlaygroundEditor
            ref={editorRef}
            value={code}
            onChange={setCode}
            onRun={() => void run('exec')}
            diagnostics={diagnostics}
            disabled={running}
            minHeight={340}
            ariaLabel="C 代码编辑器（Ctrl+Enter 运行）"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs" style={muted}>
            <span>示例：</span>
            <select
              data-role="playground-example"
              aria-label="载入示例代码"
              value=""
              onChange={(e) => {
                const ex = EXAMPLES.find((x) => x.key === e.target.value)
                if (!ex) return
                setCode(ex.code)
                setStdin(ex.stdin)
                setResult(null)
                setFailure(null)
              }}
              className="min-w-0 max-w-full flex-1 rounded border px-2 py-1.5 sm:flex-none"
              style={btn}
            >
              <option value="">选一个示例载入…</option>
              {EXAMPLES.map((ex) => (
                <option key={ex.key} value={ex.key}>{ex.label}（{ex.expect}）</option>
              ))}
            </select>
            <button
              type="button"
              data-role="playground-reset"
              onClick={() => { setCode(DEFAULT_CODE); setStdin(DEFAULT_STDIN); setResult(null); setFailure(null) }}
              className="rounded border px-2 py-1.5"
              style={btn}
            >
              ↺ 恢复默认模板
            </button>
            <span className="ml-auto">编译参数固定 <code>{judge.userArguments}</code></span>
          </div>

          <div className="space-y-1">
            <label className="block text-sm" htmlFor="pg-stdin">
              标准输入 stdin（程序的 <code>scanf</code> 从这里读；多组数据按题目要求换行）
            </label>
            <textarea
              id="pg-stdin"
              data-role="playground-stdin"
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ ...panel, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}
            />
          </div>
        </section>

        {/* ── 右：结果 ── */}
        <section className="min-w-0 space-y-3">
          <div className="rounded-lg border p-3" style={panel} aria-live="polite">
            <h2 className="text-sm font-semibold">运行结果</h2>
            {running ? (
              <p className="mt-2 text-sm" style={muted} data-role="playground-busy">
                ⏳ 正在{mode === 'build' ? '编译' : '编译并运行'}…
                {queue && queue.waiting > 0 ? `（前面还有 ${queue.waiting} 个请求，本站严格串行不打并发）` : ''}
                <span className="block text-xs">Godbolt 是排队不是限流，冷跑一次通常 0.5–3 秒；死循环要等约 20 秒</span>
              </p>
            ) : failure ? (
              <p className="mt-2 rounded border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--fg-bad)', color: 'var(--fg-bad)' }} data-role="playground-error">
                {failure}
              </p>
            ) : result === null ? (
              <p className="mt-2 text-sm" style={muted} data-role="playground-empty">
                还没运行过。点「▶ 运行」或按 Ctrl+Enter；想只看编译诊断就点「🔨 只编译」。
              </p>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                <p
                  data-role="playground-state"
                  data-state={state ?? 'ok'}
                  className="rounded px-2 py-1 font-medium"
                  style={{
                    background: 'var(--bg)',
                    color: state === 'ok' ? 'var(--fg-ok)' : state === 'timeout' || state === 'truncated' ? 'var(--fg-warn)' : 'var(--fg-bad)',
                  }}
                >
                  {state === 'ok' ? '✅ ' : '❌ '}{CLASS_TEXT[state ?? 'ok']}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" style={muted} data-role="playground-facts">
                  <dt>编译器</dt><dd style={{ color: 'var(--fg)' }}>{compilerMeta.label}</dd>
                  <dt>退出码</dt><dd style={{ color: 'var(--fg)' }}>{result.exitCode}</dd>
                  <dt>执行耗时</dt><dd style={{ color: 'var(--fg)' }}>{result.execTimeMs != null ? `${result.execTimeMs} ms` : '（未执行）'}</dd>
                  <dt>请求往返</dt><dd style={{ color: 'var(--fg)' }}>{wallMs != null ? `${wallMs} ms` : '—'}</dd>
                  <dt>网络请求</dt><dd style={{ color: 'var(--fg)' }}>{cacheHit ? '0（命中本站结果缓存）' : '1'}</dd>
                </dl>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3" style={panel}>
            <h2 className="text-sm font-semibold">标准输出 stdout</h2>
            <pre
              data-role="playground-stdout"
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-xs"
              style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)' }}
            >
              {result && result.stdout.length > 0 ? result.stdout : '（空）'}
            </pre>
            {result && result.stderr.trim().length > 0 ? (
              <>
                <h2 className="mt-2 text-sm font-semibold">运行期 stderr</h2>
                <pre
                  data-role="playground-stderr"
                  className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-xs"
                  style={{ background: 'var(--bg)', color: 'var(--fg-bad)', border: '1px solid var(--border)' }}
                >
                  {result.stderr}
                </pre>
              </>
            ) : null}
          </div>

          <div className="rounded-lg border p-3" style={panel}>
            <h2 className="text-sm font-semibold">
              编译诊断
              <span className="ml-2 text-xs font-normal" style={muted} data-role="playground-diag-count">
                {errors.length} 个错误 · {warnings.length} 个警告
              </span>
            </h2>
            {diagnostics.length === 0 ? (
              <p className="mt-2 text-xs" style={muted} data-role="playground-diag-empty">
                {result === null ? '运行一次就能看到 -Wall -Wextra 的全部诊断。' : '这次编译干干净净，一条诊断都没有。'}
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs" data-role="playground-diagnostics">
                {diagnostics.map((d, i) => (
                  <li key={`${d.line}:${d.column}:${i}`}>
                    <button
                      type="button"
                      data-role="playground-diag-item"
                      data-line={d.line}
                      data-severity={d.severity}
                      onClick={() => editorRef.current?.revealLine(d.line)}
                      className="w-full rounded border px-2 py-1.5 text-left"
                      style={{
                        ...btn,
                        borderColor: d.severity === 'error' ? 'var(--fg-bad)' : 'var(--fg-warn)',
                        color: d.severity === 'error' ? 'var(--fg-bad)' : 'var(--fg-warn)',
                      }}
                    >
                      第 {d.line} 行{d.column > 0 ? ` 第 ${d.column} 列` : ''}：{d.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {result && result.compilerMessage.trim().length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs" style={muted}>编译期完整输出</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-[11px]" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
                  {result.compilerMessage}
                </pre>
              </details>
            ) : null}
          </div>

          <div className="rounded-lg border p-3 text-xs" style={{ ...panel, color: 'var(--fg-muted)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>小贴士</h2>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>快捷键：编辑器里 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 直接运行。</li>
              <li>代码与输入会自动存在本机 localStorage，刷新不丢；「恢复默认模板」可清空。</li>
              <li>死循环不会被本站掐死：软超时 25 秒，比 Godbolt 自己的 20 秒长，所以能拿到「运行超时」这个真结论。</li>
              <li>想在题目里直接改代码试？题目详情页的「在游乐场打开」会把代码带过来。</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}
