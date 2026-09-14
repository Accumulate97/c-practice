/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 编译后端：当前仅 godbolt 可用。piston/judge0 未实现，原因与扩展方法见 src/judge/index.ts */
  readonly VITE_JUDGE_BACKEND?: string
  /** Godbolt 编译器 id，默认 cg132（GCC 13.2 x86-64） */
  readonly VITE_GODBOLT_COMPILER?: string
  /** 容灾总开关，填 off 关闭梯队（ADR-0002），缺省开启 */
  readonly VITE_JUDGE_FAILOVER?: string
  /** 容灾梯队：逗号分隔的 Godbolt 编译器 id，缺省 cg142,cg131；填空串等于关掉梯队 */
  readonly VITE_GODBOLT_FAILOVER?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}