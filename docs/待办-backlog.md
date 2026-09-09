# 待办 Backlog（只登记，不做）

> 登记于 2026-09-09（模块 3 · 程序填空会话），待办 3 补登于同日模块 4 · 程序改错会话。
> 待办 1、2 为用户明令「压到模块 5 之后」的遗留项；待办 3 是模块 4 验收时扫出的内容缺陷。
> 本文件只做登记与口径固化；模块 5 之前的任何会话不要动它们。
> **2026-09-09 内容返工会话：待办 1/2/3 已全部完成并关闭**，证据见 `docs/内容返工报告-2026-09-09.md`；本轮扫出的残留项登记在文末「残留登记」节。

---

## 待办 1（高优先级）：48 道 programming 的 reference 为空串 → expected 从未被验证

- 现状：`public/data/problems/c-ch*.json` 全量复扫（2026-09-09）：`programming = 48`，其中 `reference` 为空串 = **48**（100%）。
- 后果链：
  1. `expected` 没有参考实现背书，从未被实机验证过；
  2. `judge:verify` 对 programming 无源可跑 → 这 48 题**永远 `verified: false`**；
  3. **最大风险**：若 `expected` 本身有错，学生提交正确代码也会被判错——这不是「可接受的 warn」。
- 正确解法（唯一路径，禁止绕过）：
  1. 逐题补写标准 C 参考实现（AGENTS.md 二节 6 条：禁 C++ 语法、类C伪码、gets/conio.h 等）；
  2. Godbolt cg132 实机跑出真实 stdout，重生成 `expected`；
  3. `npm run judge:verify` 置 `verified`（禁止手填），证据写入 `verification-report.json`。
- 排期：**模块 5 之后**。
- ✅ **已完成（2026-09-09 内容返工）**：48 道 reference 全部补齐，全量 `judge:verify` 实机通过并置 `verified:true`（脚本置位，无手填）；expected 与实机输出零不符，未修正任何 expected。含 sqrt 的题由 judge-verify 的 libm 路由走 g132（全库实扫仅 c-ch07-cr-001 与 c-ch08-pg-005 两道命中）。详见报告 §一。

## 待办 2：code_reading 的 stdin 数据填充

- 结构已就绪（模块 3 任务 1，2026-09-09 已批准的 schema 改动；只改结构与读取口径，本次未填任何数据）：
  - `schema/Problem.schema.json` → `code_reading` 分支新增可选字段 `stdin`（字符串，默认空串）；
  - `scripts/lib/problem-code.ts` → `buildRunnableSource` 不再固定喂空串，改读题目 `stdin` 字段（缺失按空串）；
  - `judge:verify` / `verify:data` / `lint:code` 共用该函数，已自动同步，无需各自再改。
- 待填数量口径（开工前以逐题复核为准）：
  - 用户 2026-09-09 口头口径：**32 道**；
  - `docs/verify-report-2026-09-08.md` 分类口径：**C+D = 39 道**（C 类 31 道读 stdin 但题库无数据；D 类 8 道读 stdin 且无 EOF 终止条件，空输入下死循环 ~20s 超时）；
  - 本次会话按「模板含 scanf/getchar/fgets/getc 读入调用」扫描 225 道 code_reading，命中 **39 道**，与 C+D 口径一致。
- 做法：把题干里已写明的输入（如「5□4□3□6＜回车＞」）结构化成 `stdin` 字段，再重跑 `judge:verify` 与预存 answer 比对；D 类需同时给输入与终止条件核对。
- 排期：**模块 5 之后**。

## 待办 3
- ✅ **已完成（2026-09-09 内容返工）**：39 道 stdin 按题干提取补齐（38 道首批 + 收口复扫补捉 c-ch04-cr-005），实机复核与预存 answer 全部一致，零修正、零 note；顺带修复 2 处 OCR 代码笔误（c-ch09-cr-001、c-ch07-cr-001）；c-ch04-cr-011/012 问的是「输入应满足的条件」而非输出，按口径置 `answerIsDescription:true` 并清空 answer 退出自动判分，条件推演写入 explanation。详见报告 §二。

## 待办 3（内容阶段返工）：15 道 debug 题的 bugs 文本行号写错 14 道

- 发现方式：模块 4 验收 harness 构造「只保留一处 bug」的部分修正时，按 bugs 文本行号换回原行，
  结果换回去的是一条**没有 bug 的行**，代码退化成完全正确 → 3/3 全通过 → partial 场景假 FAIL。
  追根因做了全量扫描：逐行**大小写敏感**比对每题 `code` 与 `fixed_code`，与 bugs 文本开头的「第 N 行」对照。
- 扫描结论（2026-09-09，15 道 debug 题）：**只有 `c-ch07-dbg-010` 一道行号全对，其余 14 道至少有一处不符**；
  偏差形态是 ±1~±2 的整体偏移（像是按「不含 #include 的行」或「1 起/0 起混用」数的），个别条目指向非错误行。

| 题号 | 处数 | bugs 文本声称 | code↔fixed_code 真实差异行 | 声称行号命中真实差异行 |
|---|---|---|---|---|
| `c-ch04-dbg-001` | 2 | 7、9 | 6, 8 | 0/2 ❌ |
| `c-ch04-dbg-002` | 2 | 9、11 | 7, 9 | 1/2 ❌ |
| `c-ch04-dbg-003` | 3 | 7、9、10 | 6, 9, 10 | 2/3 ❌ |
| `c-ch05-dbg-004` | 2 | 5、11 | 4, 11 | 1/2 ❌ |
| `c-ch05-dbg-005` | 2 | 9、10 | 7, 8 | 0/2 ❌ |
| `c-ch05-dbg-006` | 2 | 8、10 | 7, 9 | 0/2 ❌ |
| `c-ch06-dbg-007` | 2 | 9、11 | 7, 10 | 0/2 ❌ |
| `c-ch06-dbg-008` | 2 | 10、9 | 8, 9 | 1/2 ❌ |
| `c-ch06-dbg-009` | 3 | 8、9、10 | 8, 10, 11 | 2/3 ❌ |
| `c-ch07-dbg-010` | 2 | 2、12 | 2, 4, 5, 6, 12 | 2/2 ✅ |
| `c-ch07-dbg-011` | 2 | 5、12 | 5, 11 | 1/2 ❌ |
| `c-ch07-dbg-012` | 2 | 7、9 | 6, 8, 15 | 0/2 ❌ |
| `c-ch09-dbg-013` | 2 | 11、10 | 8, 10 | 1/2 ❌ |
| `c-ch09-dbg-014` | 2 | 4、11 | 5, 12 | 0/2 ❌ |
| `c-ch09-dbg-015` | 2 | 8、7 | 8, 9 | 1/2 ❌ |

  注：表中「声称」取每条 bug 文本开头第一个「第 N 行」。真实差异行是 code↔fixed_code 的全部不同行，
  一处逻辑错误可能牵动多行（如 `c-ch07-dbg-010` 形参改指针后第 4、5、6 行的解引用都要跟着改），
  所以「真实差异行」列可能比处数多，这属正常。

- 后果：bugs 是**第 3 级提示的正文**，行号错误会把学生引到没错的行上；explanation 里同样复述了错误行号
  （如 `c-ch04-dbg-001` 的解析写「第 9 行方向写反」，实际是第 8 行）。判分不受影响——
  判分只看 testCases 的实机 stdout，一行 bugs 文本都不读。
- 临时缓解（模块 4 已落地，不需等本待办）：`DebugRenderer` 第 2 级提示的行号**不采信 prose**，
  改为运行时现算 code↔fixed_code 的真实差异行并折叠连续区间，学生看到的行号一定对得上编辑器。
- 正确解法：内容阶段逐题重写 bugs 与 explanation 里的行号（以真实差异行为准），
  重写后重跑 `npm run verify:data` 与 `npm run lint:code`；**不需重跑 judge:verify**——
  code / fixed_code / testCases / expected 一个字节都不用动，verified 证据依然有效。
- 排期：**模块 5 之后**，与待办 1（48 道 programming 补参考实现）合并成一次内容返工。
- ✅ **已完成（2026-09-09 内容返工）**：27 处行号修正（14 道题的 bugs 开头行号 26 处 + c-ch04-dbg-001 explanation 复述 1 处）；c-ch05-dbg-005 正文指输出行的「第 1 行」与 c-ch07-dbg-010（原本全对）未动。自检：15 道题每条 bugs 开头行号 100% 命中 code↔fixed_code 真实差异行；`acceptance:dbg` 37/37 PASS（111 次实机请求）。详见报告 §三。

---

## 残留登记（2026-09-09 内容返工轮扫出；只登记，不做）

> 完整清单与理由见 docs/内容返工报告-2026-09-09.md §五。judge:verify 的 32 道 FAIL 全部落在 R1+R2，属「不可判分」而非「判分失败」。

- **R1 · 28 道片段式阅读题**（无 main → compile-error，verified:false）：c-ch03-cr-004/005/006、c-ch04-cr-019/021/022、c-ch05-cr-004/005/006/007/012/020、c-ch06-cr-001/002/004/007/015/016/018/023/024/029、c-ch11-cr-001/002/006/007/011/016。救活需补 main 或改按函数判分 = 内容重做，超出「填 stdin」口径。
- **R2 · 4 道环境依赖阅读题**：c-ch09-cr-051/052（需命令行 argv）、c-ch12-cr-001/002（需磁盘文件/argv）。schema 无 argv 字段（加字段 = 改 schema，本轮禁止），stdin 无法表达。
- **R3 · 21 道空 answer 阅读题不进判分**：18 道数据缺口 + 3 道 answerIsDescription（c-ch04-cr-004/011/012）。前端 exact.ts 注释与 CodeReadingRenderer 缺陷面板文案写死的「19 道」已过时（现 21），阶段 5 顺带改文案（本轮不动前端）。
- **R4 · lint:code 15 处 banned-gets**（9 道阅读题，教材原文风格）：cg132 可编译（warning）且执行 PASS，但与 AGENTS.md「禁用 gets()」冲突。改写成 fgets 会改变题目原文并需重跑取证——**待用户裁决**。
- **R5 · libm 前端缺口**：线上判分后端 cg132 不吃 -lm，含 sqrt 的 2 道题线上「实机对照」不可用（构建期 judge-verify 已路由 g132 取证，verified 证据完整）。scripts/judge-verify.ts 注释已说明，阶段 5 处理。
- **R6 · acceptance-dbg.ts 日志文案过时**：「prose 声称 […]，不符」是写死的旧文案，待办 3 修复后 prose 已与真实差异行一致；纯日志措辞不影响判定，阶段 5 顺带改。
