/**
 * 3D 可视化馆列表页：/#/viz3d。
 *
 * 本文件有一条不能破的纪律：**只 import catalog / loader3d / types 这三个 three-free 模块**。
 * 3D 库（three + fiber + drei，未压缩 ~1.2 MB）只允许由演示页那条 lazy 路由引入，
 * 列表页与首页零 3D 体积（AGENTS.md 任务 2「3D 库必须 lazy，首页零体积负担」）。
 * 因此这里能拿到的是「有哪些演示、各属于哪个组、用哪种 3D 画法」，拿不到也不该拿场景组件。
 *
 * 步数 / 标题 / 关联题数来自索引（loadMetaMap 合并 viz 与 viz3d 两个索引）。
 * 索引失败不挡列表：卡片照渲染，只是不显示步数徽标 —— 列表页的主职责是「能点进去」。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { VIZ3D_COUNT, groupedCatalog } from '../modules/viz3d/catalog'
import { saveDataEnabled } from '../components/common/useMobileEditor'
import { lowEndReason, useNarrow } from '../modules/viz3d/useStageEnv'
import { loadMetaMap, type Viz3DMeta } from '../modules/viz3d/loader3d'
import { sceneLabel } from '../modules/viz3d/types'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const chip: CSSProperties = { borderColor: 'var(--border)', color: 'var(--fg-muted)' }

/**
 * 意图预取：指针进入 / 键盘聚焦卡片时才开始拉 three chunk。
 *
 * 这里刻意**不用** requestIdleCallback 空闲预取：那会给每个只是路过列表页的人下 ~885 KB，
 * 直接撞掉 acceptance:viz3d 的「3D 列表页不下载 three chunk」不变量，也违背路由级 lazy 的初衷。
 * hover / focus 抢跑通常能省下 200–500 ms 的白屏等待，代价几乎为零；
 * 同时监听 focus，是为了让只用键盘的学生享有同样的抢跑效果（不能只对鼠标用户友好）。
 * 失败要把 prefetched 翻回 false，否则一次网络抖动就永久放弃预热。
 */
let prefetched = false
function prefetchStage3D(): void {
  if (prefetched) return
  prefetched = true
  void import('../modules/viz3d/Stage3DScene').catch(() => {
    prefetched = false
  })
}

export function Viz3DListPage() {
  const [meta, setMeta] = useState<Map<string, Viz3DMeta> | null>(null)
  const groups = groupedCatalog()
  const narrow = useNarrow()
  /** 低配 / 省流模式下不预热：抢跑那点体验提升，不值得让弱机先付 885 KB 的下载与解析 */
  const [worthWarming] = useState<boolean>(() => lowEndReason() === null && saveDataEnabled() === false)
  const warm = worthWarming && !narrow

  useEffect(() => {
    let alive = true
    loadMetaMap().then(
      (m) => {
        if (alive) setMeta(m)
      },
      () => {
        /* 索引失败静默降级：不显示步数徽标，列表本身照常可用 */
      },
    )
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-5" data-role="viz3d-list">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">🧊 3D 可视化馆</h1>
        <p className="text-sm" style={muted}>
          同一套步骤快照，换一个维度看：可旋转 / 缩放 / 播放 / 单步 / 重置，共 {VIZ3D_COUNT} 个演示。
          3D 场景按需加载（路由级 lazy），列表页与首页不为 three.js 付任何体积。
        </p>
        <p className="text-xs" style={muted}>
          需要浏览器支持 WebGL；不支持或窄屏时自动降级为 2D 视图，并可手动切回。
        </p>
      </header>

      {groups.map(({ group, items }) => (
        <section key={group.key} className="space-y-2" data-role="viz3d-group" data-group={group.key}>
          <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-semibold">
            <span>
              {group.emoji} {group.label}
            </span>
            <span className="text-xs font-normal" style={muted}>
              {group.note} · {items.length} 个
            </span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((entry) => {
              const m = meta?.get(entry.id)
              const title = entry.title ?? (m?.title ? `3D · ${m.title}` : entry.id)
              return (
                <li key={entry.id}>
                  <Link
                    to={`/viz3d/${entry.id}`}
                    data-role="viz3d-card"
                    onPointerEnter={warm ? prefetchStage3D : undefined}
                    onFocus={warm ? prefetchStage3D : undefined}
                    data-id={entry.id}
                    data-scene={entry.scene}
                    className="block h-full rounded-xl border p-3 no-underline transition-colors hover:border-[var(--color-brand)]"
                    style={{ ...panel, color: 'var(--fg)' }}
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{title}</span>
                      {entry.highlight ? (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[11px]"
                          style={{ borderColor: 'var(--color-viz-active)', color: 'var(--color-viz-active)' }}
                        >
                          ⭐ 本站差异化
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed" style={muted}>
                      {entry.blurb}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1 text-[11px]" style={muted}>
                      <span className="rounded border px-1.5 py-0.5" style={chip}>
                        {sceneLabel(entry.scene)}
                      </span>
                      {m ? (
                        <span className="rounded border px-1.5 py-0.5" style={chip}>
                          {m.steps} 步
                        </span>
                      ) : null}
                      {entry.source === 'viz' ? (
                        <span className="rounded border px-1.5 py-0.5" style={chip}>
                          复用 2D 语料
                        </span>
                      ) : (
                        <span className="rounded border px-1.5 py-0.5" style={chip}>
                          3D 专属语料
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <p className="text-sm" style={muted}>
        想看平面版？<Link to="/viz" className="underline">← 返回 2D 可视化演示</Link>
      </p>
    </div>
  )
}
