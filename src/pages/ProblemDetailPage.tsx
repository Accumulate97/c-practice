import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PhasePlaceholder } from '../components/common/PhasePlaceholder'
import { ProblemNotFound, loadProblem } from '../modules/problems/data/loader'
import type { LoadedProblem } from '../modules/problems/data/loader'
import { CodeReadingRenderer } from '../modules/problems/renderers/CodeReadingRenderer'
import { ProgrammingRenderer } from '../modules/problems/renderers/ProgrammingRenderer'
import { DebugRenderer } from '../modules/problems/renderers/DebugRenderer'

/**
 * 题目详情页（阶段 4 模块 1 最简版）。
 *
 * 路由用 problems/p/:id 而不是 problems/:id —— 阶段 3 已经有 problems/:section
 * （SectionPage 占位），两者同层会产生歧义匹配。
 *
 * 数据流：index.json（唯一索引入口）→ 定位分片 file → 取分片 → 取单题 → 按 type 分派 Renderer。
 * 模块 1-2 接 programming / code_reading，其余题型显示占位（模块 3/4/5 逐个补）。
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'notfound'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LoadedProblem }

const TYPE_LABEL: Record<string, string> = {
  programming: '编程题',
  code_reading: '程序阅读写结果',
  code_completion: '程序填空',
  debug: '程序改错',
  single_choice: '选择题',
  true_false: '判断题',
  fill_blank: '填空题',
  code_ordering: '程序排序',
  complexity: '复杂度分析',
  short_answer: '简答题',
  matching: '匹配题',
}

/**
 * 程序填空渲染器按需加载：它拖着整套 CodeMirror 6
 * （@codemirror/state|view|language|commands|autocomplete + lang-cpp + @lezer/*），
 * 而这三类题里只有 code_completion 用得上。静态 import 会让编程题 / 阅读题页面
 * 陪着一起下载。fallback 是一句人话，不做骨架屏 —— 本地 chunk 毫秒级就到。
 */
const CodeCompletionRenderer = lazy(() =>
  import('../modules/problems/renderers/CodeCompletionRenderer').then((m) => ({
    default: m.CodeCompletionRenderer,
  })),
)

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

function stars(difficulty: number): string {
  const d = Math.min(5, Math.max(1, Math.round(difficulty) || 1))
  return '★'.repeat(d) + '☆'.repeat(5 - d)
}

export function ProblemDetailPage() {
  const { id = '' } = useParams()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadProblem(id).then(
      (data) => {
        if (alive) setPhase({ kind: 'ready', data })
      },
      (error: unknown) => {
        if (!alive) return
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof ProblemNotFound) setPhase({ kind: 'notfound', message })
        else setPhase({ kind: 'error', message })
      },
    )
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  return (
    <div className="space-y-4">
      <nav className="text-xs" style={muted}>
        <Link to="/problems" className="hover:underline">✍️ 在线刷题</Link>
        <span className="px-1">/</span>
        <span>{id || '（缺少题目 id）'}</span>
      </nav>

      {phase.kind === 'loading' && (
        <p className="text-sm" style={muted}>正在从题库分片加载 {id} …</p>
      )}

      {phase.kind === 'notfound' && (
        <section className="rounded-xl border p-6" style={{ ...panel, borderColor: 'var(--color-viz-swap)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-viz-swap)' }}>找不到这道题</p>
          <p className="mt-2 text-sm" style={muted}>{phase.message}</p>
          <p className="mt-2 text-xs" style={muted}>
            若列表页能显示但这里报「索引里没有」，说明 index.json 与分片不一致，跑 npm run build:index 重建索引。
          </p>
        </section>
      )}

      {phase.kind === 'error' && (
        <section className="rounded-xl border p-6" style={panel}>
          <p className="text-sm font-semibold">题库加载失败</p>
          <p className="mt-2 text-sm" style={muted}>{phase.message}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            重试
          </button>
        </section>
      )}

      {phase.kind === 'ready' && <Ready data={phase.data} />}
    </div>
  )
}

function Ready({ data }: { data: LoadedProblem }) {
  const { entry, problem } = data
  return (
    <>
      <header className="rounded-xl border p-4" style={panel}>
        <div className="flex flex-wrap items-center gap-2 text-xs" style={muted}>
          <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border)' }}>
            {TYPE_LABEL[problem.type] ?? problem.type}
          </span>
          <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border)' }}>
            难度 {stars(problem.difficulty)}
          </span>
          <span
            className="rounded-full border px-2 py-0.5"
            style={{
              borderColor: 'var(--border)',
              color: entry.verified ? 'var(--color-viz-sorted)' : 'var(--color-viz-compare)',
            }}
            title="verified 只允许 npm run judge:verify 在 Godbolt 实机编译+执行+比对通过后置位，禁止手填"
          >
            {entry.verified ? '✓ 已实机验证' : '○ 未实机验证'}
          </span>
          <span className="ml-auto">{problem.id}</span>
        </div>
        <h1 className="mt-2 text-lg font-semibold">{entry.chapter}</h1>
        <p className="text-xs" style={muted}>{entry.section}{entry.title ? ` · ${entry.title}` : ''}</p>
      </header>

      {problem.type === 'programming' ? (
        <ProgrammingRenderer problem={problem} />
      ) : problem.type === 'code_reading' ? (
        <CodeReadingRenderer problem={problem} />
      ) : problem.type === 'code_completion' ? (
        <Suspense fallback={<p className="text-sm" style={muted}>正在加载程序填空编辑器…</p>}>
          <CodeCompletionRenderer problem={problem} />
        </Suspense>
      ) : problem.type === 'debug' ? (
        <DebugRenderer problem={problem} />
      ) : (
        <>
          <section className="rounded-xl border p-4" style={panel}>
            <p className="text-sm whitespace-pre-wrap">{problem.stem}</p>
          </section>
          <PhasePlaceholder
            phase="阶段 4 模块 5"
            todo={[
              '模块 5：题目列表页（章节 / 难度 / 题型筛选）',
            ]}
          />
        </>
      )}
    </>
  )
}