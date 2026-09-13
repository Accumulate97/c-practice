/**
 * 错误博物馆语料加载器（任务 3-4）。
 *
 * 两份文件、两种性质，别混为一谈：
 *   · bugs/exhibits.json —— 展品正文，由 scripts/gen-bug-data.mjs 生成（关联 id 从索引现算）。
 *   · bugs/observed.json —— **真实 Godbolt 实测证据**，由 scripts/probe-bug-exhibits.ts 生成。
 *     它是"上次实测"区块的唯一数据源；读不到时页面照常可用，只是不显示实测证据（不猜、不编）。
 */
import { dataUrl } from '../../app/config'

export interface BugVariant {
  code: string
  /** 送入 stdin 的内容；无输入为空串 */
  stdin: string
}

export interface BugExhibit {
  id: string
  emoji: string
  title: string
  category: string
  severity: 'crash' | 'silent' | 'invisible'
  severityLabel: string
  severityHint: string
  chapter: string
  symptom: string
  story: string
  compilerSays: string
  takeaway: string[]
  buggy: BugVariant
  safe: BugVariant
  knowledgeIds: string[]
  relatedProblems: string[]
}

export interface BugCategory { id: string; title: string; emoji: string }

export interface BugCorpus {
  generatedBy: string
  categories: BugCategory[]
  severity: Record<string, { label: string; hint: string }>
  exhibits: BugExhibit[]
}

export interface ObservedDiag { line: number; severity: string; message: string }

export interface ObservedRun {
  probed: boolean
  probedAt?: string
  errorClass?: string
  compiled?: boolean
  exitCode?: number
  stdout?: string
  stderr?: string
  diagnostics?: ObservedDiag[]
  execTimeMs?: number | null
  /** true = 本次探针传输层失败，沿用的是上一份证据 */
  stale?: boolean
  staleReason?: string
  error?: string
}

export interface ObservedCorpus {
  probedAt: string
  backend: { id: string; compiler: string; userArguments: string }
  runs: Record<string, ObservedRun>
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`数据文件加载失败：${url}（HTTP ${res.status}）`)
  return (await res.json()) as T
}

let corpusPromise: Promise<BugCorpus> | null = null
export function loadBugCorpus(): Promise<BugCorpus> {
  if (!corpusPromise) {
    corpusPromise = getJson<BugCorpus>(dataUrl('bugs/exhibits.json')).catch((error: unknown) => {
      corpusPromise = null
      throw error
    })
  }
  return corpusPromise
}

let observedPromise: Promise<ObservedCorpus | null> | null = null
/** 实测证据是加分项不是必需项：读不到返回 null，页面不报错 */
export function loadBugObserved(): Promise<ObservedCorpus | null> {
  if (!observedPromise) {
    observedPromise = getJson<ObservedCorpus>(dataUrl('bugs/observed.json')).catch(() => null)
  }
  return observedPromise
}
