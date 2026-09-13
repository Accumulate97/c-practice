/**
 * 速查手册页（任务 3-3）：/#/cheatsheet —— printf/scanf 格式符、运算符优先级、ASCII、关键字、库函数。
 *
 * 一页装全部，靠**搜索框**而不是分页找东西：查手册的动作永远是「我知道要找 %g」，
 * 所以搜索是跨全部 6 个分区、17 张表、上千行的行级过滤（不命中的表整张折叠掉，命中数如实报）。
 * 语料在 modules/ref/data.ts，ASCII 表由 charCode 程序化生成（不是手抄的 128 行）。
 *
 * 无障碍：每张表都带 <caption>（屏幕阅读器读得出这是什么表）+ <th scope="col">；
 * 表格外面套 overflow-x-auto，375px 窄屏靠表内横向滚动，绝不撑破页面。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { REF_ROW_COUNT, REF_SECTIONS, rowMatches } from '../modules/ref/data'
import type { RefRow, RefSection, RefTable } from '../modules/ref/data'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }

interface Filtered {
  section: RefSection
  tables: { table: RefTable; rows: RefRow[] }[]
}

export function CheatsheetPage() {
  const [params] = useSearchParams()
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const query = q.trim()
  // 任务 4-2：全站搜索的手册条目深链 ?q=<词> —— 落进来就把搜索框填好、行级过滤立即生效，
  // 学生不必把刚在搜索页看过的词再打一遍。只认入站参数：页内打字不回写 URL（那是手册自己的过滤态）。
  const deepQ = params.get('q') ?? ''
  useEffect(() => { setQ(deepQ) }, [deepQ])


  const filtered: Filtered[] = useMemo(() => {
    const out: Filtered[] = []
    for (const section of REF_SECTIONS) {
      const tables: { table: RefTable; rows: RefRow[] }[] = []
      for (const table of section.tables) {
        const rows = query ? table.rows.filter((r) => rowMatches(r, table.columns, query)) : table.rows
        if (rows.length > 0) tables.push({ table, rows })
      }
      if (tables.length > 0) out.push({ section, tables })
    }
    return out
  }, [query])

  const hits = filtered.reduce((a, s) => a + s.tables.reduce((b, t) => b + t.rows.length, 0), 0)
  const jump = (id: string) => document.getElementById(`ref-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })

  return (
    <div className="space-y-5" data-role="cheatsheet-page">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">📑 速查手册</h1>
        <p className="text-sm" style={muted}>
          {REF_SECTIONS.length} 个分区 · {REF_SECTIONS.reduce((a, s) => a + s.tables.length, 0)} 张表 · {REF_ROW_COUNT} 条。
          口径为 C99（与本站判分参数 -std=c99 -Wall -Wextra 一致），C++ 专属内容一律不收。
        </p>
      </header>

      <div className="sticky top-0 z-10 space-y-2 rounded-lg border p-3" style={{ ...panel, background: 'var(--bg-elev)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="ref-q" style={muted}>🔍 查什么</label>
          <input
            id="ref-q"
            type="search"
            data-role="cheatsheet-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="如 %g、优先级、strlen、_Bool、0x41、EOF…"
            aria-describedby="ref-hits"
            className="min-h-10 min-w-0 flex-1 rounded border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
          />
          {query ? (
            <button
              type="button"
              data-role="cheatsheet-clear"
              onClick={() => setQ('')}
              className="min-h-10 rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              ✕ 清除
            </button>
          ) : null}
          <span id="ref-hits" className="text-xs" style={muted} data-role="cheatsheet-hits" aria-live="polite">
            {query ? `命中 ${hits} 条（共 ${REF_ROW_COUNT} 条）` : `共 ${REF_ROW_COUNT} 条`}
          </span>
        </div>
        <nav aria-label="手册分区" data-role="cheatsheet-nav" className="flex flex-wrap gap-1 text-xs">
          {REF_SECTIONS.map((s) => {
            const on = filtered.some((f) => f.section.id === s.id)
            return (
              <button
                key={s.id}
                type="button"
                data-role="cheatsheet-nav-link"
                data-section={s.id}
                disabled={!on}
                onClick={() => jump(s.id)}
                aria-disabled={!on}
                className="min-h-8 rounded-md border px-2.5 py-1.5 disabled:opacity-40"
                style={{ borderColor: 'var(--border)', color: on ? 'var(--fg)' : 'var(--fg-muted)' }}
              >
                {s.emoji} {s.title}
              </button>
            )
          })}
        </nav>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border px-3 py-6 text-center text-sm" style={{ ...panel, ...muted }} data-role="cheatsheet-empty">
          没有命中「{query}」。试试更短的词（比如只输 strlen、%d、优先级），或点上方「✕ 清除」看全表。
        </p>
      ) : (
        <div className="space-y-6">
          {filtered.map(({ section, tables }) => (
            <section key={section.id} id={`ref-${section.id}`} className="space-y-3 scroll-mt-32" data-role="cheatsheet-section" data-section={section.id}>
              <h2 className="text-lg font-semibold">
                {section.emoji} {section.title}
                <span className="ml-2 text-xs font-normal" style={muted}>
                  {tables.reduce((a, t) => a + t.rows.length, 0)} 条
                </span>
              </h2>
              {section.intro ? <p className="text-sm" style={muted}>{section.intro}</p> : null}
              {tables.map(({ table, rows }) => (
                <Table key={table.id} table={table} rows={rows} />
              ))}
              {section.tips && section.tips.length > 0 && !query ? (
                <ul className="space-y-1 rounded-lg border p-3 text-xs" style={{ ...panel, ...muted }} data-role="cheatsheet-tips" aria-label={`${section.title} 的易错提示`}>
                  {section.tips.map((t) => (
                    <li key={t.title} data-role="cheatsheet-tip">
                      <strong style={{ color: 'var(--fg)' }}>{t.title}：</strong>
                      {t.body}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      )}

      <p className="rounded-lg border p-3 text-xs" style={{ ...panel, ...muted }}>
        看到想验证的写法，直接去{' '}
        <Link to="/playground" className="underline" style={{ color: 'var(--fg-link)' }}>🧪 代码游乐场</Link>{' '}
        真机编译运行；想知道某个写法为什么错，去{' '}
        <Link to="/bugs" className="underline" style={{ color: 'var(--fg-link)' }}>🐞 错误博物馆</Link>{' '}
        看它当场崩给你看。
      </p>
    </div>
  )
}

function Table({ table, rows }: { table: RefTable; rows: RefRow[] }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
        {table.title}
        <span className="ml-2 text-xs font-normal" style={muted}>{rows.length} 行</span>
      </h3>
      {table.note ? <p className="text-xs" style={muted}>{table.note}</p> : null}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full border-collapse text-xs" data-role="cheatsheet-table" data-table={table.id}>
          <caption className="sr-only px-3 py-2 text-left text-xs" style={muted}>{table.caption}</caption>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className="whitespace-nowrap border-b px-2 py-1.5 text-left font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-role="cheatsheet-row" className="align-top">
                {table.columns.map((c) => (
                  <td key={c.key} className={`border-b px-2 py-1.5 ${c.mono ? 'font-mono' : ''}`} style={{ borderColor: 'var(--border)', color: c.mono ? 'var(--fg)' : 'var(--fg-muted)' }}>
                    {r[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

