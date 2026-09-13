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
  /**
   * libm 支路的编译器 id（阶段 5 · R5）。cg132 链不上 libm，含 sqrt 的代码会报
   * undefined reference；cicc191 = x86-64 icc 19.0.1，是 Godbolt C 编译器列表里
   * 实测既能链 libm、又不拒绝 C 专属写法（malloc 不强转 / _Bool）的那一个。
   * 选型证据与被否决的 g132 见 src/judge/math-lib.ts 文件头表格，勿凭感觉改。
   */
  godboltMathCompiler: import.meta.env.VITE_GODBOLT_MATH_COMPILER ?? 'cicc191',
  /** ADR-0001 4.3：并发 20 时完成速率从 1.36 跌到 0.52 QPS —— 并发必须压到 2 */
  maxConcurrency: 2,
  /**
   * 串行请求之间的最小间隔（闸门，不是限流器）。
   * 实测（ADR-0001 4.3 / 9.3）：真实请求单发 337–2747 ms，本来就大于任何合理间隔，
   * 所以这道闸在冷启动路径上几乎不会触发；但两类场景会立刻撞上——
   *   ① 结果缓存命中（实测整批复跑 0 请求 / ~10 ms），
   *   ② 学生连点「运行」按钮。
   * 保留它的成本为零，故不删除；取值由 250 下调到 100，避免拖慢降级路径与缓存路径的手感。
   */
  minIntervalMs: 100,
  /**
   * 单请求软超时。必须 **大于** Godbolt 服务端的执行时限，否则死循环会被我方
   * AbortController 先掐断，判成「后端不可用」而不是「运行超时」。
   * 实测（ADR-0001 §9.4）：死循环请求 execTime=20154/20357 ms，HTTP 响应在 ~20.9 s 返回；
   * 而 executeParameters.timeout 传 3 秒并不生效（公共实例忽略该字段，仍在 20 s 处 SIGKILL）。
   * 旧值 20_000 与 20 s 相撞，实测导致 timeout 分类永远走不到，故上调到 25s。
   */
  timeoutMs: 25_000,
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

/**
 * 代码游乐场（任务 3-1）可选的编译器注册表。
 *
 * 每一项都在 2026-09-13 用「executorRequest:true + filters.execute:true + -std=c99 -Wall -Wextra +
 * stdin 真喂进去」实机跑通，并断言 didExecute===true && truncated===false && code===0 &&
 * stdout==="sum=5050" 之后才写进来（探测脚本 tmp/probe-compilers.mjs，5/5 全绿，
 * 单次往返 484~2958 ms）。Godbolt 的 /api/compilers/c 列了 1049 个编译器，
 * 但绝大多数（交叉编译器 / 只出汇编的）不给执行，所以这里只登记实测可执行的。
 *
 * ⚠️ 判分口径不随游乐场变：题目判分永远走 judge.godboltCompiler（cg132），
 *    换编译器只影响游乐场里的探索性运行，不改任何题目的 verified 结论。
 */
export const playgroundCompilers = [
  { id: 'cg132', label: 'GCC 13.2（默认 · 与全站判分同口径）', note: 'x86-64 gcc 13.2，实测 execTime 32 ms' },
  { id: 'cg152', label: 'GCC 15.2', note: 'x86-64 gcc 15.2，-Wextra 诊断更啰嗦，适合看警告' },
  { id: 'cg162', label: 'GCC 16.2', note: 'x86-64 gcc 16.2，最新稳定版，实测 execTime 19 ms' },
  { id: 'cclang1810', label: 'Clang 18.1', note: 'x86-64 clang 18.1.0，错误提示带修复建议' },
  { id: 'cclang2010', label: 'Clang 20.1', note: 'x86-64 clang 20.1.0，C23 支持最全' },
] as const

/** 游乐场默认编译器：与判分同口径，避免「游乐场能跑、判分不过」的错觉 */
export const PLAYGROUND_DEFAULT_COMPILER = playgroundCompilers[0].id

