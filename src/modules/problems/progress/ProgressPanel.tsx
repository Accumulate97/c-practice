/**
 * 详情页的「我的记录」卡片（阶段 5，全题型通用）。
 *
 * 放在这里而不是各渲染器里：收藏 / 笔记 / 错题本 / 回看上次提交这四件事与题型无关，
 * 十一个渲染器各写一遍必然漂移。渲染器只负责「作答 + 判分 + 落盘结论」，
 * 结论落盘之后本卡片自动跟着变（同一个 zustand store，无需任何回调）。
 *
 * 诚实性红线（与 store.ts 同源）：
 *   · 自评得出的结论会明确标注「来自你的自评」，不冒充机器判分；
 *   · lastAnswerTruncated 为真时如实说明「只存了前 N 字符」，不假装是完整代码；
 *   · 「未判定」（后端抖动）根本不写记录，所以这里永远不会出现「后端挂了 → 显示已通过」。
 */
import { useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import { MONO_FONT } from '../../../components/common/CodeEditor'
import { MAX_NOTE } from './schema'
import type { AnswerKind } from './schema'
import { statusOf, useProgress } from './store'
import type { ListStatus } from './store'
import { inWrongBook, isDismissed } from './wrongbook'

const panel: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-elev)' }
const muted: CSSProperties = { color: 'var(--fg-muted)' }
const control: CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--fg)' }

const STATUS_META: Record<ListStatus, { label: string; color: string; dot: string }> = {
  todo: { label: '未做', color: 'var(--fg-muted)', dot: '○' },
  attempted: { label: '尝试过未通过', color: 'var(--fg-warn)', dot: '◐' },
  passed: { label: '已通过', color: 'var(--fg-ok)', dot: '●' },
}

const KIND_LABEL: Record<AnswerKind, string> = {
  code: '上次提交的代码',
  text: '上次提交的答案',
  choice: '上次选择的选项',
  self: '上次自评结论',
}

/** epoch ms → 本地可读时刻。列表页/进度页/本卡片共用这一份格式，不要各写一套 */
export function formatDateTime(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Props {
  problemId: string
}

export function ProgressPanel({ problemId }: Props) {
  const record = useProgress((s) => s.records[problemId])
  const setStarred = useProgress((s) => s.setStarred)
  const setNote = useProgress((s) => s.setNote)
  const dismissWrong = useProgress((s) => s.dismissWrong)
  const undoDismissWrong = useProgress((s) => s.undoDismissWrong)

  const status = statusOf(record)
  const meta = STATUS_META[status]
  const [draft, setDraft] = useState<string | null>(null)
  const note = draft ?? record?.note ?? ''
  const dirty = draft !== null && draft !== (record?.note ?? '')

  const saveNote = useCallback(() => {
    setNote(problemId, draft ?? '')
    setDraft(null)
  }, [draft, problemId, setNote])

  const inBook = inWrongBook(record)
  // 已经通过的题不该再摆一个「放回错题本」按钮：错题本只装当前未通过的题，
  // 而 wrongDismissedAt 是历史事实（做对之前点过「我已掌握」），做对之后它已无意义。
  const dismissed = status !== 'passed' && isDismissed(record)
  // 用局部常量而不是布尔标记做守卫：TS 不会把「answered===true」窄化成 lastAnswer 非空
  const lastAnswer = record?.lastAnswer ?? null
  const answered = lastAnswer !== null

  return (
    <section className="rounded-xl border p-4" style={panel} data-role="progress-panel" data-status={status} data-id={problemId}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold" style={{ color: meta.color }} data-role="status-label">
          {meta.dot} {meta.label}
        </span>
        {record && record.selfAssessed && (
          <span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--border)' }} title="简答题等不自动判分的题型由学生自评得出，不计入机器判分正确率">
            自评结论（不计入正确率）
          </span>
        )}
        <button
          type="button"
          onClick={() => setStarred(problemId, !(record?.starred ?? false))}
          className="ml-auto rounded-lg border px-3 py-1 text-xs"
          style={{ ...control, color: record?.starred ? 'var(--fg-warn)' : 'var(--fg-muted)' }}
          data-role="star-toggle"
          data-starred={record?.starred === true ? 'true' : 'false'}
          aria-pressed={record?.starred === true}
          title="收藏的题目会出现在「我的进度 → 收藏」里"
        >
          {record?.starred ? '★ 已收藏' : '☆ 收藏'}
        </button>
      </div>

      {record === undefined ? (
        <p className="mt-2 text-xs" style={muted}>
          还没有作答记录。判分（或简答题自评）之后，这里会出现尝试次数、时间与错题本状态。
        </p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" style={muted} data-role="record-summary">
          <div><dt className="inline">提交次数</dt><dd className="inline font-semibold" style={{ color: 'var(--fg)' }}> {record.attempts}</dd></div>
          <div><dt className="inline">错误次数</dt><dd className="inline font-semibold" style={{ color: record.wrongCount > 0 ? 'var(--fg-bad)' : 'var(--fg)' }}> {record.wrongCount}</dd></div>
          <div><dt className="inline">首次尝试</dt><dd className="inline"> {formatDateTime(record.firstAttemptAt)}</dd></div>
          <div><dt className="inline">最近尝试</dt><dd className="inline"> {formatDateTime(record.lastAt)}</dd></div>
          {record.firstPassedAt !== null && (
            <div><dt className="inline">首次通过</dt><dd className="inline"> {formatDateTime(record.firstPassedAt)}</dd></div>
          )}
          {record.lastWrongAt !== null && (
            <div><dt className="inline">最近错误</dt><dd className="inline"> {formatDateTime(record.lastWrongAt)}</dd></div>
          )}
        </dl>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-role="wrongbook-state" data-in-wrongbook={inBook ? 'true' : 'false'}>
        {inBook ? (
          <>
            <span style={{ color: 'var(--fg-bad)' }}>在错题本里</span>
            <button type="button" onClick={() => dismissWrong(problemId)} className="rounded-lg border px-2 py-1" style={control} data-role="wrong-dismiss">
              我已掌握，移出错题本
            </button>
          </>
        ) : dismissed ? (
          <>
            <span style={muted}>已移出错题本（{formatDateTime(record?.wrongDismissedAt)}）</span>
            <button type="button" onClick={() => undoDismissWrong(problemId)} className="rounded-lg border px-2 py-1" style={control} data-role="wrong-restore">
              放回错题本
            </button>
          </>
        ) : (
          <span style={muted}>不在错题本里</span>
        )}
        <span style={muted}>移出后再做错会自动回来。</span>
      </div>

      {answered && record && (
        <details className="mt-3 text-xs" data-role="last-answer" data-kind={record.lastAnswerKind ?? 'text'}>
          <summary className="cursor-pointer" style={muted}>
            回看{record.lastAnswerKind ? KIND_LABEL[record.lastAnswerKind] : '上次提交'}（{formatDateTime(record.lastAt)}）
          </summary>
          <pre
            className="mt-2 max-h-64 overflow-auto rounded-lg border p-2 whitespace-pre-wrap"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', fontFamily: record.lastAnswerKind === 'code' ? MONO_FONT : undefined }}
          >
            {lastAnswer}
          </pre>
          {record.lastAnswerTruncated && (
            <p className="mt-1" style={{ color: 'var(--fg-warn)' }}>
              只保存了前 {lastAnswer.length} 个字符（localStorage 有容量上限），这份回看不完整。
            </p>
          )}
        </details>
      )}

      <div className="mt-3">
        <label className="text-xs" style={muted} htmlFor={`note-${problemId}`}>
          个人笔记（只存在本机浏览器，不上传）
        </label>
        <textarea
          id={`note-${problemId}`}
          className="mt-1 w-full resize-y rounded-lg border px-2 py-1.5 text-sm outline-none"
          style={control}
          rows={2}
          value={note}
          maxLength={MAX_NOTE}
          placeholder="例如：这里错在忘了 break；下次注意 scanf 的返回值"
          onChange={(e) => setDraft(e.target.value)}
          data-role="note-input"
        />
        <div className="mt-1 flex items-center gap-2 text-xs" style={muted}>
          <button type="button" onClick={saveNote} disabled={!dirty} className="rounded-lg border px-2 py-1" style={dirty ? control : { ...control, opacity: 0.5 }} data-role="note-save">
            保存笔记
          </button>
          {draft !== null && (
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border px-2 py-1" style={control} data-role="note-cancel">
              放弃修改
            </button>
          )}
          <span data-role="note-count">{note.length}/{MAX_NOTE}</span>
        </div>
      </div>
    </section>
  )
}
