import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">404 · 页面不存在</h1>
      <p style={{ color: 'var(--fg-muted)' }}>
        你访问的地址在本站点中不存在。可返回 <Link to="/">首页</Link>。
      </p>
    </div>
  )
}