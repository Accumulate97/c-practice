interface Props {
  phase: string
  done?: string[]
  todo?: string[]
}

/** 阶段占位组件：明确写出"本阶段还没做什么"，避免骨架被误认为已完成功能 */
export function PhasePlaceholder({ phase, done = [], todo = [] }: Props) {
  return (
    <section className="rounded-xl border p-6" style={{ borderColor: 'var(--border)' }}>
      <p className="text-sm font-medium" style={{ color: 'var(--color-brand)' }}>
        本板块将在 {phase} 落地
      </p>
      {done.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {done.map((d) => (
            <li key={d}>✅ {d}</li>
          ))}
        </ul>
      )}
      {todo.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {todo.map((t) => (
            <li key={t}>⬜ {t}</li>
          ))}
        </ul>
      )}
    </section>
  )
}