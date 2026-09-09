# 待办 Backlog（只登记，不做）

> 登记于 2026-09-09（模块 3 · 程序填空会话）。两项均为用户明令「压到模块 5 之后」的遗留项。
> 本文件只做登记与口径固化；模块 5 之前的任何会话不要动它们。

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