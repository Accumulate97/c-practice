/**
 * 3D 演示页的对照代码面板。
 *
 * 为什么不直接复用 2D 演示页里的 CodePanel：那个组件是 VizDemoPage.tsx 的**文件内私有**
 * 函数（没有 export），要共用就得改上一阶段已验收通过的 2D 页面 —— 为了省 25 行去动一个
 * 已验证文件，风险收益不划算（AGENTS.md 六·2）。这里保留同一套视觉语言：
 * 行号 + step.codeLine 高亮 + 「仅展示不编译」的诚实说明。
 *
 * 3D 场景里这一步特别重要：3D 画布是抽象化的示意图，学生需要随时能回到真实 C 代码
 * 上确认「这一格对应哪一行」，否则 3D 就成了好看的动画而不是教学工具。
 */
import type { CSSProperties } from 'react'
import { highlightC } from '../../components/common/CodeBlock'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }

export function CodePanel3D({ code, line }: { code: string; line?: number }) {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <section className="overflow-hidden rounded-xl border" style={panel} data-role="viz3d-code">
      <p
        className="border-b px-3 py-2 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}
      >
        对照代码（标准 C，仅展示不编译）
      </p>
      <pre className="max-h-[26rem] overflow-auto py-2 text-xs leading-5">
        <code>
          {lines.map((text, i) => {
            const no = i + 1
            const active = line === no
            return (
              <div
                key={no}
                data-line={no}
                data-active={active ? 'true' : 'false'}
                className="flex px-2"
                style={active ? { background: 'color-mix(in srgb, var(--color-viz-active) 22%, transparent)' } : undefined}
              >
                <span className="w-7 shrink-0 text-right opacity-50" style={{ color: 'var(--fg-muted)' }}>
                  {no}
                </span>
                <span className="ml-3 whitespace-pre" style={{ color: 'var(--fg)' }}>
                  {text ? highlightC(text) : ' '}
                </span>
              </div>
            )
          })}
        </code>
      </pre>
    </section>
  )
}
