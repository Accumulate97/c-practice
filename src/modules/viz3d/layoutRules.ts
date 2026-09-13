/**
 * 3D 场景的纯布局规则（不含 three / JSX，脚本与注册表都能安全 import）。
 *
 * 存在的唯一理由是**消除重复判定**：链表的「竖排还是横排」既要被 Chain3D 用来画，
 * 又要被 sceneRegistry 用来算相机取景。两处各写一遍 `demo.id.includes('stack')`
 * 迟早会漂移（改了画法忘了改取景 = 相机对着空处），所以收口在这里。
 */
import type { MemoryRegion, TreeNodeViz } from '../viz/types'

/**
 * 链表类演示是否竖排：栈是「沿一个方向生长」的结构，竖排才看得出后进先出；
 * 队列/链表横排（进出端在左右两侧）。判定只认 id 里的 stack —— 与 Chain3D 同一口径。
 */
export function isVerticalChain(demoId: string): boolean {
  return demoId.includes('stack')
}

/**
 * 树的规模：与 Tree3D.layoutTree 完全同一套计数（空孩子也占一个中序槽位），
 * 只为了给相机取景，不产出坐标。
 */
export function treeStats(root: TreeNodeViz | null): { slots: number; depth: number } {
  let slots = 0
  let depth = 0
  const walk = (n: TreeNodeViz | null, d: number): void => {
    if (!n) {
      slots += 1
      return
    }
    const kids = n.children ?? []
    walk(kids[0] ?? null, d + 1)
    slots += 1
    if (d > depth) depth = d
    for (let i = 1; i < kids.length; i += 1) walk(kids[i] ?? null, d + 1)
  }
  walk(root, 0)
  return { slots, depth }
}

/** 快照里的单元格总数：内存类场景的相机取景与 mesh 预算自检都靠它 */
export function cellCount(regions: MemoryRegion[]): number {
  return regions.reduce((sum, r) => sum + r.cells.length, 0)
}
