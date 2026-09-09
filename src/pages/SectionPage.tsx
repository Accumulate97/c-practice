import { useLocation, useParams } from 'react-router-dom'
import { PhasePlaceholder } from '../components/common/PhasePlaceholder'

const MAP: Record<string, { name: string; phase: string; todo: string[] }> = {
  problems: {
    name: '✍️ 在线刷题',
    phase: '阶段 4',
    todo: [
      'CodeMirror 6 编辑器 + 程序填空的行内空位槽',
      '四个主力题型：程序填空 / 程序改错 / 程序阅读写结果 / 编程题',
      '判分器（stdout 归一化比对）与逐用例结果反馈',
      '阶段 5：七个辅助题型、错题本、收藏、进度导出导入',
    ],
  },
  knowledge: {
    name: '📖 知识点汇总',
    phase: '阶段 6',
    todo: [
      '按"节"粒度的知识卡片（目标 350–420 张），先做指针 / 链表 / 栈队列 / 树与二叉树 / 排序',
      '语法速查：32 关键字、运算符优先级全表、格式说明符、库函数索引',
      '示例代码一键运行 + 已读标记 + MiniSearch 全局搜索',
    ],
  },
  viz: {
    name: '🎬 可视化演示',
    phase: '阶段 7–9',
    todo: [
      'Step / Player / Renderer 内核：算法写成生成器产出快照',
      '8 种排序 + 多算法同屏对比 + 比较与交换计数',
      '链表、栈队列、树（含 AVL 四种旋转拆解）、图、查找、KMP、指针与内存',
    ],
  },
}

export function SectionPage() {
  const { section = '' } = useParams()
  // MAP 的键是路由顶层段（knowledge / viz / problems），而 :section 是它下面的子节。
  // 顶层入口 /#/knowledge、/#/viz 没有 :section 参数，只认 section 会永远落到通用占位，
  // 把写好的「阶段 6 / 阶段 7–9 + 待办清单」变成够不着的死代码。故用 pathname 首段定位板块。
  const top = useLocation().pathname.replace(/^\/+/, '').split('/')[0] ?? ''
  const key = MAP[top] ? top : section
  const info = MAP[key] ?? { name: section || top, phase: '后续阶段', todo: [] }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{info.name}</h1>
      <PhasePlaceholder phase={info.phase} todo={info.todo} />
    </div>
  )
}
