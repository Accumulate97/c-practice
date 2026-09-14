# ADR-0002 · 判分后端容灾：Godbolt 编译器梯队 + 自动切换

- 状态：**已接受**
- 日期：2026-09-14
- 决策：本轮无人值守任务书（任务 3「Godbolt 备用后端」）授权 Codex 自主定夺；实机取证：Codex
- 关联：ADR-0001（后端选型）、`AGENTS.md` 二·5（编译引擎／降级模式）、`src/judge/failover.ts`、`src/judge/index.ts`、`src/app/config.ts`、`scripts/probe-backends.mjs`、`scripts/acceptance-failover.mjs`

---

## 1. 背景

ADR-0001 之后，全站的在线判分**单点依赖** `godbolt.org` 的一个编译器 id（`cg132`）。
它没有 SLA，历史上出现过真实 502（2026-09-06，见 `AGENTS.md` 二·7 的「抖动＝未判定」条款）。
单点意味着：Godbolt 一次抽风，学生点「运行」就只能落到降级自评模式，学习闭环断掉。
任务书要求接一个备用后端做容灾，**优先 Piston，或 Wandbox**；若成本过高或接口不可用，
如实说明并给建议，不硬做。

## 2. 实测：任务书点名的两个第三方，2026-09-14 都不可用

取证脚本 `scripts/probe-backends.mjs`（`npm run probe:backends`，串行、每档一次、原始响应存档到
`tmp/backend-probe.json`，该目录已 gitignore）。本轮实跑结果：

| 候选 | 端点 | 结果 | 结论 |
|---|---|---|---|
| Piston | `POST https://emkc.org/api/v2/piston/execute` | **HTTP 401** | 2026-02-15 起白名单制，匿名请求一律拒；与 ADR-0001 §4.0 的复测一致，**未恢复** |
| Wandbox | `POST https://wandbox.org/api/compile.json` | **HTTP 500**（`Failed to get uid`） | 沙箱侧起不来；ADR-0001 记的是三次 504，**仍不可用** |
| Godbolt `cg132`（GCC 13.2） | `POST https://godbolt.org/api/compiler/cg132/compile` | **200 / didExecute=true / stdout="ok"**，929 ms | 现役主级 |
| Godbolt `cg142`（GCC 14.2） | 同上 | **200 / didExecute=true / stdout="ok"**，991 ms | 备用一级 |
| Godbolt `cg131`（GCC 13.1） | 同上 | **200 / didExecute=true / stdout="ok"**，1086 ms | 备用二级 |

也就是说：**此刻不存在任何可被纯静态站浏览器直连的第二厂商**。
剩下的可选项只有三个：

1. 自建/租用编译服务 —— 违反硬约束 1「纯静态、无后端」，且本项目要开源，不能依赖个人实例（ADR-0001 同一理由）。
2. 需要 API key 的服务（judge0 等）—— key 只能打进 bundle，等于公开泄露，ADR-0001 已否决。
3. **同厂多版本梯队** —— 用 Godbolt 自己的多个独立编译器 id 做冗余。

## 3. 决策

选 3。新增 `src/judge/failover.ts::createFailoverBackend(tiers, options)`，把「主编译器 + N 个备用编译器」
包成一个**仍然满足 `JudgeBackend` 契约**的对象，注册进 `src/judge/index.ts` 的 `godbolt` 工厂：

```
godbolt（cg132，主）  →  godbolt:cg142  →  godbolt:cg131  →  （全灭）client 既有降级自评
```

默认开启，可用环境变量关掉：`VITE_JUDGE_FAILOVER=off`（整体停用）或 `VITE_GODBOLT_FAILOVER=`（空梯队），
关掉后行为与 2026-09-14 之前逐字节一致（返回裸 `GodboltAdapter`）。见 `.env.example`。

### 3.1 为什么「同厂多版本」算真容灾，不是自欺

- Godbolt 的每个编译器 id 背后是**独立的编译/执行链路**（不同 gcc 版本、不同容器镜像）。
  本轮真实注入实验：把主级替换成必然返回 502 的替身，`cg142` 正常接手，学生侧 `accepted`（验收 ⑭）。
- 它救不了「godbolt.org 整站挂」——那种情况全链都会失败，落到 client 的降级自评（验收 ⑥），
  口径与今天完全相同，**不伪造通过**。这是诚实的边界，写在这里以免被误读成「双活」。
- 它确实救得了本站遇到过的真实故障形态：单编译器 5xx、单链路排队超时、单编译器被下线/改 id。

### 3.2 三条切换规则（实现于 `failover.ts`，验收逐条覆盖）

| 规则 | 内容 | 理由 | 验收 |
|---|---|---|---|
| 1 | **只有 `retryable === true` 的 `JudgeTransportError` 才切换**（5xx / 网络失败 / 坏 JSON / 缺 `didExecute` / 429） | 这些是「后端没给出结果」，换一级有意义 | ② ⑤ ⑭ |
| 2 | `retryable === false` **立即抛出，不换级**（25 s 软超时 abort、401/403 backend-auth） | 软超时多半是学生代码里的死循环；换一级只是让它再挂 25 s，把 25 s 变 75 s。401/403 是整站被拒，换 id 无用 | ③ |
| 3 | **编译错误 / 运行崩溃不触发切换** | 那是 `ExecutionResult` 里的事实（学生代码有问题），不是后端故障 | ④ |

另加两道闸，防止容灾自己变成新的故障源：

- **健康记忆**：某级失败后 `cooldownMs`（默认 60 s）内直接跳过，不再让每个请求都先撞一次故障；
  全级都在冷却时**仍按原顺序试一遍**（记忆可能是错的，不能因此放弃）。`resetHealth()` 供验收与「重试后端」按钮清空（验收 ⑦）。
- **墙钟预算**：单次 `execute` 走完整条链不超过 `budgetMs`（默认 30 s），超了就停手交给降级，
  绝不让容灾把「运行一次」拖到分钟级（验收 ⑧）。

### 3.3 判分口径必须一致（任务书要求）

三级都走同一个 `GodboltAdapter`，因此 `-std=c99 -Wall -Wextra`、`executorRequest: true` + `filters.execute: true`
双执行开关、串行队列（`maxConcurrency: 2` / `minIntervalMs: 100`）、软超时 25 s、
判分顺序（`buildResult.code != 0 → compile-error` → `timedOut → timeout` → 退出码 → 截断）**逐项相同**。
梯队对象的 `maxConcurrency / minIntervalMs / timeoutMs` 取各级**最保守**的一档（验收 ⑩）。
跨级一致性有实测背书：含 `scanf` 的同一份代码 + 同一份 stdin，`cg132` 与 `cg142` 都得到 `338350`（验收 ⑫）。

> gcc 13.1 / 13.2 / 14.2 对本站题面的 C99 代码在**标准输出**上无差异（题目输出全是确定性 `printf`）。
> 若将来出现版本敏感题（例如依赖 UB 的「输出未定义」题），应把它固定到单一编译器，不进梯队。

### 3.4 链 id 沿用 `godbolt`（一个不显眼但关键的决定）

`client.ts` 的结果缓存键、跨标签页锁名、JudgeLab 上显示的后端名都吃 `backend.id`，
缓存键还专门给 `godbolt` 加了编译器指纹。**换 id 会让既有进度缓存与锁全部失效**，
并让同一份代码在切换前后各存一份缓存。所以梯队对象的 id 默认就是 `tiers[0].id`（`godbolt`），
各级另用 `godbolt:<compiler>` 作为**内部**标识，只出现在 `stats().servedBy` 与切换播报里。
验收 ①（链 id 不变）与 ⑨（缓存命中，第二次 0 新增请求）覆盖这一点。

### 3.5 与 `client.ts` 的分工（谁负责什么）

| 层 | 职责 |
|---|---|
| `failover.ts` | **一次请求内**的空间冗余：这一级挂了，立刻换下一级再试 |
| `client.ts` | **跨请求**的时间冗余与降级：既有的 retries（默认 1）、失败后 30 s cooldown、结果缓存、跨标签页串行锁、以及全链失败后的降级自评（读构建期预存 stdout，不计正确率、不置 verified） |

全链失败时 `failover` 抛出的仍是 `JudgeTransportError`，`kind / retryable / status` 沿用最后一级，
消息里拼上每一级的失败原因（形如「判分后端全链不可用（3 级）：godbolt：busy … ／ godbolt:cg142：network …」），
因此 **client 的既有逻辑一行未改**（验收 ⑥：`state = backend-unavailable`，无预存输出时如实说「请稍后重试」）。

### 3.6 明确不做的事

- **不给 `getBackendFor(compiler)` 挂梯队**：用户在 JudgeLab 里显式选了某个编译器，
  拿别的编译器去「替他完成」是欺骗用户选择，那条路径保持单点。
- **不把 `libm` 支路（`cicc191`，icc）混进 C 梯队**：它是为 `-lm` 单独分流的（见 `src/judge/math-lib.ts`），
  口径不同，混用会让「含 `sqrt` 的题」在切换前后判定不一致。
- **不并发探测整条链**：Godbolt 是排队模型，并发越高吞吐越低（ADR-0001 实测串行 1.36 QPS vs 并发 20 只有 0.52 QPS），
  容灾切换严格串行。

## 4. 验收

`npm run acceptance:failover`（`scripts/acceptance-failover.mjs`，已接入 `acceptance:all`，15 → **16 套件**）。
离线段 10 项用故障注入，**0 真实请求**；在线段 4 项打真实 Godbolt，严格串行约 7 次请求。
在线段打不通时记 `SKIP` 而不是 `FAIL`（遵循 `AGENTS.md` 二·7「后端抖动＝未判定」）。

本轮实跑：**14 PASS / 0 SKIP / 0 FAIL**。

| # | 项 | 结果 |
|---|---|---|
| ① | 梯队装配，链 id 沿用主后端 | PASS（`godbolt -> godbolt:cg142 -> godbolt:cg131`，并发 2 / 间隔 100 ms） |
| ② | 主级 5xx → 自动切第二级 | PASS（A 故障 → B 接手，A 进 60 s 冷却） |
| ③ | 软超时（不可重试）→ 不换级重跑 | PASS（第二级 0 次调用） |
| ④ | 学生编译错误 → 不切换 | PASS（只打主级 1 次，诊断原样透传） |
| ⑤ | 全链故障 → 聚合原因 | PASS（三级原因全在消息里） |
| ⑥ | 全链故障时 client 仍走既有降级口径 | PASS（`backend-unavailable`，不伪造 accepted） |
| ⑦ | 健康记忆 + `resetHealth()` | PASS（3 次请求只撞主级 1 次） |
| ⑧ | 墙钟预算闸 | PASS（第三级 0 次调用） |
| ⑨ | 结果缓存不受容灾影响 | PASS（`cacheHit=true`） |
| ⑩ | 梯队参数取最保守一档 | PASS（并发 1 / 间隔 500 ms / 超时 30 s） |
| ⑪ | 真实梯队各级可用 | PASS（36 / 24 / 24 ms） |
| ⑫ | 跨级判分口径一致 | PASS（`cg132` 与 `cg142` 同得 `338350`） |
| ⑬ | 主链路未受影响（默认后端真跑） | PASS（`accepted`，36 ms） |
| ⑭ | 真实注入：主级 502，学生仍 accepted | PASS（`cg142` 接手，学生无感） |

## 5. 复评触发条件

出现下列任一情况，重开本 ADR：

1. Piston 恢复匿名访问（`npm run probe:backends` 不再 401）→ 应实现真正的**跨厂商**第二后端，
   按 `src/judge/index.ts::getBackend()` 顶部注释的契约补一个适配器即可，`createFailoverBackend` 直接吃它。
2. Godbolt 开始要求 API key 或对本站来源限流（429 常态化）。
3. 题库出现版本敏感题（依赖 UB／编译器扩展），需要按题固定编译器。

## 6. 一句话总结

任务书点名的 Piston / Wandbox 于 2026-09-14 实测分别是 **401** 与 **500**，都不可用；
在不违反「纯静态、无 key、口径一致」的前提下，唯一能真做的容灾是 **Godbolt 同厂多版本梯队 + 严格串行的自动切换**，
现已默认开启、可一键关闭、14 项验收全绿，且对既有缓存/锁/降级逻辑零改动。
