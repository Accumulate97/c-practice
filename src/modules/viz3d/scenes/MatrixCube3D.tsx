/**
 * 3D 数组 / 矩阵内存立方体（scene: matrixcube3d，快照 kind: memory）。
 *
 * 这个场景要讲清的只有一句话：**C 里没有二维数组，只有「按行优先摊平的一维数组」**。
 * 讲法是把两种视角同时摆出来，用竖线连成一台「映射机」：
 *   上层 —— 逻辑视角：a[i][j] 铺在 XZ 平面上（行沿 Z、列沿 X），是一个真实的**面**；
 *   下层 —— 物理视角：9 个格子按地址升序排成一条**线**，就是内存里真实的样子；
 *   竖线 —— 地址映射：a[1][2] 到底落在第几个 int 上，顺着竖线往下看到 [5] 与 0x1014。
 * 当前访问的格子上下同时高亮，`基址 + (i×列数 + j) × sizeof` 这个公式不再需要背。
 *
 * 键名解析 /^([A-Za-z_]\w*?)(\d)(\d)$/ 是纯约定的（语料由 scripts/gen-viz3d.ts 生成，
 * 键固定写成 a00…a22）；解析不出来就退回「一行 n 列」，绝不因为键名不规范而白屏。
 *
 * mesh 预算：上下各 n 格 × 4–5 个对象 + n 条竖线 + 2 块板 + 行列表头。
 * 3×3 = 9 格 → 45 + 40 + 9 + 2 + 6 + 4 ≈ 106，低于 200 红线。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { MemoryCell, MemoryRegion, MemorySnapshot } from '../../viz/types'
import type { CameraHint, Scene3DProps } from '../types'
import { sceneTheme } from '../palette'
import { TextLabel, type Vec3 } from '../widgets'
import { CellBox, clampText, parseAddr } from '../parts'

const S = 2.1          // 逻辑面格距
const SB = 1.95        // 物理线格距
const TOP_Y = 4.3
const BOTTOM_Y = 0.85
const TOP_BOX = { w: 1.72, h: 0.46, d: 1.72 }
const BOT_BOX = { w: 1.62, h: 0.88, d: 1.12 }

interface Mapped {
  cell: MemoryCell
  row: number
  col: number
  top: Vec3
  bottom: Vec3
  linear: number
  active: boolean
}

interface MatrixLayout {
  rows: number
  cols: number
  cells: Mapped[]
  width: number
  depth: number
  title: string
  note?: string
}

const KEY_RE = /^([A-Za-z_]\w*?)(\d)(\d)$/

export function layoutMatrix(regions: MemoryRegion[]): MatrixLayout {
  const region = regions[0]
  const all = regions.flatMap((r) => r.cells)
  const parsed = all.map((cell) => {
    const m = KEY_RE.exec(cell.key)
    return m ? { cell, row: Number(m[2]), col: Number(m[3]) } : null
  })
  const ok = parsed.filter((p): p is { cell: MemoryCell; row: number; col: number } => p !== null)
  // 键名不合约定 → 退化成一行 n 列（仍然是「逻辑序 → 物理序」的对照，只是没有行折叠）
  const useParsed = ok.length === all.length && ok.length > 0
  const shaped = useParsed
    ? ok
    : all.map((cell, k) => ({ cell, row: 0, col: k }))

  const rows = Math.max(...shaped.map((s) => s.row)) + 1
  const cols = Math.max(...shaped.map((s) => s.col)) + 1
  const n = shaped.length

  // 物理顺序 = 地址升序；地址解析不出来就退回语料原序（快照本身就是生成器按地址写的）
  const order = shaped
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => {
      const da = parseAddr(a.cell.address)
      const db = parseAddr(b.cell.address)
      if (Number.isNaN(da) || Number.isNaN(db)) return a.i - b.i
      return da - db
    })
  const linearOf = new Map<number, number>(order.map((s, k) => [s.i, k]))

  const cells: Mapped[] = shaped.map((s, i) => {
    const linear = linearOf.get(i) ?? i
    const active = s.cell.role === 'active' || s.cell.role === 'compare'
    return {
      cell: s.cell,
      row: s.row,
      col: s.col,
      top: [(s.col - (cols - 1) / 2) * S, TOP_Y, (s.row - (rows - 1) / 2) * S] as Vec3,
      bottom: [(linear - (n - 1) / 2) * SB, BOTTOM_Y, 0] as Vec3,
      linear,
      active,
    }
  })

  return {
    rows,
    cols,
    cells,
    width: Math.max(cols * S, n * SB) + 1.6,
    depth: rows * S + 1.8,
    title: region?.title ?? '数组内存',
    note: region?.note,
  }
}

export function MatrixCube3D({ step, dark }: Scene3DProps) {
  const snap = step.snapshot as MemorySnapshot
  const regions = snap.regions ?? []
  const theme = sceneTheme(dark)
  const L = useMemo(() => layoutMatrix(regions), [regions])
  const activeCell = L.cells.find((c) => c.active) ?? null

  return (
    <group>
      {/* 逻辑面：一块浮在上方的平板，格子躺在它上面 */}
      <mesh position={[0, TOP_Y - 0.42, 0]}>
        <boxGeometry args={[L.cols * S, 0.1, L.rows * S]} />
        <meshLambertMaterial color={theme.grid} transparent opacity={0.34} />
      </mesh>
      <TextLabel
        text={clampText(L.title, 30)}
        position={[0, TOP_Y + 1.5, -(L.rows - 1) / 2 * S - 0.5]}
        color={theme.text}
        height={0.42}
        bold
      />
      <TextLabel
        text="逻辑视角：a[i][j] 铺成一个面（行沿纵深 · 列沿横向）"
        position={[0, TOP_Y + 0.95, -(L.rows - 1) / 2 * S - 0.5]}
        color={theme.frameBox}
        height={0.28}
      />

      {/* 物理线：地面上的一条连续地址带 */}
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[L.cells.length * SB + 0.9, 0.12, BOT_BOX.d + 1.3]} />
        <meshLambertMaterial color={theme.grid} transparent opacity={0.4} />
      </mesh>
      <TextLabel
        text="物理视角：内存里只有一条连续地址带（行优先摊平）"
        position={[0, 0.12, BOT_BOX.d / 2 + 1.15]}
        color={theme.frameBox}
        height={0.28}
      />

      {/* 行列表头：把「i 是行、j 是列」钉在场景里，不靠学生猜 */}
      {Array.from({ length: L.rows }, (_, r) => (
        <TextLabel
          key={`r${r}`}
          text={`i=${r}`}
          position={[-((L.cols - 1) / 2) * S - 1.35, TOP_Y, (r - (L.rows - 1) / 2) * S]}
          color={theme.frameBox}
          height={0.3}
          bold
        />
      ))}
      {Array.from({ length: L.cols }, (_, c) => (
        <TextLabel
          key={`c${c}`}
          text={`j=${c}`}
          position={[(c - (L.cols - 1) / 2) * S, TOP_Y, -((L.rows - 1) / 2) * S - 1.35]}
          color={theme.frameBox}
          height={0.3}
          bold
        />
      ))}

      {L.cells.map((m) => (
        <group key={`m${m.cell.key}`}>
          {/* 竖线 = 地址映射本身。当前格用主题色加粗，其余压暗当背景 */}
          <Line
            points={[[m.top[0], m.top[1] - 0.3, m.top[2]], [m.bottom[0], m.bottom[1] + 0.5, m.bottom[2]]]}
            color={m.active ? theme.link : theme.frameBox}
            lineWidth={m.active ? 3 : 1.2}
            transparent
            opacity={m.active ? 0.95 : 0.3}
          />
          <group position={m.top}>
            <CellBox
              cell={m.cell}
              theme={theme}
              dark={dark}
              size={TOP_BOX}
              name={`${m.cell.key.replace(/(\d)(\d)$/, '[$1][$2]')}`}
              showAddress={false}
              showNote={false}
              emphasis={m.active}
            />
          </group>
          <group position={m.bottom}>
            <CellBox
              cell={m.cell}
              theme={theme}
              dark={dark}
              size={BOT_BOX}
              name={`[${m.linear}]`}
              showAddress
              showNote={false}
              emphasis={m.active}
            />
          </group>
        </group>
      ))}

      {/* 当前格的地址公式：语料把公式写在 note 里，3D 只负责把它放到显眼处 */}
      {activeCell && activeCell.cell.note ? (
        <TextLabel
          text={clampText(activeCell.cell.note, 34)}
          position={[0, (TOP_Y + BOTTOM_Y) / 2 + 0.3, L.depth / 2 - 0.4]}
          color={theme.link}
          height={0.36}
          bold
          depthTest={false}
          renderOrder={6}
        />
      ) : null}
    </group>
  )
}

/** 相机要同时装下上方的面与下方的线：俯角比其它内存场景更大 */
export function matrixCube3DCamera(regions: MemoryRegion[]): CameraHint {
  const L = layoutMatrix(regions)
  const z = Math.min(60, Math.max(14, L.width * 1.0 + 9))
  return { position: [0, TOP_Y + z * 0.42, z], target: [0, (TOP_Y + BOTTOM_Y) / 2 - 0.4, 0] }
}
