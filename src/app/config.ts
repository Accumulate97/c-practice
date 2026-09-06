/** 全站常量。编译后端的数值依据 docs/adr/0001-judge-backend.md 的实测结论，勿凭感觉改。 */
export const APP_NAME = 'C practice'
export const STORAGE_PREFIX = 'cpractice'
/** localStorage 版本化键名：任何结构变更都要升版本号并写迁移，禁止原地改结构 */
export const SETTINGS_KEY = `${STORAGE_PREFIX}:settings:v1`
export const PROGRESS_KEY = `${STORAGE_PREFIX}:progress:v1`

/** 数据分片路径（相对站点根）。用 fetch + BASE_URL，不用 import()，改数据无需重建 JS chunk */
export const dataUrl = (rel: string): string =>
  `${import.meta.env.BASE_URL}data/${rel.replace(/^\/+/, '')}`

export const judge = {
  backend: import.meta.env.VITE_JUDGE_BACKEND ?? 'godbolt',
  godboltCompiler: import.meta.env.VITE_GODBOLT_COMPILER ?? 'cg132',
  /** ADR-0001 4.3：并发 20 时完成速率从 1.36 跌到 0.52 QPS —— 并发必须压到 2 */
  maxConcurrency: 2,
  /** 串行请求之间的最小间隔，避免突发压测把公共实例打抖 */
  minIntervalMs: 250,
  /** 单请求软超时；服务端排队时 P99 可达数秒，故留 20s 余量 */
  timeoutMs: 20_000,
  userArguments: '-std=c99 -Wall -Wextra',
  /** 顶层 code=-1 同时表示编译失败与 TLE，必须靠 buildResult.code / timedOut 区分 */
  resultOrder: ['buildResult.code', 'timedOut', 'code', 'truncated'] as const,
} as const

/** 阶段 1 的三个板块入口，后续阶段逐个填实 */
export const sections = [
  { path: '/knowledge', emoji: '📖', title: '知识点汇总', intent: '学', desc: '这个概念是什么' },
  { path: '/viz', emoji: '🎬', title: '可视化演示', intent: '懂', desc: '它是怎么工作的' },
  { path: '/problems', emoji: '✍️', title: '在线刷题', intent: '练', desc: '我会不会用' },
] as const