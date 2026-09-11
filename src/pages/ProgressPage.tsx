/**
 * 📈 我的进度（阶段 5）：统计 / 错题本 / 收藏 / 导出导入 / 数据急救。
 *
 * 数据来源只有两处，都不联网：
 *   · public/data/problems/index.json —— 题库规模与章节/题型归属（loadIndex 已在列表页/详情页缓存，
 *     这里复用同一个 Promise，不会多发一次请求）
 *   · localStorage 的进度记录表（zustand persist，版本裁决与备份见 progress/storage.ts）
 * 统计口径全部由 progress/stats.ts 现算，页面只负责渲染，不自己 if。
 *
 * 页面上每个数字都能被验收脚本用 data-role/data-* 直接读走并与 index.json 对账，
 * 所以这些属性名是契约的一部分，改名要同步改 scripts/acceptance-progress-ui.mjs。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { loadIndex } from '../modules/problems/data/loader'
import type { ProblemIndex } from '../modules/problems/data/loader'
import { formatDateTime } from '../modules/problems/progress/ProgressPanel'
import { PROGRESS_KEY } from '../app/config'
import { accuracyText, computeStats, percentOf } from '../modules/problems/progress/stats'
import type { BucketStat } from '../modules/problems/progress/stats'
import { dismissProgressIssues, listBackups, progressIssues } from '../modules/problems/progress/storage'
import type { ProgressIssue } from '../modules/problems/progress/storage'
import { PROGRESS_SCHEMA_VERSION, useProgress } from '../modules/problems/progress/store'
import {
  EXPORT_APP, EXPORT_KIND,
  buildExport, downloadText, exportFilename, importProgress, serializeExport,
} from '../modules/problems/progress/transfer'
import { starredItems, wrongCountLabel, wrongBookItems } from '../modules/problems/progress/wrongbook'
import { shortId, typeLabel } from '../modules/problems/type-meta'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const control: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }
const GOOD = 'var(--fg-ok)'
const BAD = 'var(--fg-bad)'
const WARN = 'var(--fg-warn)'
// 进度条填充是图形，另用可视化令牌：文字要 AA 的 4.5:1，色块只需 3:1，两者不能共用一个值
const GOOD_BG = 'var(--color-viz-sorted)'
const WARN_BG = 'var(--color-viz-compare)'

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; index: ProblemIndex }

export function ProgressPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase({ kind: 'loading' })
    loadIndex().then(
      (index) => { if (alive) setPhase({ kind: 'ready', index }) },
      (error: unknown) => { if (alive) setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { alive = false }
  }, [reloadKey])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">📈 我的进度</h1>
        <p className="mt-1 text-sm" style={muted}>
          全部数据只存在本机浏览器的 localStorage 里（键 <code>{PROGRESS_KEY}</code>），不上传、不联网统计。
          换浏览器或清缓存前请先用下面的「导出进度」备份。
        </p>
      </header>

      {phase.kind === 'loading' && <p className="text-sm" style={muted}>正在读取题库索引以计算分母…</p>}
      {phase.kind === 'error' && (
        <section className="rounded-xl border p-6" style={panel}>
          <p className="text-sm font-semibold">题库索引加载失败，无法计算「总题数」这类分母</p>
          <p className="mt-2 text-sm" style={muted}>{phase.message}</p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mt-3 rounded-lg border px-3 py-2 text-sm" style={control}>重试</button>
        </section>
      )}
      {phase.kind === 'ready' && <Ready index={phase.index} />}
    </div>
  )
}

function Ready({ index }: { index: ProblemIndex }) {
  const records = useProgress((s) => s.records)
  const replaceAll = useProgress((s) => s.replaceAll)
  const clear = useProgress((s) => s.clear)
  const dismissWrong = useProgress((s) => s.dismissWrong)

  const stats = useMemo(() => computeStats(index, records), [index, records])
  const wrongBook = useMemo(() => wrongBookItems(index, records), [index, records])
  const starred = useMemo(() => starredItems(index, records), [index, records])

  const [report, setReport] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [issues, setIssues] = useState<readonly ProgressIssue[]>(() => progressIssues())
  const [backups, setBackups] = useState<{ key: string; bytes: number }[]>(() => listBackups())
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refreshRescue = useCallback(() => {
    setIssues(progressIssues())
    setBackups(listBackups())
  }, [])

  const doExport = useCallback(() => {
    const text = serializeExport(buildExport(records, index.problems.length))
    const name = exportFilename()
    downloadText(name, text)
    setReport({ tone: 'good', text: `已导出 ${name}（${text.length} 字符 / ${stats.recordCount} 条记录 / schemaVersion=${String(PROGRESS_SCHEMA_VERSION)}）` })
  }, [index.problems.length, records, stats.recordCount])

  const doImport = useCallback(async (file: File) => {
    let text: string
    try {
      text = await file.text()
    } catch (error) {
      setReport({ tone: 'bad', text: `读不出文件内容：${error instanceof Error ? error.message : String(error)}` })
      return
    }
    const outcome = importProgress(records, text)
    if (outcome.kind === 'rejected') {
      setReport({ tone: 'bad', text: `导入被拒：${outcome.reason}` })
      return
    }
    replaceAll(outcome.records)
    const r = outcome.report
    const parts = [
      `文件 ${r.incoming} 条`,
      `新增 ${r.added}`,
      `更新 ${r.updated}`,
      `无变化 ${r.unchanged}`,
    ]
    if (r.dropped > 0) parts.push(`丢弃 ${r.dropped}（洗不成记录）`)
    if (r.noteConflicts > 0) parts.push(`笔记冲突 ${r.noteConflicts}（保留最近修改的一份）`)
    if (r.steps.length > 0) parts.push(`已从 schemaVersion=${String(r.fromVersion)} 迁移：${r.steps.join('→')}`)
    setReport({ tone: 'good', text: `导入完成（${file.name}）：${parts.join(' · ')}` })
    refreshRescue()
  }, [records, refreshRescue, replaceAll])

  const o = stats.overall

  return (
    <>
      <Overview stat={o} recordCount={stats.recordCount} orphanIds={stats.orphanIds} problemCount={stats.problemCount} wrongBookCount={wrongBook.length} starredCount={starred.length} />

      {report && (
        <section className="rounded-xl border p-3 text-sm" style={{ ...panel, borderColor: report.tone === 'good' ? GOOD : BAD }} data-role="transfer-report" data-tone={report.tone}>
          {report.text}
        </section>
      )}

      <BucketTable title="按章节" role="chapter-stats" keyAttr="chapter" buckets={stats.byChapter} />
      <BucketTable title="按题型" role="type-stats" keyAttr="type" buckets={stats.byType} />

      <section className="rounded-xl border p-4" style={panel} data-role="wrongbook" data-count={String(wrongBook.length)}>
        <h2 className="text-sm font-semibold">📕 错题本（{wrongBook.length} 道在册）</h2>
        <p className="mt-1 text-xs" style={muted}>
          收录口径：真错过（机器判分失败，或简答题自评「还没答对」）、且最近一次结论仍未通过。后来做对会自动出册；点「我已掌握」可手工移出，移出后再做错会自动回来。
          后端抖动属「未判定」，不写记录，所以不会因为服务不稳而误收。
        </p>
        {wrongBook.length === 0 ? (
          <p className="mt-3 text-sm" style={muted} data-role="wrongbook-empty">错题本是空的。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {wrongBook.map((item) => (
              <li key={item.entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} data-role="wrongbook-row" data-id={item.entry.id}>
                <Link to={`/problems/p/${item.entry.id}`} className="hover:underline" style={{ fontFamily: 'var(--font-mono)' }}>{shortId(item.entry.id)}</Link>
                <span style={muted}>{item.entry.chapter}</span>
                <span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--border)' }}>{typeLabel(item.entry.type)}</span>
                <span className="text-xs" style={{ color: BAD }} data-role="wrong-count" data-count={String(item.wrongCount)} data-self-assessed={item.record.selfAssessed ? 'true' : 'false'}>{wrongCountLabel(item.record)}</span>
                <span className="text-xs" style={muted}>最近错误 {formatDateTime(item.lastWrongAt)}</span>
                <button type="button" onClick={() => dismissWrong(item.entry.id)} className="ml-auto rounded-lg border px-2 py-1 text-xs" style={control} data-role="wrong-dismiss">
                  我已掌握，移出
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border p-4" style={panel} data-role="starred" data-count={String(starred.length)}>
        <h2 className="text-sm font-semibold">⭐ 收藏（{starred.length} 道）</h2>
        {starred.length === 0 ? (
          <p className="mt-2 text-sm" style={muted} data-role="starred-empty">还没有收藏。题目详情页的「☆ 收藏」按钮可以把题收进来。</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {starred.map((item) => (
              <li key={item.entry.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }} data-role="starred-row" data-id={item.entry.id}>
                <Link to={`/problems/p/${item.entry.id}`} className="hover:underline" style={{ fontFamily: 'var(--font-mono)' }}>{shortId(item.entry.id)}</Link>
                <span className="truncate text-xs" style={muted}>{item.entry.chapter} · {typeLabel(item.entry.type)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border p-4" style={panel} data-role="transfer">
        <h2 className="text-sm font-semibold">导出 / 导入</h2>
        <p className="mt-1 text-xs" style={muted}>
          导出是一份自带 schemaVersion={String(PROGRESS_SCHEMA_VERSION)} 的 JSON 文件（<code>{EXPORT_APP}</code> / <code>{EXPORT_KIND}</code>）。
          导入是**合并**而不是覆盖：同一条记录取较新一侧的结论，通过/收藏只增不减，尝试与错误次数取较大值 ——
          所以把同一个文件导两次不会把次数翻倍。旧版本的文件会先沿迁移链升级再合并。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={doExport} className="rounded-lg border px-3 py-2 text-sm" style={control} data-role="export-button">
            导出进度 JSON
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border px-3 py-2 text-sm" style={control} data-role="import-button">
            从文件导入…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-role="import-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void doImport(file)
            }}
          />
        </div>
      </section>

      <section className="rounded-xl border p-4" style={panel} data-role="rescue">
        <h2 className="text-sm font-semibold">数据急救</h2>
        <p className="mt-1 text-xs" style={muted}>
          这一区如实报告本机进度数据发生过什么：迁移过、备份过、写过失败。没有异常时它就该是空的。
        </p>
        <div className="mt-2 text-xs" data-role="issues" data-count={String(issues.length)}>
          {issues.length === 0 ? (
            <p style={muted}>本次会话没有发生迁移 / 备份 / 写入失败。</p>
          ) : (
            <ul className="space-y-1">
              {issues.map((issue, i) => <li key={i} style={{ color: WARN }}>{describeIssue(issue)}</li>)}
            </ul>
          )}
        </div>
        <div className="mt-2 text-xs" data-role="backups" data-count={String(backups.length)}>
          {backups.length === 0 ? (
            <p style={muted}>没有备份文件（备份只在版本不认识或 JSON 损坏时产生，最多留 3 份）。</p>
          ) : (
            <ul className="space-y-1">
              {backups.map((b) => (
                <li key={b.key} style={muted}>
                  <code>{b.key}</code> · {b.bytes} 字符 —— 这是被重置前的原文，可用浏览器开发者工具复制出来交给人工恢复
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={refreshRescue} className="rounded-lg border px-2 py-1 text-xs" style={control} data-role="rescue-refresh">刷新这一区</button>
          {issues.length > 0 && (
            <button
              type="button"
              onClick={() => { dismissProgressIssues(); refreshRescue() }}
              className="rounded-lg border px-2 py-1 text-xs"
              style={control}
              data-role="issues-dismiss"
              title="只清空本次会话的提示台账；已落盘的备份文件不会被删"
            >
              知道了
            </button>
          )}
          {confirmingClear ? (
            <>
              <span className="text-xs" style={{ color: BAD }}>确认清空本机全部进度？这一步不可撤销（建议先导出）。</span>
              <button
                type="button"
                onClick={() => { clear(); setConfirmingClear(false); setReport({ tone: 'good', text: '已清空本机进度记录。' }) }}
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ ...control, borderColor: BAD, color: BAD }}
                data-role="clear-confirm"
              >
                确认清空
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)} className="rounded-lg border px-3 py-1.5 text-sm" style={control} data-role="clear-cancel">取消</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingClear(true)} className="rounded-lg border px-3 py-1.5 text-sm" style={{ ...control, color: BAD }} data-role="clear-button">
              清空全部进度
            </button>
          )}
        </div>
      </section>

      <nav className="text-sm" style={muted}>
        <Link to="/problems" className="hover:underline">← 回到 ✍️ 在线刷题</Link>
      </nav>
    </>
  )
}

function describeIssue(issue: ProgressIssue): string {
  switch (issue.kind) {
    case 'migrated':
      return `进度数据已从 schemaVersion=${String(issue.from)} 迁移到当前版本（经过 ${issue.steps.join('→')}）${issue.dropped > 0 ? `，其中 ${issue.dropped} 条洗不成记录已丢弃` : ''}。`
    case 'reset-after-backup':
      return `版本不认识（${issue.reason === 'newer-version' ? `数据比本站新：schemaVersion=${String(issue.from)}` : `schemaVersion=${issue.from === null ? '非数字' : String(issue.from)} 在迁移链上没有落点`}），已把原文备份到 ${issue.backupKey ?? '（备份失败，见下）'} 后从空进度开始。`
    case 'parse-error':
      return `localStorage 里的进度不是合法 JSON（可能被其它扩展写坏），原文${issue.backupKey ? `已备份到 ${issue.backupKey}` : '未能备份'}，本次从空进度开始。`
    case 'read-failed':
      return `读取进度失败：${issue.message}`
    case 'write-failed':
      return `保存进度失败：${issue.message}${issue.recovered ? '（已降级保存成功）' : ''}`
  }
}

function Overview({ stat, recordCount, orphanIds, problemCount, wrongBookCount, starredCount }: {
  stat: BucketStat
  recordCount: number
  orphanIds: string[]
  problemCount: number
  wrongBookCount: number
  starredCount: number
}) {
  const cells: { label: string; value: string; color?: string; role: string; title?: string }[] = [
    { label: '题库总题数', value: String(stat.total), role: 'total', title: `与 index.json 的 count 对账：索引声明 ${String(problemCount)} 道` },
    { label: '已通过', value: String(stat.passed), color: GOOD, role: 'passed' },
    { label: '尝试过未通过', value: String(stat.attempted), color: WARN, role: 'attempted' },
    { label: '未做', value: String(stat.todo), role: 'todo' },
    { label: '机器判分正确率', value: accuracyText(stat.accuracy), role: 'accuracy', title: '（提交次数 − 错误次数）/ 提交次数；只统计机器判分，简答题自评不计入' },
    { label: '提交次数', value: String(stat.attempts), role: 'attempts' },
    { label: '错误次数', value: String(stat.wrongCount), color: stat.wrongCount > 0 ? BAD : undefined, role: 'wrong' },
    { label: '错题本在册', value: String(wrongBookCount), role: 'wrongbook-count' },
    { label: '收藏', value: String(starredCount), role: 'starred-count' },
    { label: '写了笔记', value: String(stat.noted), role: 'noted' },
  ]
  return (
    <section
      className="rounded-xl border p-4"
      style={panel}
      data-role="overview"
      data-total={String(stat.total)}
      data-passed={String(stat.passed)}
      data-attempted={String(stat.attempted)}
      data-todo={String(stat.todo)}
      data-attempts={String(stat.attempts)}
      data-wrong={String(stat.wrongCount)}
      data-accuracy={stat.accuracy === null ? '' : String(Math.round(stat.accuracy * 1000) / 10)}
      data-self-assessed={String(stat.selfAssessed)}
      data-records={String(recordCount)}
    >
      <h2 className="text-sm font-semibold">总览</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cells.map((c) => (
          <div key={c.role} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }} title={c.title}>
            <div className="text-xs" style={muted}>{c.label}</div>
            <div className="mt-0.5 text-xl font-semibold" style={c.color ? { color: c.color } : undefined} data-role={c.role}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs" style={muted}>
        完成度 {percentOf(stat.passed, stat.total)}%（{stat.passed}/{stat.total}）
        {stat.selfAssessed > 0 ? ` · 其中 ${stat.selfAssessed} 条结论来自学生自评（简答题），不计入正确率` : ''}
        {recordCount > problemCount ? ` · localStorage 里有 ${recordCount} 条记录` : ''}
      </div>
      <Bar passed={stat.passed} attempted={stat.attempted} total={stat.total} />
      {orphanIds.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: WARN }} data-role="orphan" data-count={String(orphanIds.length)}>
          有 {orphanIds.length} 条记录在题库索引里找不到对应题目（题目被删或改过 id），统计分母里没有它们：
          <code>{orphanIds.slice(0, 8).join('、')}{orphanIds.length > 8 ? ' …' : ''}</code>
        </p>
      )}
    </section>
  )
}

function Bar({ passed, attempted, total }: { passed: number; attempted: number; total: number }) {
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full border" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }} data-role="overall-bar">
      <div style={{ width: `${percentOf(passed, total)}%`, background: GOOD_BG }} data-role="bar-passed" />
      <div style={{ width: `${percentOf(attempted, total)}%`, background: WARN_BG }} data-role="bar-attempted" />
    </div>
  )
}

function BucketTable({ title, role, keyAttr, buckets }: { title: string; role: string; keyAttr: string; buckets: BucketStat[] }) {
  return (
    <section className="rounded-xl border p-4" style={panel} data-role={role} data-rows={String(buckets.length)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm" aria-label={title}>
          <thead>
            <tr className="text-xs" style={muted}>
              <th scope="col" className="py-1 pr-2 text-left font-medium">{title.replace('按', '')}</th>
              <th scope="col" className="py-1 px-2 text-right font-medium">题数</th>
              <th scope="col" className="py-1 px-2 text-right font-medium">已通过</th>
              <th scope="col" className="py-1 px-2 text-right font-medium">尝试过</th>
              <th scope="col" className="py-1 px-2 text-right font-medium">未做</th>
              <th scope="col" className="py-1 px-2 text-right font-medium">正确率</th>
              <th scope="col" className="py-1 px-2 text-right font-medium">错题</th>
              <th scope="col" className="py-1 pl-2 text-left font-medium w-1/4">完成度</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="border-t" style={{ borderColor: 'var(--border)' }} data-role="bucket-row" {...{ [`data-${keyAttr}`]: b.key }} data-total={String(b.total)} data-passed={String(b.passed)} data-attempted={String(b.attempted)} data-todo={String(b.todo)}>
                <td className="py-1.5 pr-2">{b.label}</td>
                <td className="py-1.5 px-2 text-right" style={muted}>{b.total}</td>
                <td className="py-1.5 px-2 text-right" style={{ color: b.passed > 0 ? GOOD : undefined }}>{b.passed}</td>
                <td className="py-1.5 px-2 text-right" style={{ color: b.attempted > 0 ? WARN : undefined }}>{b.attempted}</td>
                <td className="py-1.5 px-2 text-right" style={muted}>{b.todo}</td>
                <td className="py-1.5 px-2 text-right" data-role="accuracy">{accuracyText(b.accuracy)}</td>
                <td className="py-1.5 px-2 text-right" style={{ color: b.wrongBook > 0 ? BAD : undefined }}>{b.wrongBook}</td>
                <td className="py-1.5 pl-2">
                  <div className="flex h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg)' }}>
                    <div style={{ width: `${percentOf(b.passed, b.total)}%`, background: GOOD_BG }} />
                    <div style={{ width: `${percentOf(b.attempted, b.total)}%`, background: WARN_BG }} />
                  </div>
                  <div className="mt-0.5 text-xs" style={muted}>{percentOf(b.passed, b.total)}%</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
