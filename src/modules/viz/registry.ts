/**
 * 渲染器注册表（阶段 7 · 任务 1）。
 *
 * 5 套通用渲染器覆盖 30+ 演示（07_可视化演示规范.md 一·核心抽象）：
 * 页面只按 demo.renderer 从这里取组件，不认识任何具体算法 —— 新增演示只加语料，
 * 不加组件；新增一类快照才在这里登记一行。
 *
 * 本文件是 .ts（无 JSX）：静态 import 5 个渲染器组件本身，JSX 留在各自的 .tsx 里，
 * 这样 scripts/ 侧（Node 原生类型擦除）也能安全 ssrLoadModule 引用本表做一致性校验。
 */
import type { ComponentType } from 'react'
import { BarRenderer } from './renderers/BarRenderer'
import { GraphRenderer } from './renderers/GraphRenderer'
import { MemoryRenderer } from './renderers/MemoryRenderer'
import { NodeChainRenderer } from './renderers/NodeChainRenderer'
import { TreeRenderer } from './renderers/TreeRenderer'
import type { VizRendererKind, VizRendererProps } from './types'

export interface RendererEntry {
  /** 中文短名：列表页徽标、对比页面板标题用 */
  label: string
  Component: ComponentType<VizRendererProps>
}

export const RENDERERS: Record<VizRendererKind, RendererEntry> = {
  bar: { label: '柱状图', Component: BarRenderer },
  nodechain: { label: '节点链', Component: NodeChainRenderer },
  tree: { label: '树', Component: TreeRenderer },
  graph: { label: '图', Component: GraphRenderer },
  memory: { label: '内存格', Component: MemoryRenderer },
}

/**
 * 取渲染器：未知 kind 一律退回柱状图而不是抛错 ——
 * 语料是构建期生成的，线上出现陌生 kind 只可能是版本不一致，降级展示比白屏诚实。
 */
export function rendererFor(kind: string): RendererEntry {
  return RENDERERS[kind as VizRendererKind] ?? RENDERERS.bar
}

/** 分类 slug → 中文名。列表页按 category 分组展示，未知 slug 原样显示。 */
export const CATEGORY_LABELS: Record<string, string> = {
  sort: '排序',
  linear: '线性表 / 栈与队列',
  tree: '树',
  graph: '图',
  memory: '内存与指针',
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug
}