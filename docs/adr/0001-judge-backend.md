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
3. **保留抽象层，但不保留死代码**：`JudgeBackend` 契约（`src/judge/types.ts`）+ `GodboltAdapter`（唯一现役实现）。原计划的 `PistonAdapter`（休眠）与 `Judge0Adapter`（占位）经 2026-09-06 阶段 2 裁决**删除** —— Piston 公共 API 已白名单化（4.0 实测 401），Judge0 需 API key 而纯静态站只能把 key 打进 bundle（等于公开泄露），此刻写它们必然是无法验证的死代码。切换成本改由「契约 + 注册处注释」承担：`src/judge/index.ts::getBackend()` 顶部写明新增后端要实现哪些成员、如何注册。上层判分逻辑不随适配器改变。
4. **降级模式为强制交付项**（不是可选优化）：后端不可用时读构建期预存的真实 stdout 供学生自评，站点不瘫。

## 3. 被否决的方案及理由

| 方案 | 结论 | 理由 |
|---|---|---|
| B 自建 Piston 实例 | **否决** | 项目要开源到 GitHub 供他人访问与 fork。① 访客请求全部打到个人 VPS，需 7×24 运维；② fork 者必须自建服务器才能用，等于白开源；③ 单机停机则全站编译功能失效。与项目目标直接冲突。 |
| E 双轨（在线 Godbolt + 判分自建） | **否决** | 同上，判分链路仍绑定个人服务器，开源可用性不成立。 |
| A 申请 Piston 白名单 | **暂不采用**，保留为将来选项 | 资格与审批周期不确定；白名单通常配套要求服务端调用，浏览器直连仍可能被 CORS 拦。若将来获批，需按第 5 节契约**重新实现** `PistonAdapter` 并在 `src/judge/index.ts` 注册（原休眠实现已删除），再把 `VITE_JUDGE_BACKEND` 设为 `piston`。 |
| C Judge0 | **否决**，连适配器也不写 | 公共实例多已下线；RapidAPI 版需 key，key 放进浏览器 = 配额可被盗刷，且纯静态站无法隐藏。 |
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
- FIFO + 优先级队列（交互判分 > 示例运行 > 批量预取）；批量验证脚本一律串行，每请求间隔 ≥ 100ms
  （阶段 3 依用户裁决三第 3 条由 250 降为 100：批量路径单请求本就 300–2700ms，节流用不上；
  但前端缓存命中约 10ms、学生连点「编译并运行」时它会立刻生效，保留的成本为零）；
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
// src/judge/types.ts —— 以下为实际落地（as-built）契约，不是草案
export interface RunRequest {
  code: string; stdin: string            // 无输入传空串，不传 undefined
  userArguments?: string; compileOnly?: boolean
}
export interface CompileDiag {
  line: number; column: number           // 均 1 起，列未知为 0
  severity: 'warning' | 'error'; message: string
}
/** 后端只描述事实，不判对错；比对 expected 在 client.ts */
export interface ExecutionResult {
  errorClass: 'ok' | 'compile-error' | 'runtime-error' | 'timeout' | 'truncated'
  compiled: boolean; exitCode: number
  stdout: string; stderr: string         // 已 join / 剥 ANSI / 归一化
  diagnostics: CompileDiag[]; compilerMessage: string
  execTimeMs?: number; raw?: unknown
}
export class JudgeTransportError extends Error {
  kind: 'network' | 'busy' | 'quota' | 'backend-auth'; retryable: boolean; status?: number
}
/** 新增后端 = 4 个只读配置 + 1 个方法 */
export interface JudgeBackend {
  readonly id: string
  readonly maxConcurrency: number   // godbolt: 2（依据 4.3，更高反而降低吞吐）
  readonly minIntervalMs: number    // godbolt: 100
  readonly timeoutMs: number        // godbolt: 25000（必须 > Godbolt 公共实例自身 ~20s 执行时限，见 9.4）
  execute(req: RunRequest): Promise<ExecutionResult>
}
```

**与早期草案的差异（草案字段从未实现，已从本文档删除）**：`CompileRequest` / `CompileResult` /
`Diagnostic` / `JudgeErrorClass` / `supportsWarnings` / `probe()` 全部去掉。理由：
- 判分结论（`accepted` / `wrong-answer` / `degraded` …）不属于适配器，由 `client.ts` 拿归一化后的
  stdout 与 `expected` 比对产出（`JudgeResponse.state`），后端契约里不再重复表达；
- `supportsWarnings` 恒为真，无信息量；`probe()` 健康检查（见 7.4）未随阶段 2 交付，列为阶段 3+ 可选；
- Godbolt 把「编译失败」与「运行超时」都压成顶层 `code = -1`，适配器按 `buildResult.code != 0 →
  compile-error` 优先、再 `timedOut → timeout` 的顺序区分（见 4.5）；
- 传输层故障归类：`401/403 → backend-auth`（不可重试）、`429 → quota`（退避后重试）、
  `5xx / 网络 / 超时 → busy / network`（可重试）。学生代码写错**不是**故障，一律走 `errorClass`，不得抛异常。

- 实现：只有 `GodboltAdapter`（`src/judge/backends/godbolt.ts`）。`PistonAdapter` / `Judge0Adapter` 已删除，理由见第 2 节第 3 条。
- 队列 / 缓存 / 重试 / 降级 / 跨标签页锁**全部在 `src/judge/client.ts`**，适配器不得复制一份：FIFO +
  优先级队列、`maxConcurrency` + `minIntervalMs`（原「5 次/秒令牌桶」的意图由这两个参数共同表达）、
  结果缓存（键 = 后端 id + 归一化源码 + stdin，fnv1a）、失败退避 `800ms × n` 与后端 30s 冷却、
  `navigator.locks` 跨标签共享并发额度、后端不可用时读构建期预存 stdout 自评。
- 装配：`src/judge/index.ts` 的 `BACKENDS` 注册表 + `getBackend()`（读 `config.judge.backend`，未知取值
  回落 godbolt 并 `console.warn`）+ `registerBackend()`（单测注入替身）+ `availableBackends()`。
- **`verified: true` 只能由 `scripts/judge-verify.ts` 写入**（**阶段 3 已交付**：`npm run judge:verify`；
  `scripts/` 现有 `build-index.ts` / `verify-data.ts` / `lint-code.ts` / `judge-verify.ts`，另有 `verify-pages-dist.mjs`），
  同时把真实 stdout 与逐请求耗时存档进 `public/data/problems/verification-report.json`，
  形成「即使后端下线也可复核」的证据链；`verify-data.ts` 另有 `VERIFIED-NO-PROOF` 反向核查
  「报告里查无实机记录的 `verified: true`」——翻标记与留证据必须同时发生。
- **输出比对归一化**（配合裁决二第 2 条，`expected` 一律不写末尾换行）：CRLF/CR → LF → 每行行尾空白
  剥离 → 整体末尾所有换行剥离 → 逐行比对。实现于 `src/judge/backends/base.ts`，是唯一一份归一化代码，
  页面与题目数据都不得自行 trim。

## 6. 与硬性约束的合规性声明

| 约束 | 状态 | 说明 |
|---|---|---|
| 1 纯静态、无后端 | ✅ 满足 | Godbolt 是第三方公共服务，浏览器直连；本站不含任何服务端代码，仍可 GitHub Pages 部署 |
| 2 不得引入需服务端运行时的方案 | ✅ 满足 | 不引入自建后端；仅"依赖外部公共 HTTP API"，与原 Piston 方案同性质 |
| 3 localStorage 存进度 | ✅ 不受影响 | — |
| 4 JSON 分片 + 索引懒加载 | ✅ 不受影响 | — |
| 5 Piston + 5 次/秒 + 预留 Judge0 接口 | ⚠ **部分偏离**（本 ADR 即偏离的正式记录） | 引擎 Piston → Godbolt（Piston 已白名单化）；"5 次/秒"以"并发 ≤ 2 + FIFO 排队 + 100ms 最小间隔"落实（实测依据 4.3 与 9.3：串行 4 组实际 ≈ 1.2 请求/秒，且高并发反而降低吞吐）；抽象层（`JudgeBackend` 契约 + 集中式 client）保留，但 `PistonAdapter` / `Judge0Adapter` 两份实现已删除，将来切换后端需按第 5 节契约补写 —— 这是对该子句字面要求的**诚实偏离**，经用户 2026-09-06 阶段 2 裁决批准 |
| 6 标准 C | ✅ 满足 | `-std=c99 -Wall -Wextra`；另有 `scripts/lint-code.ts` 静态扫非法构造 —— **阶段 3 已交付**：`npm run lint:code` 扫 22 处代码段 0 命中；`--self-test` 19 条对照（9 条必抓 + 10 条不得误报）全过；`--all` 能抓到 05 里故意写错的反例，证明规则集不是空转 |
| 7 实机验证后才可 `verified: true` | ✅ 已满足（引擎为 Godbolt） | 由 `scripts/judge-verify.ts` 真实编译 + 执行 + 比对 `expected` 后才写 `verified`；3 道种子题 + 04 的 5 道代码样例全绿（18 个请求），逐请求耗时与真实 stdout 存档见第 10 节 |

## 7. 残留风险与缓解

1. **公共实例无 SLA，官方明说将来可能要求鉴权** → 降级模式强制实现；构建期预存 stdout 存档；适配器可换。
2. **学生代码被发送到第三方公共服务** → UI 明示"代码将发送至 godbolt.org 编译"；只提交源码与 stdin，不提交任何个人信息。
3. **`truncated = true` 输出被截断** → 判为 `truncated-output`，不自动判 WA，转"参考输出 + 自评"。
4. **编译器 id 漂移（`cg132` 下线）** → 启动时 `GET /api/languages` / `GET /api/compilers/c` 校验，失败回落到清单中首个 gcc；CI 每日跑一次 `probe()` 并在失败时告警。
5. **Godbolt 服务端排队导致高峰体验劣化** → 并发上限 2 + 排队可视化 + 结果缓存（`fnv1a(backendId + compiler + args + code + stdin)`，命中即 0 请求，9.3 实测第二次批跑 10ms / 0 网络请求）。
6. **单文件为主**（本项目全部题目均为单文件，够用）；确需多文件时用 `files: [{ filename, contents }]`（官方文档已确认支持；`#include <https://…>` 形式出于安全被禁）。

## 8. 复审触发条件

- Godbolt 引入鉴权 / 明确限流且低于本站用量 → 回到第 3 节重新评估方案 A（申请白名单）。
- 用户获批 Piston 公共 API 白名单 → 按第 5 节契约**重新实现** `PistonAdapter` 并在 `src/judge/index.ts` 注册（原实现已删除，不存在「切回」），限流参数改回 `maxConcurrency: 5` / `minIntervalMs: 200`。
- 出现 ≥ 1 次因后端导致的**大面积判分错误** → 强制评估。

## 9. 阶段 1 复校与阶段 2 实测记录（2026-09-06）

### 9.1 用完整 Ajv 复校 `04_题型规范与样例.md` 的**全部**样例

前一轮只跑了 id 的 pattern 正则，那不叫校验。本轮以 `schema/Problem.schema.json` 为唯一真源，
用 `ajv@8` + `ajv-formats@3`（draft 2020-12、`strict: false`、递归编译 `$defs`）对 04 里**每一个**
json 代码块做完整校验。校验脚本是临时件（`%TEMP%\ajv_check.mjs`），未入库 —— 入库版属阶段 3 的
`scripts/`，本轮不提前交付。

| # | 04 行号 | type | id | category | difficulty | bloom | verified | 结果 |
|---|---|---|---|---|---|---|---|---|
| 1 | 55–86 | code_completion | c-ch09-cc-001 | "c" | 3 | apply | false | ✓ PASS（无未定义字段） |
| 2 | 112–133 | debug | c-ch09-dbg-001 | "c" | 3 | analyze | false | ✓ PASS |
| 3 | 159–175 | code_reading | c-ch09-cr-001 | "c" | 3 | analyze | false | ✓ PASS |
| 4 | 192–216 | programming | c-ch05-pg-001 | "c" | 3 | apply | false | ✓ PASS |
| 5 | 230–252 | single_choice | c-ch09-sc-001 | "c" | 2 | understand | true | ✓ PASS |
| 6 | 257–273 | true_false | c-ch09-tf-001 | "c" | 2 | understand | true | ✓ PASS |
| 7 | 278–310 | fill_blank | ds-ch01-fb-001 | "ds" | 1 | remember | true | ✓ PASS |
| 8 | 315–353 | code_ordering | c-ch05-co-001 | "c" | 2 | apply | true | ✓ PASS |
| 9 | 358–380 | short_answer | ds-ch02-sa-001 | "ds" | 3 | analyze | true | ✓ PASS |
| 10 | 385–403 | complexity | ds-ch01-cx-001 | "ds" | 3 | analyze | true | ✓ PASS |
| 11 | 408–445 | matching | ds-ch03-mt-001 | "ds" | 1 | remember | true | ✓ PASS |

合计 11 个 json 代码块：**通过 11 / 失败 0**。

负例对照（证明校验器不是空转，每例都是人为破坏后重跑）：

| 人为破坏 | Ajv 结论 |
|---|---|
| `category: "C"`（大写） | ✗ must be equal to constant（枚举只允许 `"c"` / `"ds"`） |
| 删掉 `category` | ✗ must have required property 'category' |
| `difficulty: 6` | ✗ must be <= 5 |
| `difficulty: "apply"`（把 bloom 的值填进 difficulty） | ✗ must be integer |
| `id` 去掉 `c-` / `ds-` 前缀 | ✗ must match pattern `^[cd]s?-ch[0-9]{2}-(cc\|dbg\|cr\|pg\|sc\|tf\|fb\|co\|sa\|cx\|mt)-[0-9]{3}$` |
| **加一个 schema 里不存在的 `score` 字段** | **✓ 反而通过** |
| **`expected` 末尾多写一个换行** | **✓ 反而通过** |

⇒ **遗留问题（待用户裁决）**：`Problem.schema.json` 顶层与 11 个 `allOf` 分支**都没有
`additionalProperties: false`**，所以"schema 没定义就不许出现"这条纪律 Ajv 兜不住。本轮由校验脚本
另外手工比对已定义字段（上表"无未定义字段"即此项），并用 grep 确认 04 中 `score` 出现 0 次、
`"category"` 11 处全小写、`"difficulty"` 取值仅 1/2/3。末尾换行不由 schema 表达，属归一化规则，
落在 `src/judge/backends/base.ts`。是否给 schema 补 `additionalProperties: false` 不擅动。

04 的真实改动（`git diff --stat`：+200 / −13）：第六节原为 4 个残缺片段，补成 7 个完整样例；
新增 id `c-ch09-sc-001` `c-ch09-tf-001` `ds-ch01-fb-001` `c-ch05-co-001` `ds-ch02-sa-001`
`ds-ch01-cx-001` `ds-ch03-mt-001`；统一 category 小写、difficulty 改为 1–5 整数、删除 schema 里没有的
`score`；错字"主力气型"→"主力题型"；`code_ordering` 的判分口径改为指向本 ADR 的归一化规则；
开头补两条全局规则（id 必须带 `c-` / `ds-` 前缀且必须含 category；`expected` 不写末尾换行 + 判分侧归一化）。
澄清：`score` / 大写 category / bloom 混进 difficulty 这三处在 HEAD `b202cb5` 时就已修好，本轮补的是
「完整 Ajv 复校证据」而不是重复修改。

### 9.2 4 道主力代码题的 Godbolt 真跑（构建期验证口径）

| 样例 id | 送验字段 | stdin | 归一化后 stdout | HTTP / exitCode | 与 expected 一致 | 单请求耗时 |
|---|---|---|---|---|---|---|
| c-ch09-cc-001 | solution_code | `5` | `5 4 3 2 1` | 200 / 0 | true | 964ms |
| c-ch09-dbg-001 | fixed_code | — | `a=5, b=3` | 200 / 0 | true | 756ms |
| c-ch09-cr-001 | code | — | `1 2 3` | 200 / 0 | true | 699ms |
| c-ch05-co-001 | 按正序合并后的完整源码 | `100` | `5050` | 200 / 0 | true | 897ms |

04 里的 `verified` 仍保持 `false`：按第 5 节纪律，置 `true` 只能由阶段 3 的 `scripts/judge-verify.ts`
在写入数据文件的同时存档真实 stdout，本轮不手改题目数据。

> **后续（阶段 3，2026-09-06）**：这条纪律已落地。`judge-verify.ts --doc04` 把 04 的 4 道主力代码题
> `verified` **定点改写**为 `true`（`git diff -- 04_*` 只有 4 行，无格式化噪声），证据见第 10 节。

### 9.3 一道编程题 × 4 组用例「串行」端到端实测

按用户要求**不使用并发**（4.3：并发 20 时完成速率从 1.36 QPS 跌到 0.52 QPS）。被测路径：
JudgeLab 的「4 组用例串行 + 耗时报告」按钮 → `JudgeClient.runTests(code, 4 组用例, onProgress)`
→ 4 次 `godbolt.execute`（`c-ch05-pg-001` 参考程序 × 4 组用例）。

测量方式：headless Edge + CDP，用 `Input.dispatchMouseEvent` 派发**真实鼠标事件**（走命中测试，
不是 `.click()` 合成调用），在页面里包一层 `fetch` 记录每个请求的起止与 HTTP 状态，轮询到报告出现为止。
2026-09-06 本轮三次独立**冷跑**（每次新开标签页，缓存为空）：

| 运行 | 页面自报各请求耗时 (ms) | 总耗时 | fetch 层实测 (ms) | 状态码 | 通过 | 缓存命中 |
|---|---|---|---|---|---|---|
| 冷跑 A | 1167 / 869 / 868 / 723 | **3627 ms** | 1151 / 865 / 865 / 719 | 200×4 | 4/4 | 0 |
| 冷跑 B | 991 / 860 / 304 / 706 | **2861 ms** | 973 / 854 / 300 / 702 | 200×4 | 4/4 | 0 |
| 冷跑 C | 648 / 876 / 875 / 691 | **3090 ms** | 631 / 873 / 871 / 688 | 200×4 | 4/4 | 0 |

三次区间 **2861–3627 ms**，均值 ≈ 3193 ms，最坏 3627 ms。每次都是**恰好 4 条**
`POST https://godbolt.org/api/compiler/cg132/compile`，无重试、无 `Runtime.exceptionThrown`。
页面自报比 fetch 层多 12–17ms，即 React 渲染开销，计时口径可信。

**决策：总耗时 < 5000 ms → 采纳串行方案，刷题页 UI 显示「第 N/M 组」进度。**
`onProgress` 回调时机定在每组**开始执行前**（`client.ts:198`），否则界面会滞后一组显示。

**缓存命中路径**（同一标签页第二次点同一个批跑，实测）：**0 次网络请求**，各组 3 / 3 / 2 / 2 ms，
总耗时 **10 ms**，通过 4/4，缓存命中 4 次。即学生反复提交一份没改过的代码不消耗配额。

**节流核实**：冷跑 C 四次请求起始时刻 2877 → 3511 → 4388 → 5263，扣除上一请求耗时后净间隔 3–5ms。
说明 `minIntervalMs: 250`（阶段 2 当时的配置值，阶段 3 依裁决三第 3 条降为 100）在这条路径上从未产生额外等待（单个请求本身 >250ms），串行 4 组的实际速率
≈ 1.2 请求/秒，远低于 5 次/秒红线；真正起作用的是 `maxConcurrency: 2` + FIFO 队列 + 页面级 `busy` 互斥。

**勘误（务必读）**：本节上一版记录的 2965 / 3729 / 3 / 2170 ms 四个数**不可复现，已整表替换**。
根因是当时的探测脚本把「找按钮」的函数 `JSON.stringify` 成字符串再拼进 `Runtime.evaluate` 表达式，
表达式在页面里抛 `TypeError: b.getBoundingClientRect is not a function`，脚本在**武装监听与点击之前**
就退出了。因此「runBatch 从未执行 / 日志为空」从来不是关于本应用的证据，而是脚本自身的 bug；
应用代码经复核没有该问题。本轮换用真实鼠标事件重测，上表三次数据可重复。

**余量提示**：单请求实测区间 300–1400ms。若 Godbolt 高峰把单请求拖到两倍，总时长约 6–7s，
会越过 5s 采纳线但未越过 8s 上报线。列为待观察项：上线后复测一次。


### 9.4 六种判定状态逐一实测（含两次「假通过」的复盘）

被测路径：JudgeLab 的下拉预设 → 真实鼠标点击「编译并运行」→ 读回页面渲染的判定标题。headless Edge + CDP `Input.dispatchMouseEvent`。

| 行 | 预设 | 页面渲染 | 网络请求 | 端到端 | 结论 |
|---|---|---|---|---|---|
| P1 | ① 参考程序 | ✓ 通过 · 输出正确 | 1 (200) | 1861ms | **有效** |
| P2 | ② 答案不全 | ✗ 输出不符 · 第 3 行与期望不符（实际 `6 28 496` / 期望 `6 28`） | 1 (200) | 773ms | **有效** |
| P3 | ③ 漏分号 | ✗ 编译错误 · `<source>:4:5: error: expected ',' or ';' before 'printf'` + 位置/级别/信息表 | 1 (200) | 959ms | **有效**（结构化诊断可用） |
| P4 | ④ scanf 漏 & | ✗ 运行崩溃 · exit code 139，SIGSEGV(11) | 1 (200) | 1132ms | **有效** |
| P5 | ⑤ 死循环 | ✗ 输出不符 · 实际 `2147483647` | 1 (200) | 4201ms | **假通过——夹具本身错了** |
| D | ① + 勾「模拟后端不可用」 | ✓ 通过 | **0** | 4ms | **假通过——降级根本没触发** |

**P5 根因**：夹具原写作 `while (i < 10) i = i - 1;`，有符号溢出在该编译选项下**回绕**成 `INT_MAX`，
循环正常结束并打印一行，于是被正确判成 wrong-answer——后端从未见过「挂住」的程序，timeout 分类路径**从未被执行**。
换成 `volatile int spin` + `while (1)` 真忙等后（`JudgeLabPage.tsx:77-79`）才真正测到该路径。

**D 根因**：脚本用原生 setter + `dispatchEvent('change')` 设置 `checkbox.checked`，React 19 的受控复选框**没有接收**，
`offline` state 仍是 false → `useMemo` 未重建 client → 仍走 godbolt 并命中实例缓存 → 0 请求还判通过。
更阴的陷阱：脚本自己打印了从 DOM 读回的 `offline=true`，**DOM 的 checked ≠ React 状态**。
改为真实鼠标点击后，点击坐标 `y=-176`（元素在视口外）又落空一次；最终版先 `scrollIntoView` 再校验坐标落在视口内，
并把**页面上的后端标识 `<b>`**（godbolt / offline-sim）当作状态真变的铁证。

**修正后的实测（2026-09-06 17:4x，全绿）**：

| 行 | 场景 | 页面渲染 | 网络请求 | 端到端 |
|---|---|---|---|---|
| S0 | 初始 | 后端标识 = `godbolt` | — | — |
| T1 | 真死循环 | **✗ 运行超时**（「运行超时：检查死循环，或该用例规模是否过大」） | 1 (200) | 1603ms（源码与刚才的 API 探测相同，命中 Godbolt 服务端执行缓存） |
| S2 | 真实点击复选框 | `checked=false → true`，后端标识 `godbolt → offline-sim` | — | — |
| D1 | 降级 + 有预存输出 | **⚠ 降级自评** + 徽标「数据来自构建期预存」+ 不计正确率、不置 verified | **0** | 832ms |
| D2 | 降级 + 无预存输出 | **⚠ 后端不可用**（绝不伪造「通过」） | **0** | 822ms |
| S4 | 再点取消 | 后端标识回到 `godbolt` | — | — |
| R1 | 恢复正常 | ✓ 通过 | 1 (200) | 1341ms |

D1/D2 的 ~830ms 全部是 `network` 类错误的 800ms 退避重试，降级路径本身是瞬时的。
至此「降级模式必须实现」这条硬约束第一次拿到**可复现证据**（0 次网络请求 + 明确的不计正确率文案）。

**由 T1 暴露并修掉的真实缺陷**：`config.judge.timeoutMs` 原为 `20_000`，而 Godbolt 公共实例对挂死程序
**固定在自己的 20 s 时限**（实测 `execTime=20154 / 20357 ms`，`timedOut=true`，`code=143` SIGTERM，
`stderr: Killed - processing time exceeded / Program terminated with signal: SIGKILL`，HTTP 响应约 20.9 s 才回）。
两个 20 s 相撞 → 我方 AbortController 先掐断 → 分类成 `busy` 且**可重试**，于是 1 次死循环提交要等 **40841 ms**
才拿到「⚠ 后端不可用」，`timeout` 判定永远走不到。修复：`timeoutMs: 25_000`（必须 > 后端时限）+ 中止类错误改为
`retryable: !aborted`（`godbolt.ts:98`）。

**顺带否掉一条省时的想法**：`options.executeParameters.timeout` 传 3 秒**不生效**（同一请求 `execTime` 仍是 20154ms，
公共实例忽略该字段）。所以不能靠它压缩死循环等待；短时限只能由我们自己放弃等待，而那会丢掉 `timedOut` 信号——
正确做法就是现在这样：等后端自己回，并把软超时设在 20 s 之上。

**修完后复测 4 组用例串行**（本会话，代码即仓库当前版本）：单请求 **2747 / 337 / 346 / 677 ms**，总 **4107 ms**，
4/4 通过，缓存命中 0，`Runtime.exceptionThrown` 0，页面无 error overlay。仍在 5 s 采纳线内，
与 9.3 三次冷跑（2861 / 3090 / 3627 ms）一致；首请求偏慢是冷编译，后续请求复用同一二进制。

> 复盘要点：本轮两次「假通过」都不是应用逻辑错，而是**测试没有测到它声称测的东西**。
> 因此以后每条判定的验收都必须同时满足：① 状态标签对得上；② 网络请求次数对得上（降级必须是 0）；
> ③ 页面上的后端标识对得上。缺任一条即视为未验证。

---

## 10. 阶段 3 证据：数据闸门与构建期实机验证（2026-09-06）

### 10.1 交付物与「同源」原则

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `scripts/build-index.ts` | 由 `public/data/problems/*.json` 生成 `index.json` 与 `search/problems.json`（另生成 knowledge/viz 空索引） | 产物头部 `_generated: GENERATED —— 禁止手工编辑`；知识卡片与演示尚未开工时也能空跑 |
| `scripts/verify-data.ts` | Ajv 全量校验 + id 唯一 + index↔分片双向一致 + 三向引用不悬空（双向）+ 章节三向一致 | `--self-test` 造 11 个已知坏样本，证明闸门本身有效，而不是「没报错=通过」 |
| `scripts/lint-code.ts` | 硬扫非法 C 构造（引用形参 / new / delete / cin·cout / gets / conio.h·getch / system("pause") / 专有头） | 先剥注释与字符串字面量再匹配；`banned-system` 走原文匹配（注释里的反例仍不算）；`--self-test` 19 条对照 |
| `scripts/judge-verify.ts` | Godbolt 真跑 + `verified` 写回 + 真实 stdout 存档 | 用 Vite `middlewareMode + ssrLoadModule` 加载**应用真正会用的那份** `godbolt.ts` / `base.ts` / `config.ts`，构建期与线上判分口径同源，不会出现两套实现 |

### 10.2 Schema 严格化（用户裁决三第 1 条）

- 已实测：draft-07 根节点直接加 `additionalProperties: false` 会把 `allOf` 分支自己的字段全部判为非法。
- 采纳方案：升级到 **`$schema: 2020-12` + 根节点 `unevaluatedProperties: false`**（分支 `$defs` 仍可自由扩展，只有「任何分支都不认领」的键才被拒）。
- 双向验证都通过才采纳：
  - 正例 —— `node scripts/verify-data.ts --doc04` → `04 样例 Schema 校验：11/11 通过`；
  - 反例 —— `--self-test` 用例「多塞一个 Schema 里没有的 `score: 10`」→ 被 `SCHEMA` 拦下（10.4 第 1 条）。
- 备选方案（Schema 不动、改在 `verify-data.ts` 里做题型字段白名单）**未启用**，无需退回。

### 10.3 Godbolt 实机验证（唯一真源 = 两份 report JSON）

统一口径：`compiler=cg132`、`userArguments="-std=c99 -Wall -Wextra"`、
**`executorRequest: true` + `filters.execute: true` 双执行开关缺一不可**（只给一个就只能拿回汇编/编译产物，
拿不到运行时 stdout）、严格串行、`minIntervalMs=100`、`timeoutMs=25000`。

种子题 —— `public/data/problems/verification-report.json`（3 题 / 9 请求 / 总墙钟 7815ms / 均值 868ms·请求）：

| id | type | 送验字段 | 请求数 | 各请求墙钟 ms | Godbolt 执行 ms | 结论 |
|---|---|---|---|---|---|---|
| c-ch05-cr-001 | code_reading | `answer`（真实 stdout 采纳） | 1 | 322 | 24 | PASS → verified=true |
| c-ch06-cc-001 | code_completion | `solution` × 4 组用例 | 4 | 1095/806/886/994 | 23/27/52/24 | PASS → verified=true |
| ds-ch02-pg-001 | programming | `reference` × 4 组用例 | 4 | 548/779/395/1022 | 20/23/23/24 | PASS → verified=true |

`code_reading` 的 `answer` 采纳流程（硬约束「禁止手推」）：数据里先写占位符 `PENDING-REAL-STDOUT` →
第一遍取回真实 stdout = `"78"`（750ms）→ 隔 `minIntervalMs` 后**独立复跑第二遍** = `"78"`（291ms）→
两遍归一化后完全一致才落盘；任一遍失败即拒绝回填并保持 `verified:false`。最终判定刻意**重新读盘**，
保证「被置 true 的数据」与「报告里存档的数据」是同一份。

04 样例 —— `docs/verification-report-doc04.json`（5 题 / 9 请求 / 总墙钟 7802ms / 均值 867ms·请求）：
c-ch09-cc-001 980 · c-ch09-dbg-001 735 · c-ch09-cr-001 723 · c-ch05-pg-001 693/892/896/913 ·
c-ch05-co-001 713/332（ms）→ **5/5 PASS**，写回时 `定点改写 4 处 verified`（第 5 道本来就是 true，
脚本只在值真的不同时才动那一行）。`git diff --stat -- 04_*` = **4 insertions / 4 deletions**，
全部是 `"verified": false → true`，没有格式化噪声（见 10.6 的事故复盘）。

### 10.4 `verify-data.ts --self-test` 的 11 个负例（闸门有效性的证明）

SCHEMA（多塞 `score`）· ID-DUP · REF-DANGLING · LINE-ENDING（`expected` 末尾多写换行）· SHARD-UNKNOWN ·
ID-FILE（题放错分片）· ID-CHAPTER（`chapter` 字符串与 id 前缀不符）· SECTION-CHAPTER（`section` 节号不属于该章）·
SOURCE（缺 `source`）· NONCODE-VERIFIED · VERIFIED-NO-PROOF。
基线噪声（合成题不在真实 index 里、知识/演示语料尚空）单列，不与上述 11 码混淆。

### 10.5 对硬约束表的增量影响

- 第 6 节第 5、6、7 行的状态已按阶段 3 事实更新（原文见各处「已交付」标注）。
- 遗留：7.4 的 `probe()` 健康检查仍未实现；`docs/chapter-map.md` 的 `pendingRulings`
  （指针章号 `c-ch08` 与本仓库 04/08 文档示例里的 `c-ch09` 冲突）待用户裁决后才能批量出题。

### 10.6 事故复盘：一次「定点改写」写成了整块重排

`--doc04` 的第一版写回实现是「找到围栏 → `JSON.stringify(obj, null, 2)` 整块重写」，
结果是 04 里 `"accepted": ["a","b"]` 这类紧凑数组被炸成多行：一次 4 行的 verified 翻转
制造了 **56 insertions / 13 deletions** 的 diff——规范文档没法审。已改为
`patchDocSample()`：按顶层键逐行定点替换（顶层键固定两空格缩进，嵌套同名键不会误伤），
替换后**重新解析并断言除目标键外没有任何语义变化**，不满足就抛异常、一个字都不写。
`04_题型规范与样例.md` 已用 `git cat-file blob <HEAD-sha>` 字节级还原后重跑，最终 diff 即 10.3 所列 4 行。
纪律：**任何写回规范文档的脚本，验收标准是 `git diff` 的行数，不是「跑成功了」**。

### 10.7 事故复盘：一次 HTTP 502 把已验证的题悄悄降级了

真实跑 `npm run judge:verify`（9 个串行请求）时，第 5 个请求 Godbolt 返回 **HTTP 502**。
第一版脚本只区分「用例比对通过 / 不通过」，于是：

1. `c-ch06-cc-001` 的 `verified` 被从 `true` **写回成 `false`**；
2. 报告被本轮结果整体覆盖，**上一次成功取证的 stdout 与耗时一并丢失**。

一次上游抖动毁掉了已验证状态与它的证据链——这比「后端不可用」本身更糟，因为站点数据被
静默改坏了。**结论：传输层结果必须和内容层结果分开建模。**

修正后的语义（`scripts/judge-verify.ts`）：

| 概念 | 判定 | 处置 |
|---|---|---|
| `isInconclusive()` | 任一用例 `!http_ok` 或 `error_class === 'transport-error'` | 本题记为**未判定** |
| 重试 | 仅传输层，`MAX_ATTEMPTS = 2`，间隔 1500 ms **串行**复跑 | 内容错误（编译失败 / 输出不符）**不重试**，那是真失败 |
| 写回 | 两处写回（04 与分片）都是 `if (r.inconclusive) continue` | `verified` 一个字节都不动 |
| 证据 | 报告新增 `last_known_good: { id: { at, wall_ms, requests } }` | **只增不减**：本轮真跑通才刷新，未判定沿用原时刻 |
| 退出码 | `hardFailed === 0 && inconclusiveCount === 0 ? 0 : 1` | 有未判定就 **EXIT=1**，闸门不放行，但数据不改 |

负例对照（同一轮内连续两次执行，后端换成必然抛 `HTTP 502` 的替身）：

```text
$ node scripts/judge-verify.ts --simulate-5xx   # 第 1 次
🚩 未判定 c-ch05-cr-001  轮次=2  沿用 2026-09-06T11:36:21.466Z 那次成功的实机证据
🚩 未判定 c-ch06-cc-001  轮次=2  沿用 2026-09-06T11:36:21.466Z 那次成功的实机证据
🚩 未判定 ds-ch02-pg-001 轮次=2  沿用 2026-09-06T11:36:21.466Z 那次成功的实机证据
无需改 c-ch05.json / c-ch06.json / ds-ch02.json —— 未判定(verified 不动)      EXIT=1
$ node scripts/judge-verify.ts --simulate-5xx   # 第 2 次（连续抖动）
   carried_from 仍然是 11:36:21.466Z —— 取证时刻没被「沿用的沿用」稀释成抖动那一轮的时间
MD5：c-ch05.json / c-ch06.json / ds-ch02.json / index.json 四个文件 before 与 after 全部 SAME
```

随后联网复跑 `node scripts/judge-verify.ts` → **3/3 PASS**（9 请求 · 总墙钟 15260 ms ·
均值 1696 ms/请求；其中一条 `code_reading` 请求 7846 ms，可见 Godbolt 排队抖动的量级），
`c-ch06-cc-001` 的 `verified=true` 与报告证据同时恢复，`inconclusive_this_run: []`。

**顺带记录一条环境事实**：`npm run build` 在受限沙箱内以 `spawn EPERM` 失败
（tailwind oxide 原生模块加载 + 子进程创建受限），非沙箱下 337 ms 正常完成。
这不是代码问题，别把它误读成「构建坏了」。


### 10.8 生成物去时间戳：改内容指纹（阶段 3 收尾时补做）

`build-index.ts` 原来往 4 个生成文件里写 `generated_at: <时间戳>`，后果是**每跑一次
`npm run build:index`，git status 里就多出 4 个假变更**，「数据到底改没改」看不出来，
也没法用 `build:index && git diff --exit-code` 当手改检测。现改为 `content_sha`
（sha256 前 16 位，覆盖除自身外的全部序列化字节）。三条实测：

| 检验 | 命令 | 结果 |
|---|---|---|
| 确定性 | 连跑两次 `node scripts/build-index.ts`，比 6 个 JSON 的 MD5 序列 | 完全相同 |
| 内容相关 | 临时改 `c-ch05.json` 一个词 → 重建 → 还原 → 重建 | 指纹 `8808fefe… → 0dc5a2fe…`、`62e39cb8… → 40c37513…`；还原后指纹与文件 MD5 逐字节回到基线 |
| 手改自愈 | 手工把 `problems/index.json` 的 `count` 改成 99 → 重建 | 还原为原字节，`$after -eq $orig` 为 True |

代价：`generated_at` 字段没了。谁需要构建时间，从 git 提交时间或 CI 日志取，别塞进内容寻址的产物里。