/**
 * 3D 内存沙盘（scene: memory3d，快照 kind: memory）—— 本站差异化重点。
 *
 * 2D 内存格渲染器把分区画成上下堆叠的表格，学生看到的是「一堆格子」；
 * 3D 沙盘给的是**空间关系**：栈区、堆区、全局区并排落在同一块地板上，
 * 每块区域有自己的底板与标题，指针则是真实跨越空间的弧线 + 箭头。
 * 于是三件在 2D 里只能靠嘴说的事变成看得见的：
 *   ① free 之后连线仍在（悬空），把 p 置 NULL 之后连线消失；
 *   ② 泄漏的堆块孤零零立在堆区里，没有任何一条线连进来（不可达 = 没有入口）；
 *   ③ 多个指针指向同一块内存时，几条弧线收束到同一个盒子上（别名效应）。
 *
 * 分区一律**中性色**，不借用 role 语义色：盒子颜色已经承载「危险/已就位」，
 * 底板再来一套颜色会让红色失去唯一含义（07 规范二·E：一个语义一种颜色）。
 *
 * 排列规则刻意简单：区域内 ≤4 格排一行，>4 格折成 4 列的网格；区域之间沿 X 并排。
 * 「栈向下生长」这个方向性由 3D 函数调用栈场景（callstack3d）专门表达，
 * 沙盘场景的职责是把「谁在哪一区、谁指向谁」讲清楚，两件事不混在一个场景里。
 *
 * mesh 预算：每格 5 个对象（盒 + 描边 + 值 + 名 + 地址/note）+ 每区 2 个 + 每条指针 2 个。
 * 现存语料最多 9 格 / 3 区 / 3 条指针 = 45 + 6 + 6 ≈ 57，远低于 200 红线。
 */
import { useMemo } from 'react'
import type { MemoryCell, MemoryRegion, MemorySnapshot } from '../../viz/types'
import type { CameraHint, Scene3DProps } from '../types'
import { ROLE_HEX, sceneTheme } from '../palette'
import { Mover, TextLabel, type Vec3 } from '../widgets'
import { CELL, CellBox, PointerArc, ZonePlate, normalizeKey, parseAddr, pointerTargetOf } from '../parts'

const GAP_X = 0.32
const GAP_Z = 0.42
const ZONE_GAP = 2.8
const TITLE_Y = 3.05
const CELL_Y = CELL.h / 2 + 0.1

interface Placed {
  cell: MemoryCell
  pos: Vec3
}

export interface Zone {
  region: MemoryRegion
  center: Vec3
  width: number
  depth: number
  cells: Placed[]
}

export interface MemoryLayout {
  zones: Zone[]
  span: number
  maxCells: number
}

/** 区域内排布：≤4 格一行，>4 格折成 4 列网格。返回局部坐标（区域中心为原点） */
function regionLayout(cells: MemoryCell[]): { local: Vec3[]; width: number; depth: number } {
  const n = cells.length
  if (n === 0) return { local: [], width: CELL.w + 1.4, depth: CELL.d + 1.4 }
  if (n <= 4) {
    return {
      local: cells.map((_, k) => [(k - (n - 1) / 2) * (CELL.w + GAP_X), CELL_Y, 0] as Vec3),
      width: n * (CELL.w + GAP_X) + 0.6,
      depth: CELL.d + 1.4,
    }
  }
  const cols = 4
  const rows = Math.ceil(n / cols)
  return {
    local: cells.map((_, k) => {
      const c = k % cols
      const r = Math.floor(k / cols)
      return [(c - (cols - 1) / 2) * (CELL.w + GAP_X), CELL_Y, (r - (rows - 1) / 2) * (CELL.d + GAP_Z)] as Vec3
    }),
    width: cols * (CELL.w + GAP_X) + 0.6,
    depth: rows * (CELL.d + GAP_Z) + 0.6,
  }
}

/** 纯函数布局：场景与相机取景共用同一份坐标，绝不让两处各算一遍 */
export function layoutMemory(regions: MemoryRegion[]): MemoryLayout {
  const shaped = regions.map((region) => ({ region, ...regionLayout(region.cells) }))
  const total = shaped.reduce((s, r) => s + r.width, 0) + ZONE_GAP * Math.max(0, shaped.length - 1)
  let cursor = -total / 2
  const zones: Zone[] = shaped.map((r) => {
    const center: Vec3 = [cursor + r.width / 2, 0, 0]
    cursor += r.width + ZONE_GAP
    return {
      region: r.region,
      center,
      width: r.width,
      depth: r.depth,
      cells: r.region.cells.map((cell, k) => {
        const l: Vec3 = r.local[k] ?? [0, 0, 0]
        return { cell, pos: [center[0] + l[0], l[1], l[2]] as Vec3 }
      }),
    }
  })
  return {
    zones,
    span: total,
    maxCells: regions.reduce((m, r) => Math.max(m, r.cells.length), 0),
  }
}

/** 指针目标解析：地址优先，其次 key，都按归一化比对（a[0] 与 a0 视为同一个） */
function buildResolver(cells: Placed[]): (target: string) => Vec3 | null {
  const byAddr = new Map<string, Vec3>()
  const byKey = new Map<string, Vec3>()
  for (const p of cells) {
    const a = parseAddr(p.cell.address)
    if (!Number.isNaN(a)) byAddr.set(normalizeKey(p.cell.address), p.pos)
    byKey.set(normalizeKey(p.cell.key), p.pos)
  }
  return (target: string) => {
    const k = normalizeKey(target)
    return byAddr.get(k) ?? byKey.get(k) ?? byAddr.get(normalizeKey(`0x${target}`)) ?? null
  }
}

export function Memory3D({ step, dark }: Scene3DProps) {
  const snap = step.snapshot as MemorySnapshot
  const regions = snap.regions ?? []
  const theme = sceneTheme(dark)
  const layout = useMemo(() => layoutMemory(regions), [regions])

  const allCells = useMemo(() => layout.zones.flatMap((z) => z.cells), [layout])
  const resolve = useMemo(() => buildResolver(allCells), [allCells])

  const links = useMemo(() => {
    const out: { from: Vec3; to: Vec3 | null; target: string; danger: boolean }[] = []
    for (const p of allCells) {
      const target = pointerTargetOf(p.cell.value)
      if (!target) continue
      const from: Vec3 = [p.pos[0], p.pos[1] + CELL.h / 2 + 0.05, p.pos[2]]
      const hit = resolve(target)
      out.push({
        from,
        to: hit ? [hit[0], hit[1] + CELL.h / 2 + 0.05, hit[2]] : null,
        target,
        danger: p.cell.role === 'swap',
      })
    }
    return out
  }, [allCells, resolve])

  return (
    <group>
      {layout.zones.map((z) => (
        <group key={z.region.key}>
          <ZonePlate
            width={z.width}
            depth={z.depth}
            theme={theme}
            title={z.region.title}
            titleY={TITLE_Y}
            position={z.center}
          />
          {z.region.cells.length === 0 ? (
            <TextLabel
              text={z.region.note ? `（空）${z.region.note}` : '（空）'}
              position={[z.center[0], 0.75, 0]}
              color={theme.frameBox}
              height={0.3}
            />
          ) : null}
          {z.cells.map((p) => (
            <Mover key={`${z.region.key}:${p.cell.key}`} position={p.pos}>
              <CellBox
                cell={p.cell}
                theme={theme}
                dark={dark}
                name={p.cell.key}
                emphasis={p.cell.role === 'active' || p.cell.role === 'compare'}
              />
            </Mover>
          ))}
        </group>
      ))}

      {links.map((l, i) =>
        l.to ? (
          <PointerArc
            key={`lk${i}`}
            from={l.from}
            to={l.to}
            color={l.danger ? ROLE_HEX.swap : theme.link}
            lift={0.95}
          />
        ) : (
          // 目标不在当前快照里（例如已被 free 且从堆区移除）：诚实画出「断头」而不是悄悄省略
          <PointerArc
            key={`lk${i}`}
            from={l.from}
            to={[l.from[0] + 1.5, l.from[1] + 0.7, l.from[2]]}
            color={theme.frameBox}
            label={`${l.target} 不在场内`}
            lift={0.4}
            opacity={0.6}
            lineWidth={1.4}
          />
        ),
      )}
    </group>
  )
}

/** 相机随沙盘总宽拉远；窄沙盘（1–2 区）贴近看格子，宽沙盘退到能看全连线 */
export function memory3DCamera(regions: MemoryRegion[]): CameraHint {
  const { span } = layoutMemory(regions)
  const z = Math.min(58, Math.max(11, span * 1.05 + 7))
  return { position: [0, z * 0.52, z], target: [0, 1.1, 0] }
}
