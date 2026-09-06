# ADR-0001 · 在线编译后端选型：Godbolt Compiler Explorer

- 状态：**已接受**
- 日期：2026-09-06
- 决策：用户（裁决一）；阶段 0 spike 执行与取证：Codex
- 关联条款：`AGENTS.md` 二·5（编译引擎）/ 二·7（实机验证）、`00_任务书.md` 第二节、`05_教材代码风格约定.md`

---

## 1. 背景

硬性约束 5 指定编译引擎为 **Piston 公共 API**（`POST https://emkc.org/api/v2/piston/execute`，免 key，5 次/秒）。
2026-09-06 实测：该端点自 **2026-02-15** 起改为**白名单制**，匿名调用一律 401（证据见 4.0）。
因此"约束 5 用 Piston"与"约束 7 所有代码题必须实机验证"已**无法按原文同时成立**，必须选型替代。

## 2. 决策

1. **网站在线编译/判分**：Godbolt **Compiler Explorer REST API**，浏览器直连，无需任何 key。
   - 端点 `POST https://godbolt.org/api/compiler/<id>/compile`，`<id>` 默认 `cg132`（GCC 13.2 x86-64），`lang: "c"`。
2. **构建期批量验证**（写入 `verified: true`）：走同一 API，**离线脚本串行慢跑**（`scripts/judge-verify.ts`），可接受耗时。
3. **保留抽象层**：`JudgeBackend` 接口 + `GodboltAdapter`（现役）+ `PistonAdapter`（休眠保留）+ `Judge0Adapter`（占位）。切换只换适配器，不改上层判分逻辑。
4. **降级模式为强制交付项**（不是可选优化）：后端不可用时读构建期预存的真实 stdout 供学生自评，站点不瘫。

## 3. 被否决的方案及理由

| 方案 | 结论 | 理由 |
|---|---|---|
| B 自建 Piston 实例 | **否决** | 项目要开源到 GitHub 供他人访问与 fork。① 访客请求全部打到个人 VPS，需 7×24 运维；② fork 者必须自建服务器才能用，等于白开源；③ 单机停机则全站编译功能失效。与项目目标直接冲突。 |
| E 双轨（在线 Godbolt + 判分自建） | **否决** | 同上，判分链路仍绑定个人服务器，开源可用性不成立。 |
| A 申请 Piston 白名单 | **暂不采用**，保留为将来选项 | 资格与审批周期不确定；白名单通常配套要求服务端调用，浏览器直连仍可能被 CORS 拦。若将来获批，仅需把 `VITE_JUDGE_BACKEND` 切回 `piston`。 |
| C Judge0 | **否决**，仅保留适配器 | 公共实例多已下线；RapidAPI 版需 key，key 放进浏览器 = 配额可被盗刷。 |
| D 纯预存 expected + 学生自评 | **否决**为主方案 | 牺牲核心交互体验；仅作为降级模式实现。 |
| Wandbox | 不采用 | 实测 504 网关超时（重试后仍不稳定），且无执行结果的稳定契约。 |
## 4. 阶段 0 Spike 证据

探测环境：Windows / curl 与 PowerShell `Invoke-WebRequest`，编译器 `cg132`，`lang=c`，`userArguments="-std=c99 -Wall -Wextra"`。

**关键前提**：必须同时开启 `options.compilerOptions.executorRequest = true` **与** `options.filters.execute = true`，否则只返回汇编、不执行。缺任一开关是初次探测失败的原因（第一次探测拿到的是 `.LC0: .string "%d %d"` 这样的汇编文本，无 `execResult`）。

### 4.0 前置事实：Piston 已白名单化

```
POST https://emkc.org/api/v2/piston/execute   -> HTTP 401
{"message":"Public Piston API is now whitelist only as of 2/15/2026. Please host your own instance
 or go here and read the \"Important Note\" to see if you qualify for whitelisting:
 https://github.com/engineer-man/piston#public-api"}

（GET https://emkc.org/api/v2/piston/runtimes 仍返回 200，说明仅 execute 被门控）
```

### 4.1 Q1 能否拿到运行时 stdout（而非编译产物/汇编）—— **能**

`scanf` 读两数求和并两行输出的程序，真实响应片段：

```json
{"code":0,"okToCache":true,"timedOut":false,
 "stdout":[{"text":"5"},{"text":"second line"}],"stderr":[],
 "truncated":false,"execTime":20,"processExecutionResultTime":0.02262699604034424,
 "didExecute":true,
 "buildResult":{"code":0,"execTime":61,
   "executableFilename":"/nosym/tmp/compiler-explorer-compilerYnOcUs/output.s",
   "compilationOptions":["-g","-o","/app/output.s","-fno-verbose-asm",
     "-fdiagnostics-color=always","-std=c99","-Wall","-Wextra","/app/example.c"]}}
```

契约要点：
- **运行时输出在顶层 `stdout`**，类型是 `Array<{text}>`，**每元素一行且不含行尾换行符** → 需 `join("\n")` 还原。
- 编译阶段输出在 `buildResult.stdout` / `buildResult.stderr`；`executorRequest` 模式下不回传 `asm`。

### 4.2 Q2 能否传 stdin 供 `scanf` 读取 —— **能**

`options.executeParameters.stdin = "2 3"`，程序 `scanf("%d %d", &a, &b)` → `stdout = [{"text":"5"}]`。
多组输入用 `while (scanf(...) == 2)` 循环读取同样正常（三组分别得 5 / 30 / 300，全部正确）。
### 4.3 Q3 实测限流是多少 QPS —— **不存在"第 N 次开始被拒"；Godbolt 是排队而非限流，加大并发只会更慢**

| 测试 | 结果 |
|---|---|
| 20 次背靠背**串行**（真实编译+执行，`bypassCache=1`） | **20/20 HTTP 200，0 次被拒**；平均 733ms（min 479 / max 1684）；有效速率 **1.36 QPS** |
| 20 次**并发**突发（`ThrottleLimit=20`） | **20/20 HTTP 200，0 次 429**；但单请求耗时恶化到 **22,023ms ~ 38,189ms**；聚合速率跌到 **0.52 QPS** |
| 累计约 120 次请求（含前序探测） | 无 401/403/429，无非 200 响应，无 `Retry-After` / `X-RateLimit-*` 响应头 |

官方 `docs/API.md` 原文（L8–L10）：

> "At a later date there may be some form of rate-limiting: currently, requests will be queued and
> dealt with the same way interactive requests are done for the main site. Authentication might be
> required at some point in the future (for the main **Compiler Explorer** site anyway)."

**对设计的修正（重要）**：原"5 次/秒令牌桶"是为 Piston 定的。Godbolt 上**并发越高、完成速率越低**（1.36 → 0.52 QPS），
所以正确策略不是"允许 5 并发"，而是：

- `maxConcurrency = 2`（留 1 个余量，避免单个慢请求把队列钉死），**严禁放大并发**；
- FIFO + 优先级队列（交互判分 > 示例运行 > 批量预取）；批量验证脚本一律串行，每请求间隔 ≥ 250ms；
- 跨标签页用 `navigator.locks.request('judge:godbolt')` 共享同一并发额度；
- **不设 `bypassCache`**：同源码 + 不同 stdin 会复用编译缓存（实测第 3 组 597ms < 第 1 组 907ms），
  所以"多组测试用例 = 依次提多个执行请求"是廉价的，不必强行合并成一次请求（这点与 Piston 设计相反）；
- 单请求软超时 20s（排队场景要给足余量），超时即降级提示，**不重试**；
- UI 必须显示"排队中 / 第 N 位 / 已等待 X 秒"，因为 P95 延迟约 1s、偶发 1.7s。

### 4.4 Q4 编译错误信息的字段结构

编译失败：`HTTP 200`，顶层 `code = -1`、`didExecute = false`、`stdout = []`、顶层 `stderr = [{"text":"Build failed"}]`。
**真实诊断在 `buildResult.stderr`**，元素为 `{ text, tag? }`，只有"可定位条目"带 `tag`：

```
tag = { line: number, column: number, severity: number, file: string, text: string }
实测 severity：2 = warning，3 = error
```

真实片段（已去 ANSI 转义）：

```
[0] <source>: In function 'main':                             -> tag: (none)
[1] <source>:2:25: error: expected expression before ';' token -> tag: line=2 col=25 severity=3 file=example.c
[2]     2 | int main(void){ int x = ; printf("%d", x ) ; ...   -> tag: (none)   ← 源码回显
[3]       |                         ^                         -> tag: (none)   ← 插入符行
[4] <source>:2:54: error: expected ';' before '}' token        -> tag: line=2 col=54 severity=3
```

- 不带 `tag` 的条目是源码回显与 `^~~` 指示行：**只用于人类可读展示，不用于定位**。
- `text` 内含 ANSI 颜色转义（`\x1b[01m`、`\x1b[K` 等），**必须正则剥离**后再展示。
- 编译成功但有警告：顶层 `code = 0`，警告同样落在 `buildResult.stderr`，`tag.severity = 2`，实测例：
  `[-Wformat=] line=2 col=51`、`[-Wunused-variable] line=2 col=21`。
- `buildResult.stdout` 实测为空，gcc 诊断一律走 `buildResult.stderr`。
- 结论：**CodeMirror Lint 诊断可直接用 `tag.line / tag.column / tag.severity` 生成**，不必自己解析文本。
### 4.5 判分器还必须知道的 4 件事

| 场景 | 实测响应 |
|---|---|
| 运行时错误（空指针写） | `code = 139`，`didExecute = true`，`stdout = []`，`stderr = [{"text":"Program terminated with signal SIGSEGV (11)"}]` |
| 非零退出码 | `code = 7`，程序自己的 `stderr` 原样回传（`[{"text":"oops"}]`） |
| 死循环 TLE | **`code = -1`（与编译失败同值！）**，`timedOut = true`，`didExecute = true`，`stderr = [{"text":"Please refer to https://doc.godbolt.org on how to use Compiler Explorer."}]`（该文案与超时无关，属通用提示，不可作为判据） |
| 真实 DS 程序（`malloc`/`free` 头插法链表 + 读 stdin） | `ds1` 正常，`stdout = ["3 2 1 "]`，与预期一致 |

> ⚠ **最关键的坑**：顶层 `code = -1` 同时表示"编译失败"与"运行超时"。
> 判分器 `errorClass` 必须按下列顺序判定，**不得先看顶层 `code`**：
>
> ```
> buildResult.code != 0            -> compile-error
> else timedOut                    -> timeout (TLE)
> else code != 0                   -> runtime-error
> else truncated                   -> truncated-output（不自动判 WA，转自评）
> else 比对归一化 stdout            -> accepted | wrong-answer
> ```

响应头含 `Access-Control-Allow-Origin: *` 与
`Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept` → 浏览器直连可行
（注意：只允许这几个头，自定义头会被 CORS 预检拒绝）。

## 5. 接口契约

```ts
export interface CompileRequest {
  code: string; stdin?: string; userArguments?: string; timeoutMs?: number
}
export interface Diagnostic { line: number; column: number; severity: 2 | 3; text: string }
export type JudgeErrorClass =
  | 'none' | 'compile-error' | 'runtime-error' | 'timeout'
  | 'truncated-output' | 'network' | 'backend-unavailable' | 'bad-request'
export interface CompileResult {
  ok: boolean
  runStdout: string; runStderr: string           // 已 join("\n") 且剥离 ANSI
  diagnostics: Diagnostic[]                      // 来自 buildResult.stderr[].tag
  warnings: Diagnostic[]; errors: Diagnostic[]   // 按 severity 分组
  exitCode: number | null
  errorClass: JudgeErrorClass
  compileTimeMs: number; runTimeMs: number
  raw?: unknown
  meta: { queueMs: number; retried: number; cached: boolean; backend: string }
}
export interface JudgeBackend {
  readonly id: string
  readonly maxConcurrency: number   // godbolt: 2（依据 4.3） | piston: 1 | judge0: 2
  readonly minIntervalMs: number    // godbolt: 250
  readonly timeoutMs: number        // godbolt: 20000
  readonly supportsWarnings: boolean
  execute(req: CompileRequest, signal: AbortSignal): Promise<CompileResult>
  probe(signal: AbortSignal): Promise<BackendHealth>
}
```

- 实现：`GodboltAdapter`（现役）、`PistonAdapter`（休眠保留，含 5 次/秒令牌桶原设计）、`Judge0Adapter`（占位）。
- 装配：`createJudgeBackend(import.meta.env.VITE_JUDGE_BACKEND ?? "godbolt")`。
- **`verified: true` 只能由 `scripts/judge-verify.ts` 写入**，同时把真实 stdout 存档进
  `public/data/problems/verification-report.json`，形成"即使后端下线也可复核"的证据链。
- **输出比对归一化**（配合裁决二第 2 条，`expected` 一律不写末尾换行）：
  CRLF/CR → LF → 每行行尾空白剥离 → **整体末尾所有换行剥离** → 逐行比对。
## 6. 与硬性约束的合规性声明

| 约束 | 状态 | 说明 |
|---|---|---|
| 1 纯静态、无后端 | ✅ 满足 | Godbolt 是第三方公共服务，浏览器直连；本站不含任何服务端代码，仍可 GitHub Pages 部署 |
| 2 不得引入需服务端运行时的方案 | ✅ 满足 | 不引入自建后端；仅"依赖外部公共 HTTP API"，与原 Piston 方案同性质 |
| 3 localStorage 存进度 | ✅ 不受影响 | — |
| 4 JSON 分片 + 索引懒加载 | ✅ 不受影响 | — |
| 5 Piston + 5 次/秒 + 预留 Judge0 接口 | ⚠ **部分偏离**（本 ADR 即偏离的正式记录） | 引擎 Piston → Godbolt（Piston 已白名单化）；"5 次/秒"以"并发 ≤ 2 + 排队 + 250ms 间隔"落实（实测依据 4.3，且实测证明高并发反而降低吞吐）；**Piston/Judge0 切换接口照样保留**，该子句完整满足 |
| 6 标准 C | ✅ 满足 | `-std=c99 -Wall -Wextra`；另有 `scripts/lint-code.ts` 静态扫非法构造 |
| 7 实机验证后才可 `verified: true` | ✅ 满足 | 由 `judge-verify.ts` 真实编译 + 执行 + 比对 `expected` 后写入 |

## 7. 残留风险与缓解

1. **公共实例无 SLA，官方明说将来可能要求鉴权** → 降级模式强制实现；构建期预存 stdout 存档；适配器可换。
2. **学生代码被发送到第三方公共服务** → UI 明示"代码将发送至 godbolt.org 编译"；只提交源码与 stdin，不提交任何个人信息。
3. **`truncated = true` 输出被截断** → 判为 `truncated-output`，不自动判 WA，转"参考输出 + 自评"。
4. **编译器 id 漂移（`cg132` 下线）** → 启动时 `GET /api/languages` / `GET /api/compilers/c` 校验，失败回落到清单中首个 gcc；CI 每日跑一次 `probe()` 并在失败时告警。
5. **Godbolt 服务端排队导致高峰体验劣化** → 并发上限 2 + 排队可视化 + 结果缓存（`sha1(source + stdin)`，命中即 0 请求）。
6. **单文件为主**（本项目全部题目均为单文件，够用）；确需多文件时用 `files: [{ filename, contents }]`（官方文档已确认支持；`#include <https://…>` 形式出于安全被禁）。

## 8. 复审触发条件

- Godbolt 引入鉴权 / 明确限流且低于本站用量 → 回到第 3 节重新评估方案 A（申请白名单）。
- 用户获批 Piston 公共 API 白名单 → 切回 `PistonAdapter`，仅需同步修订限流参数（回到 5 次/秒令牌桶）。
- 出现 ≥ 1 次因后端导致的**大面积判分错误** → 强制评估。
