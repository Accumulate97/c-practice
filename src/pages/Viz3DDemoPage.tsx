/**
 * 3D 演示页：/#/viz3d/{demoId}。
 *
 * 复用而不是另写一套播放逻辑：传输控制（播放/单步/后退/进度条/键盘）全部交给 2D 馆的
 * Player，本页只提供 renderStep —— 于是「3D 与 2D 步数一致、解说一致、快捷键一致」
 * 是结构上保证的，不是靠人工对齐（AGENTS.md 任务 2「复用现有 Step 状态快照模型」）。
 *
 * 三条降级路径，全部**诚实告知**而不是悄悄换图：
 *   · WebGL 不可用 → 自动切 2D 渲染器，横幅写明原因；
 *   · 窄屏（≤900px）→ 自动切 2D（触屏上 OrbitControls 与页面滚动抢手势，3D 反而更难用）；
 *   · 任何时候都可以手动在 2D / 3D 之间切换，手动选择优先于自动判定。
 * 2D 渲染器与 3D 场景读的是同一份语料，所以切换视图不会丢步骤、不会改结论。
 *
 * 体积红线：本页**不静态 import three**。3D 舞台 Stage3DScene 走 React.lazy，
 * 只有 use3D 为真、真要画立体图时才下载那 885 KB（gzip 235 KB）；
 * 窄屏与无 WebGL 的用户走 2D 分支，一个字节 3D 代码都不下载。
 *
 * 换演示不拆舞台：语料到手之前保留上一个演示，只用 busy 角标说明「正在载入」。
 * 原因见下面 useEffect 里的注释 —— 连拆带建 Canvas 会撞上 drei OrbitControls 的竞态。
 */
import { Suspense, lazy, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Player } from '../modules/viz/Player'
import { rendererFor } from '../modules/viz/registry'
import { COUNTER_LABELS, type VizDemo } from '../modules/viz/types'
import { RelatedForViz } from '../modules/knowledge/links'
import { VIZ3D_BY_ID, type Viz3DCatalogEntry } from '../modules/viz3d/catalog'
import { Viz3DNotFound, loadDemo3D } from '../modules/viz3d/loader3d'
import { LEGEND, roleHex } from '../modules/viz3d/palette'
import { counterLabel, sceneLabel } from '../modules/viz3d/types'
import { NARROW_QUERY, lowEndReason, useIsDark, useMedia, webglSupported } from '../modules/viz3d/useStageEnv'
import { LoadingBar } from '../components/common/LoadingBar'
import { CodePanel3D } from '../modules/viz3d/CodePanel3D'

/** 3D 运行时（three + fiber + drei + 七个场景）全部藏在这个动态 import 后面 */
const Stage3DScene = lazy(() => import('../modules/viz3d/Stage3DScene'))

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const chip: CSSProperties = { borderColor: 'var(--border)', color: 'var(--fg-muted)' }
const btn: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }

/** ready 里连 entry 一起存：台上画的必须是「同一份目录项 + 同一份语料」，不能一半新一半旧 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'missing'; id: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; entry: Viz3DCatalogEntry; demo: VizDemo }

/** 视图偏好：auto = 由 WebGL 与屏宽决定，flat/solid = 用户手动锁定 */
type ViewPref = 'auto' | 'flat' | 'solid'

export function Viz3DDemoPage() {
  const { demoId = '' } = useParams<{ demoId?: string }>()
  const entry = VIZ3D_BY_ID.get(demoId)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [glOk, setGlOk] = useState<boolean | null>(null)
  const [pref, setPref] = useState<ViewPref>('auto')
  const [viewKey, setViewKey] = useState(0)
  /** 正在换演示：台上还是上一个，角标如实说明「载入中」 */
  const [busy, setBusy] = useState(false)
  const dark = useIsDark()
  const narrow = useMedia(NARROW_QUERY)
  // 低配探测只跑一次：核数 / 内存 / 省流 / reduce-motion 在页面生命周期内不会变，
  // 用 useState 惰性初始化，免得每次渲染都去读一遍 navigator 和 matchMedia。
  const [lowEnd] = useState<string | null>(() => lowEndReason())

  useEffect(() => {
    setGlOk(webglSupported())
  }, [])

  useEffect(() => {
    let alive = true
    // 已有内容在台上时**不清空 phase**。清空会立刻卸载 Canvas，而演示之间的跳转常常在
    // 几百毫秒内「拆一个 R3F root、再建一个」；这个连拆带建会让 drei 的 OrbitControls
    // 在已经销毁的 gl 上执行 connect(null)，抛出
    //   TypeError: Cannot read properties of null (reading 'addEventListener')
    // 并且场景只剩一个 mesh（2026-09-13 在 tree-bst-insert 上实测复现）。
    // 保持舞台不动、语料到手后整体换血，既躲开竞态，也没有白屏闪一下的观感。
    setPhase((p) => (p.kind === 'ready' ? p : { kind: 'loading' }))
    setBusy(true)
    const run = async (): Promise<VizDemo> => {
      if (!entry) throw new Viz3DNotFound(demoId)
      return loadDemo3D(demoId, entry.source)
    }
    run().then(
      (demo) => {
        if (!alive) return
        if (entry) setPhase({ kind: 'ready', entry, demo })
        setBusy(false)
      },
      (error: unknown) => {
        if (!alive) return
        setBusy(false)
        if (error instanceof Viz3DNotFound) setPhase({ kind: 'missing', id: demoId })
        else setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [demoId, entry, reloadKey])

  if (!entry) {
    return (
      <section className="rounded-xl border p-6" style={{ ...panel, borderColor: 'var(--color-viz-swap)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--fg-bad)' }}>3D 馆里没有这个演示</p>
        <p className="mt-1 text-sm" style={muted}>
          目录里查不到 {demoId}，可能链接打错了，或该演示还没登记进 catalog。
        </p>
        <Link to="/viz3d" className="mt-3 inline-block text-sm underline">
          ← 返回 3D 可视化馆
        </Link>
      </section>
    )
  }

  if (phase.kind === 'loading') {
    return (
      <p className="text-sm" style={muted} data-role="viz3d-loading">
        正在加载 3D 演示语料…
      </p>
    )
  }

  if (phase.kind === 'missing') {
    return (
      <section className="rounded-xl border p-6" style={{ ...panel, borderColor: 'var(--color-viz-swap)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--fg-bad)' }}>找不到这个演示</p>
        <p className="mt-1 text-sm" style={muted}>
          3D 目录里有 {phase.id}，但语料文件没取到。请确认已跑过 <code>npm run gen:viz3d</code> 与{' '}
          <code>npm run build:index</code>。
        </p>
        <Link to="/viz3d" className="mt-3 inline-block text-sm underline">
          ← 返回 3D 可视化馆
        </Link>
      </section>
    )
  }

  if (phase.kind === 'error') {
    return (
      <section className="rounded-xl border p-6" style={panel}>
        <p className="text-sm font-semibold">演示语料加载失败</p>
        <p className="mt-1 text-sm" style={muted}>
          {phase.message}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={btn}
          >
            重试
          </button>
          <Link to="/viz3d" className="rounded-md border px-3 py-1.5 text-sm" style={chip}>
            ← 返回列表
          </Link>
        </div>
      </section>
    )
  }

  const active = phase.entry
  const demo = phase.demo
  const Renderer2D = rendererFor(demo.renderer).Component
  // 低配只在 **auto** 时参与降级。pref==='solid' 是用户点了「仍要看 3D」的明确意愿，
  // 探测是启发式（核数/内存/省流），拿它去否决一次明确点击，那个按钮就成了死的。
  const use3D =
    pref === 'solid' ? glOk === true : pref === 'flat' ? false : glOk === true && !narrow && lowEnd === null
  const autoFlat = pref === 'auto' && !use3D
  const flatReason =
    glOk === false
      ? '当前浏览器不可用 WebGL'
      : lowEnd !== null
        ? `设备判定为低配（${lowEnd}），3D 可能明显掉帧`
        : '屏幕较窄，触屏手势与 3D 旋转冲突'

  return (
    <Player
      // key 绑定演示 id：换演示时必须让 Player 整个重建。
      // Player 自己维护播放序号，如果不重建，从 14 步的演示跳到 12 步的演示时序号会停在 13，
      // 越界取不到 step → renderStep 拿到 undefined → 舞台整块空白（2026-09-13 验收抓到）。
      // 顺带的好处是这次重建与语料换血发生在**同一次 commit**里，不会出现
      // 「先拆掉 Canvas、几百毫秒后再建一个」的空窗，drei OrbitControls 的 connect 竞态也就无从发生。
      key={demo.id}
      steps={demo.steps}
      header={
        <>
          <header className="space-y-2">
            <Link to="/viz3d" className="text-sm underline" style={muted}>
              ← 返回 3D 可视化馆
            </Link>
            <h1 className="text-2xl font-semibold" data-role="viz3d-title" data-demo-id={active.id}>
              🧊 {active.title ?? demo.title}
            </h1>
            <p className="text-sm" style={muted}>
              {active.blurb}
            </p>
            <p className="flex flex-wrap items-center gap-1 text-xs" style={muted}>
              <span className="rounded border px-1.5 py-0.5" style={chip}>
                {sceneLabel(active.scene)}
              </span>
              <span className="rounded border px-1.5 py-0.5" style={chip}>
                {demo.chapter}
              </span>
              <span className="rounded border px-1.5 py-0.5" style={chip}>
                {demo.steps.length} 步
              </span>
              <span className="rounded border px-1.5 py-0.5" style={chip}>
                语料：{active.source === 'viz3d' ? '3D 专属' : '与 2D 馆共用'}
              </span>
              {busy ? (
                <span
                  className="rounded border px-1.5 py-0.5"
                  style={{ ...chip, borderColor: 'var(--color-viz-compare)' }}
                  data-role="viz3d-busy"
                  role="status"
                >
                  ⏳ 正在载入 {demoId} …（台上仍是上一个演示）
                </span>
              ) : null}
              <button
                type="button"
                data-role="viz3d-view-toggle"
                onClick={() => setPref(use3D ? 'flat' : 'solid')}
                className="rounded border px-2 py-0.5"
                style={btn}
              >
                {use3D ? '切到 2D 平面视图' : '切到 3D 立体视图'}
              </button>
              {use3D ? (
                <button
                  type="button"
                  data-role="viz3d-reset-view"
                  onClick={() => setViewKey((k) => k + 1)}
                  className="rounded border px-2 py-0.5"
                  style={btn}
                >
                  ⟳ 重置视角
                </button>
              ) : null}
              {active.source === 'viz' ? (
                <Link to={`/viz/${active.id}`} className="rounded border px-1.5 py-0.5 no-underline" style={chip}>
                  在 2D 馆打开 ↗
                </Link>
              ) : null}
            </p>
            {autoFlat ? (
              <p
                className="rounded-md border px-3 py-2 text-xs"
                style={{ ...panel, borderColor: 'var(--color-viz-compare)' }}
                data-role="viz3d-fallback"
              >
                ⚠️ {flatReason}，已自动切到 2D 视图（步骤与解说完全一致）。
                <button type="button" onClick={() => setPref('solid')} className="ml-2 underline" style={btn}>
                  仍要看 3D
                </button>
              </p>
            ) : null}
            {pref === 'solid' && narrow && use3D ? (
              /* 任务 4-2：窄屏上是用户自己强开了 3D，那就把「横屏更好用」讲清楚，
                 同时留一条回 2D 的路 —— 强开不等于不能反悔。 */
              <p
                className="rounded-md border px-3 py-2 text-xs"
                style={{ ...panel, borderColor: 'var(--border)' }}
                data-role="viz3d-landscape-hint"
              >
                📱 竖屏下拖拽旋转会和页面滚动抢手势，横屏体验更好。
                <button type="button" onClick={() => setPref('flat')} className="ml-2 underline" style={btn}>
                  切回 2D 视图
                </button>
              </p>
            ) : null}
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={muted} aria-label="语义色图例">
              {LEGEND.map((l) => (
                <li key={l.role} className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: roleHex(l.role) }}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          </header>
          <RelatedForViz
            demoId={active.id}
            relatedProblems={Array.isArray(demo.relatedProblems) ? demo.relatedProblems : []}
          />
        </>
      }
      renderStep={(step, index) => {
        const counters = step.snapshot.counters ?? {}
        const keys = Object.keys(counters)
        return (
          <div className={demo.code ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}>
            <section className="rounded-xl border p-2" style={panel} data-role="viz3d-stage">
              <div
                className="h-[clamp(20rem,58vh,38rem)] overflow-hidden rounded-lg"
                data-role={use3D ? 'viz3d-canvas' : 'viz3d-flat'}
              >
                {use3D ? (
                  <Suspense
                    fallback={
                      <LoadingBar
                        role="viz3d-loading"
                        label="正在载入 3D 运行时（three.js，约 885 KB，之后走浏览器缓存）…"
                        slowHint="网络较慢？可先点上方「切到 2D 平面视图」，步骤与解说完全一致。"
                      />
                    }
                  >
                    <Stage3DScene
                      scene={active.scene}
                      demo={demo}
                      stepIndex={index}
                      dark={dark}
                      viewKey={viewKey}
                    />
                  </Suspense>
                ) : (
                  <div className="h-full overflow-auto p-3" style={{ background: 'var(--bg)' }}>
                    <Renderer2D demo={demo} step={step} />
                  </div>
                )}
              </div>
              {keys.length > 0 ? (
                <ul
                  className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 font-mono text-xs"
                  style={muted}
                  data-role="viz3d-counters"
                  aria-label="本步统计"
                >
                  {keys.map((k) => (
                    <li key={k}>
                      {counterLabel(k, COUNTER_LABELS)}：<span style={{ color: 'var(--fg)' }}>{counters[k]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="px-1 pt-1 text-[11px]" style={muted}>
                {use3D
                  ? '鼠标左键拖拽旋转 · 滚轮缩放 · 右键平移；键盘空格播放、← → 单步'
                  : '2D 视图；键盘空格播放、← → 单步'}
              </p>
            </section>
            {demo.code ? <CodePanel3D code={demo.code} line={step.codeLine} /> : null}
          </div>
        )
      }}
    />
  )
}
