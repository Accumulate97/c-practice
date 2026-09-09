/**
 * libm 路由（阶段 5 · R5：把构建期已有的支路补到线上判分）。
 *
 * ── 问题 ─────────────────────────────────────────────────────────────────
 * 默认后端 cg132（x86-64 gcc 13.2）的**执行链路不吃 userArguments 里的 -lm**：
 * 含 sqrt() 一类数学函数的源码必然 `undefined reference to 'sqrt'`，
 * buildResult.code=1、didExecute=false，学生看到的是一条莫名其妙的「编译错误」，
 * 而他写的其实是合法 C。全库当前 2 道题踩这条（c-ch07-cr-001 / c-ch08-pg-005）。
 *
 * ── 为什么不是 g132（构建期 judge-verify.ts 原先的选择，本轮实测翻案）──────
 * 2026-09-09 实测（tmp/probe-mathdecide.mjs，Godbolt 公共 API，-std=c99 -Wall -Wextra）：
 *
 *   编译器 id       /api/compilers/c 里          A: sqrt(运行时变量)      B: C 专属写法(malloc 不强转 + _Bool)
 *   cg132           x86-64 gcc 13.2              ✗ undefined 'sqrt'       ✗ undefined 'sqrt'
 *   g132            **不在 C 列表里**（它是 C++） ✓ 输出 11                ✗ error: '_Bool' was not declared
 *   cicc191         x86-64 icc 19.0.1            ✓ 输出 11                ✓ 输出 "11 1"
 *   cicc202112      x86-64 icc 2021.1.2          ✓ 输出 11                ✓ 输出 "11 1"
 *   cclang1600      x86-64 clang 16.0.0          ✗ undefined 'sqrt'       ✗ undefined 'sqrt'
 *
 * g132 能链上 libm 只因为它是 **C++ 前端**（libstdc++ 把 libm 顺带带了进来），代价是学生合法的
 * C 写法会被判成编译错误。构建期只有 2 份「C++ 也能编译的 C」参考实现走这条支路，所以没暴露；
 * 线上判分面对的是学生现场写的任意 C，这个代价不能接受。故改选 cicc191：
 * 它既在 Godbolt 的 **C 编译器列表**里（lang=c 名副其实），又能链上 libm。
 * 输出与构建期取证一致（tmp/probe-libm5.mjs：cr-001 与 pg-005 的 4 组用例在 cicc191 下全部 MATCH）。
 *
 * 构建期 scripts/judge-verify.ts 现在也从本文件取 MATH_COMPILER / needsMathLib，
 * 两边不再各写一份而漂移（AGENTS.md「同一口径只允许有一份」）。
 *
 * ── 为什么后端 id 必须与 'godbolt' 不同 ──────────────────────────────────
 * client.ts 的结果缓存键是 cacheKey(backend.id, req)、跨标签页互斥锁名是 `judge:${backend.id}`，
 * 两者都只看 id。两条支路共用 'godbolt' 会让「同一份源码在不同编译器下跑出的结果」互相顶掉。
 */
import { judge } from '../app/config'
import { getBackend } from './index'
import { createGodboltBackend } from './backends/godbolt'
import type { JudgeBackend } from './types'

/** libm 支路的编译器 id（实测依据见文件头表格，勿凭感觉改） */
export const MATH_COMPILER = judge.godboltMathCompiler

/** libm 支路的后端 id，必须与默认后端不同，理由见文件头最后一节 */
export const MATH_BACKEND_ID = 'godbolt-math'

/**
 * 需要 libm 的数学函数。口径与构建期 judge-verify.ts 原本那份完全一致（现在两边共用这一份）。
 * \b 是必要的：sscanf / exp 之外的自定义 expValue() 之类不该被误命中。
 */
const MATH_LIB_RE =
  /\b(sqrt|pow|sin|cos|tan|asin|acos|atan|atan2|log|log10|exp|fabs|floor|ceil|fmod|hypot|sinh|cosh|tanh)\s*\(/

export function needsMathLib(code: string): boolean {
  return MATH_LIB_RE.test(code)
}

let mathBackend: JudgeBackend | null = null

/** libm 支路后端单例：与默认后端共享 config 里的并发/节流/超时实测参数，只换编译器与 id */
export function getMathBackend(): JudgeBackend {
  mathBackend ??= createGodboltBackend({ id: MATH_BACKEND_ID, compiler: MATH_COMPILER })
  return mathBackend
}

/**
 * 按源码挑后端。判分逻辑一行都不动 —— 这里只决定「这份代码交给哪个编译器」，
 * 事实分类、串行队列、软超时、降级路径全部仍是 client.ts / godbolt.ts 原有的那一份。
 *
 * 现役后端不是 godbolt 时**不分流**：单测/联调经 registerBackend 注入的替身必须拿到全部题目，
 * 否则「含 sqrt 的题」会绕过替身真打网络（也会让离线验收脚本悄悄产生外网请求）。
 */
export function backendForCode(code: string): JudgeBackend {
  const active = getBackend()
  if (active.id !== 'godbolt' || !needsMathLib(code)) return active
  return getMathBackend()
}

/** 渲染器用它给 JudgeClient 分桶：同一条支路复用一个 client（结果缓存才有意义） */
export function backendIdForCode(code: string): string {
  return backendForCode(code).id
}