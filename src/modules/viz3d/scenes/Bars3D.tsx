/**
 * 3D 排序柱阵（scene: bars3d，快照 kind: bar）。
 *
 * 2D 柱状图只能看「高矮」，3D 多给的是**纵深**：
 * 把当前正在比较的两根柱子抬离地面并朝观察者方向推出，
 * 学生在旋转视角时能一眼锁定「这一趟动的是哪两根」，
 * 而不必在一排等高色块里数下标。已就位的柱子沉回地面并转绿。
 *
 * mesh 预算：n 根柱 + n 个数值标签 + n 个下标标签 + 底座 + 指针标签 ≤ 3n + 8，
 * n ≤ 50 时最多 158 个，满足「单演示不超过 200 mesh」的硬约束。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { BarSnapshot } from '../../viz/types'
import type { Scene3DProps } from '../types'
import { roleHex, sceneTheme } from '../palette'
import { Mover, TextLabel, type Vec3 } from '../widgets'

const GAP = 1.18
const MIN_H = 0.5
const MAX_H = 6.0

export function Bars3D({ step, dark }: Scene3DProps) {
  const snap = step.snapshot as BarSnapshot
  const values = snap.values ?? []
  const roles = snap.roles ?? []
  const theme = sceneTheme(dark)
  const n = values.length

  const { min, max } = useMemo(() => {
    const lo = Math.min(...values, 0)
    const hi = Math.max(...values, 1)
    return { min: lo, max: hi > lo ? hi : lo + 1 }
  }, [values])

  const half = (n - 1) / 2
  const baseW = n * GAP + 1.2

  // 同一根柱子上可能挂多个指针（i 与 j 重合时），错开高度避免文字叠死
  const pointerRows = new Map<number, number>()
  const pointers = (snap.pointers ?? []).map((p) => {
    const row = pointerRows.get(p.index) ?? 0
    pointerRows.set(p.index, row + 1)
    return { ...p, row }
  })

  return (
    <group>
      {/* 底座：表示「这是一整块连续数组」，柱子站在它上面 */}
      <mesh position={[0, -0.14, 0]}>
        <boxGeometry args={[baseW, 0.16, 1.5]} />
        <meshLambertMaterial color={theme.grid} />
      </mesh>

      {values.map((v, i) => {
        const role = roles[i] ?? 'idle'
        const h = MIN_H + ((v - min) / (max - min)) * (MAX_H - MIN_H)
        const x = (i - half) * GAP
        // 比较中 / 交换中的柱子抬起来并往前推：3D 独有的「聚光」手法
        const lift = role === 'compare' || role === 'swap' ? 0.55 : 0
        const front = role === 'compare' || role === 'swap' ? 0.75 : 0
        const pos: Vec3 = [x, h / 2 + lift, front]
        return (
          <Mover key={`b${i}`} position={pos}>
            <mesh>
              <boxGeometry args={[0.82, h, 0.82]} />
              <meshLambertMaterial color={roleHex(role)} />
            </mesh>
            <TextLabel
              text={String(v)}
              position={[0, h / 2 + 0.34, 0]}
              color={role === 'idle' ? theme.text : roleHex(role)}
              height={0.4}
              bold={role !== 'idle'}
              background={dark ? 'rgba(11,17,32,0.72)' : 'rgba(255,255,255,0.78)'}
            />
            <TextLabel
              text={`[${i}]`}
              position={[0, -h / 2 - 0.34 - lift, -front]}
              color={theme.text}
              height={0.3}
            />
          </Mover>
        )
      })}

      {/* 指针标签（i / j / low / mid / high）：挂在柱子前方地面下，用连线指回柱子 */}
      {pointers.map((p, k) => {
        const x = (p.index - half) * GAP
        const y = -1.0 - p.row * 0.5
        return (
          <group key={`p${k}`}>
            <Mover position={[x, y, 1.5]}>
              <TextLabel
                text={p.label}
                position={[0, 0, 0]}
                color={theme.link}
                height={0.36}
                bold
                background={dark ? 'rgba(11,17,32,0.8)' : 'rgba(255,255,255,0.85)'}
              />
            </Mover>
            <Line points={[[x, y, 1.5], [x, -0.22, 0.75]]} color={theme.link} lineWidth={1.4} transparent opacity={0.75} />
          </group>
        )
      })}
    </group>
  )
}

/** 相机随柱数拉远：n=10 时贴近看细节，n=50 时退到能看全 */
export function bars3DCamera(n: number): { position: Vec3; target: Vec3 } {
  const width = Math.max(6, n * GAP + 3)
  const z = Math.min(64, width * 1.05 + 6)
  return { position: [0, z * 0.42, z], target: [0, 1.6, 0] }
}
