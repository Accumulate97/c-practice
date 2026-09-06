/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 编译后端：godbolt（默认）| piston（休眠）| judge0（占位） */
  readonly VITE_JUDGE_BACKEND?: string
  /** Godbolt 编译器 id，默认 cg132（GCC 13.2 x86-64） */
  readonly VITE_GODBOLT_COMPILER?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}