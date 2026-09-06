/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 编译后端：当前仅 godbolt 可用。piston/judge0 未实现，原因与扩展方法见 src/judge/index.ts */
  readonly VITE_JUDGE_BACKEND?: string
  /** Godbolt 编译器 id，默认 cg132（GCC 13.2 x86-64） */
  readonly VITE_GODBOLT_COMPILER?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}