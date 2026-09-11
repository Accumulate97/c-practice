import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ComponentType } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PhasePlaceholder } from '../components/common/PhasePlaceholder'
import { ProblemNotFound, loadProblem } from '../modules/problems/data/loader'
import type { LoadedProblem, ProblemRecord } from '../modules/problems/data/loader'
import { CodeReadingRenderer } from '../modules/problems/renderers/CodeReadingRenderer'
import { ProgrammingRenderer } from '../modules/problems/renderers/ProgrammingRenderer'
import { DebugRenderer } from '../modules/problems/renderers/DebugRenderer'
// 七个概念题渲染器（阶段 5）：都不含编辑器与判分后端，静态 import 不会把 Godbolt 那一套拖进首屏
import { SingleChoiceRenderer } from '../modules/problems/renderers/SingleChoiceRenderer'
import { TrueFalseRenderer } from '../modules/problems/renderers/TrueFalseRenderer'
import { FillBlankRenderer } from '../modules/problems/renderers/FillBlankRenderer'
import { CodeOrderingRenderer } from '../modules/problems/renderers/CodeOrderingRenderer'
import { ComplexityRenderer } from '../modules/problems/renderers/ComplexityRenderer'
import { ShortAnswerRenderer } from '../modules/problems/renderers/ShortAnswerRenderer'
import { MatchingRenderer } from '../modules/problems/renderers/MatchingRenderer'
import { ProgressPanel } from '../modules/problems/progress/ProgressPanel'
import { difficultyStars, typeLabel } from '../modules/problems/type-meta'
import { loadVizIndex, type VizIndexEntry } from '../modules/viz/data/loader'

/**
 * 题目详情页（阶段 4 模块 1 最简版）。
 *
 * 路由用 problems/p/:id 而不是 problems/:id —— 阶段 3 已经有 problems/:section
 * （SectionPage 占位），两者同层会产生歧义匹配。
 *
 * 数据流：index.json（唯一索引入口）→ 定位分片 file → 取分片 → 取单题 → 按 type 分派 Renderer。
 *
 * 阶段 5 起十一个题型全部有渲染器：四类主力（编程 / 阅读 / 程序填空 / 改错）走 Godbolt 实机判分，
 * 七类辅助（选择 / 判断 / 填空 / 排序 / 复杂度 / 简答 / 匹配）一律前端即时判定，一个请求都不发。
 * 每个题型下面都挂同一张 ProgressPanel（收藏 / 笔记 / 错题本 / 回看上次提交），
 * 它是题型无关的，放在详情页而不是各渲染器里，十一处就不会漂移。
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'notfound'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LoadedProblem }

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
            {typeLabel(problem.type)}
          </span>
          <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border)' }}>
            难度 {difficultyStars(problem.difficulty)}
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

      <TypeRenderer problem={problem} />

      <RelatedVizLinks vizIds={problem.vizIds} />

      <ProgressPanel problemId={problem.id} />
    </>
  )
}

/**
 * 相关可视化（阶段 7-9 双向关联）：读题目的 vizIds（backfill:viz 回填），
 * 经 viz/index.json 解析成标题后链到 /viz/:demoId。索引加载失败静默跳过 ——
 * 关联演示是锦上添花，不能因为它挡住作答主流程。无 vizIds 的题不渲染任何节点。
 */
function RelatedVizLinks({ vizIds }: { vizIds: unknown }) {
  const ids = Array.isArray(vizIds) ? vizIds.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  const key = ids.join(',')
  const [entries, setEntries] = useState<VizIndexEntry[] | null>(null)

  useEffect(() => {
    if (key === '') return
    let alive = true
    loadVizIndex()
      .then((index) => {
        if (!alive) return
        const wanted = new Set(key.split(','))
        setEntries(index.demos.filter((d) => wanted.has(d.id)))
      })
      .catch(() => {
        /* 静默：索引拉不到就不展示关联演示，不弹错误 */
      })
    return () => {
      alive = false
    }
  }, [key])

  if (key === '' || entries === null || entries.length === 0) return null
  return (
    <section className="rounded-xl border p-4" style={panel} data-role="related-viz">
      <p className="text-sm font-semibold">🎬 相关可视化演示</p>
      <p className="mt-1 text-xs" style={muted}>不确定程序怎么执行？先单步看演示，再回来作答。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {entries.map((d) => (
          <Link
            key={d.id}
            to={'/viz/' + d.id}
            data-role="related-viz-link"
            className="rounded-lg border px-3 py-1.5 text-sm hover:underline"
            style={{ borderColor: 'var(--border)' }}
          >
            🎬 {d.title}
          </Link>
        ))}
      </div>
    </section>
  )
}

/**
 * type → 渲染器。七个概念题渲染器形状完全一致（{ problem }），故用一张表分派；
 * 四类主力渲染器各自有 lazy / Suspense 等差异，仍走 if 明写，不为了整齐而强行同构。
 */
const CONCEPT_RENDERERS: Record<string, ComponentType<{ problem: ProblemRecord }>> = {
  single_choice: SingleChoiceRenderer,
  true_false: TrueFalseRenderer,
  fill_blank: FillBlankRenderer,
  code_ordering: CodeOrderingRenderer,
  complexity: ComplexityRenderer,
  short_answer: ShortAnswerRenderer,
  matching: MatchingRenderer,
}

function TypeRenderer({ problem }: { problem: ProblemRecord }) {
  if (problem.type === 'programming') return <ProgrammingRenderer problem={problem} />
  if (problem.type === 'code_reading') return <CodeReadingRenderer problem={problem} />
  if (problem.type === 'debug') return <DebugRenderer problem={problem} />
  if (problem.type === 'code_completion') {
    return (
      <Suspense fallback={<p className="text-sm" style={muted}>正在加载程序填空编辑器…</p>}>
        <CodeCompletionRenderer problem={problem} />
      </Suspense>
    )
  }
  const Concept = CONCEPT_RENDERERS[problem.type]
  if (Concept !== undefined) return <Concept problem={problem} />
  // 表外类型（历史数据 / 将来新增题型）：如实说明还没实现，不静默渲染成「已支持」
  return (
    <>
      <section className="rounded-xl border p-4" style={panel}>
        <p className="text-sm whitespace-pre-wrap">{problem.stem}</p>
      </section>
      <PhasePlaceholder
        phase={`未实现的题型：${problem.type}`}
        todo={[
          '本站已支持十一个题型（四类主力走 Godbolt 实机判分，七类辅助前端即时判定），这一型不在其中',
          '这不是数据损坏：index.json 与分片一致，只是前端还没有这一型的作答界面',
          '可以先回列表页（✍️ 在线刷题）按题型筛选，做其余题目',
        ]}
      />
    </>
  )
}
