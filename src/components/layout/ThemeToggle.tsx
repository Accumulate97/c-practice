import { useTheme, type ThemeMode } from '../../app/theme'

const MODES: { value: ThemeMode; label: string; title: string }[] = [
  { value: 'light', label: '☀️', title: '浅色' },
  { value: 'dark', label: '🌙', title: '深色' },
  { value: 'auto', label: '🖥️', title: '跟随系统' },
]

export function ThemeToggle() {
  const mode = useTheme((s) => s.mode)
  const setMode = useTheme((s) => s.setMode)
  return (
    <div role="group" aria-label="主题切换" className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.title}
          aria-pressed={mode === m.value}
          aria-label={`${m.title}主题`}
          onClick={() => setMode(m.value)}
          className="rounded px-2 py-1 text-sm"
          style={{ background: mode === m.value ? 'var(--bg-elev)' : 'transparent' }}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}