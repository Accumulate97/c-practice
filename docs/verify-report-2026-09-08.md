# judge:verify 全量跑批报告（2026-09-08）

后端 Godbolt cg132（gcc 13.2）· 编译参数 `-std=c99 -Wall -Wextra` · 严格串行 serial_only=true · minIntervalMs=100 · gcc 缺省 -O0（参数里无 -O 标志）

| 指标 | 值 |
|---|---|
| 跑批题数 | 217 |
| 请求数 | 240 |
| 墙钟 | 337 s |
| 均值 | 1403 ms/请求 |
| 通过 | 144 |
| 失败 | 73 |
| 后端抖动/未判定 | 0 |
| 置 verified:true | 143（code_reading 133 + code_completion 10）|
| verify:data | 题目 493 · error 0 · warn 142（NOT-VERIFIED 140 + CORPUS-EMPTY 2）|

## 未跑批的缺口（NOT-VERIFIED 140 = 73 失败 + 19 + 48）

- **48 道 programming**：`reference` 为空串 → 无可编译源码，judge:verify 永远无法验证（含点名的 4.73/4.74/7.18/7.21/7.29 等 sqrt 题）。
- **19 道 code_reading**：`answer` 为空 → 无预期输出可比对（含 c-ch03-cr-017/018、c-ch04-cr-002/004/020、c-ch09-cr-007~014 等）。

## 失败分类（73 题，全部为 code_reading；无 programming / code_completion 失败）

### A. 代码片段不完整（题干只给 for/while/switch/if/printf 片段，缺 #include 与 main → 语法错误） — 28 题

`c-ch03-cr-004` `c-ch03-cr-005` `c-ch03-cr-006` `c-ch04-cr-019` `c-ch04-cr-021` `c-ch04-cr-022` `c-ch05-cr-004` `c-ch05-cr-005` `c-ch05-cr-006` `c-ch05-cr-007` `c-ch05-cr-012` `c-ch05-cr-020` `c-ch06-cr-001` `c-ch06-cr-002` `c-ch06-cr-004` `c-ch06-cr-007` `c-ch06-cr-015` `c-ch06-cr-016` `c-ch06-cr-018` `c-ch06-cr-023` `c-ch06-cr-024` `c-ch06-cr-029` `c-ch11-cr-001` `c-ch11-cr-002` `c-ch11-cr-006` `c-ch11-cr-007` `c-ch11-cr-011` `c-ch11-cr-016`

### B. 印刷/OCR 缺陷（有 main 但代码本身语法错） — 2 题

- `c-ch07-cr-001`：error@5:1 <source>:5:1: error: expected '=', ',', ';', 'asm' or '__attribute__' before '{' token
- `c-ch09-cr-001`：warning@12:5 <source>:12:5: warning: implicit declaration of function 'retur' [-Wimplicit-function-d

### C. 读 stdin 但题库无 stdin 数据（空输入 → 输出与预存答案不符） — 31 题

`c-ch03-cr-013` `c-ch04-cr-006` `c-ch04-cr-007` `c-ch04-cr-008` `c-ch04-cr-011` `c-ch04-cr-012` `c-ch04-cr-015` `c-ch04-cr-016` `c-ch04-cr-017` `c-ch04-cr-018` `c-ch05-cr-011` `c-ch06-cr-009` `c-ch06-cr-013` `c-ch06-cr-019` `c-ch06-cr-020` `c-ch06-cr-030` `c-ch06-cr-033` `c-ch06-cr-034` `c-ch07-cr-003` `c-ch09-cr-003` `c-ch09-cr-021` `c-ch09-cr-024` `c-ch09-cr-026` `c-ch09-cr-027` `c-ch09-cr-042` `c-ch09-cr-044` `c-ch09-cr-045` `c-ch09-cr-046` `c-ch09-cr-048` `c-ch09-cr-049` `c-ch09-cr-054`

### D. 读 stdin 且无 EOF 终止条件（空输入下死循环 → 约 20s 超时 / 被 SIGTERM 杀，退出码 143） — 8 题

`c-ch05-cr-001` `c-ch05-cr-003` `c-ch05-cr-008` `c-ch05-cr-016` `c-ch06-cr-005` `c-ch07-cr-017` `c-ch09-cr-017` `c-ch09-cr-020`

### E. 依赖 argv / 外部文件（argc<2 直接返回，或 fopen(argv[i]) 找不到文件 → 无输出） — 3 题

- `c-ch09-cr-051`：
  - 期望 `"beijing\nshanghai"`
  - 实得 `""`
- `c-ch09-cr-052`：
  - 期望 `"\nThe count is :3."`
  - 实得 `""`
- `c-ch12-cr-001`：warning@9:9 <source>:9:9: warning: implicit declaration of function 'exit' [-Wimplicit-function-decl
  - 期望 `"bbbcccddd"`
  - 实得 `""`

### F. 真·输出与预存答案不符（需人工裁定题目或答案） — 1 题

- `c-ch12-cr-002`：
  - 期望 `"position=6\nposition=18"`
  - 实得 `"position=0\nposition=12"`

## verified 变动审计

- 失败题中 verified:true = **0**（无错误置位）。
- 唯一 true→false：**c-ch05-cr-001**（HEAD 里的阶段 2 种子题，`while((c=getchar())!='?') putchar(++c);`）。原因是缺 stdin → 死循环被杀，属内容失败而非后端抖动；其历史证据按「只增不减」保留在报告 `last_known_good`（145 键）。
- 非代码题带 verified:true 共 209 道（single_choice 102 / fill_blank 89 / short_answer 18），来自提取阶段语义标记；verify:data 不报错（NOT-VERIFIED 只查代码题），但 verified 对选择题无实机含义 → 待裁定是否清空。

## 遗留待办（本轮只报告，未修补）

1. 为 39 道读 stdin 的阅读题（C+D 类）补结构化 `tests[].stdin`：输入只以「5□4□3□6＜回车＞」写在题干里，未结构化。这是失败的最大单一成因（39/73）。
2. 为 28 道片段题（A 类）补最小 main 包装，或加 `fragment:true` 由 judge 自动包装。
3. 为 48 道 programming 补 `reference` 参考解（否则 48 条 NOT-VERIFIED 无解）。
4. 为 19 道 answer 空的阅读题补预期输出。
5. c-ch12-cr-002 人工裁定（实得 position=0/12 vs 预存 6/18）。
6. c-ch09-cr-001 的 `retur` 拼写、c-ch07-cr-001 的结构缺陷需修题面。
7. judge:verify 未实现 sqrt→g132 分支（本轮 0 影响：唯一含 sqrt 的 c-ch07-cr-001 先因语法失败）。
