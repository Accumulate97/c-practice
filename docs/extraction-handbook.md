# extraction-handbook.md — C 程序设计试题汇编 提取作业手册

> 本手册是「原题提取」阶段的**长期口径唯一真源**（面向执行者，不面向读者）。
> 任何批次（含车道）在写 JSON 前必须先读本文件的第 2、3、4、5、6 节。
> 台账 `batch/_progress.md` 记录「发生了什么」，本文件记录「该怎么做」；两者冲突时以本文件 + `tools/check-lane.cjs` 为准。
> 建立于 2026-09-07，来源：用户五项裁决 + §14 派单铁律 + 历轮实测教训。

---

## 1. 范围与页码口径

- PDF：`C:/Users/zwr/Desktop/1/C程序设计试题汇编.pdf`，328 页，纯扫描无文字层（**禁用 OCR 出码**，tesseract 对代码不可用）。
- **PDF页 = 书页 + 11**。目次 p008–p011，试题 p012–p279，书末答案 p280–p327。
- `page` = PDF 页码（数字），`bookPage` = 印刷页码；两者都要写。
- 总账 **1008 题**（目次页与各章标题页提取的每章题数，见 `batch/_progress.md` 第 2 节）；对外口径 1007，差 1 在容差内。
- 渲染：`node tools/render.mjs <PDF页> <dpi> <输出前缀> [x y W H]`（前缀落在 viz 目录免提权）。常规 150dpi，**存疑处 300–600dpi 局部重渲**。
- 每批末尾**重叠 1 页**，重叠页以**首次交付**为准（keep-first），差异写进 report 交主线程裁决。

## 2. 五条归一化规则（已裁决，全量适用）

| # | 规则 | 例外与注记 |
|---|---|---|
| 1 | 长横「一」→ ASCII 减号 `-` | **符号形态考点禁止归一**：常量合法性判断、转义字符、运算符辨认、任何「以下哪个合法/正确」类题目，照录原印刷形态（`一`／`－－`／`＝＝`）并在 `note` 注明印刷特征。已定性的禁归一题：题2.5/2.6/2.7/10.88 |
| 2 | 代码排版空隙归一（保持 token 序列不变） | **只允许发生在 `code` 字段**；`stem`/`options` 不动 |
| 3 | 中文正文里拉丁词与汉字间的空格删除 | 仅限中文正文 |
| 4 | 上标／根号／分式线性化 | `note` **必填**，写明线性化形式与原排版形态 |
| 5 | `page` = PDF 页、`bookPage` = 印刷页 | 关系恒为 PDF页 = 书页 + 11 |

**不归一的印刷特征（照录）**：星号空隙 `x* cnum`、`( * p)`；`main( )` 括号内空格。
**落盘前必须为 0 的残留**（在 `code` 里）：`一>`、`# include`、`# define`、`x. y`、`<stdio. h>`。

## 3. `note` 字段铁律

- `note` 必须是**单行字符串**，多小句用全角 `；` 或 `。` 分隔。
- **禁止在 `note` 里写真实换行符**（会破坏 JSON 单行可读性并被 `check-lane` 判 WARN）。
- 段内换行如需保留（例如逐行说明），写字面两字符反斜杠+n（JSON 里即 `\n` 文本），不要用真换行。
- `[?]` 出现则 `note` **必须非空**；看不清就高 DPI 重渲，仍不确定则保留 `[?]` 并计入存疑清单，**禁止编造**。
- 每条 `note` 至少交代：为什么这样照录 / 归一例外 / 印刷缺陷 / 补充生成（如测试用例）中的哪一类。

## 4. `options` 形态：Convention X（全库唯一合法形态）

- 每空一个数组元素，形如「【1】A) …\nB) …\nC) …\nD) …」；`【n】` **只出现在该组首行**，其余行剥掉前缀。
- 单空题 = 4 个元素、无 `【n】`、无换行。
- **禁止 Convention Y**。
- 非选择题 `options` 一律为 `null`（不是空数组）。

## 5. `type` × `subType` 组合与判定顺序

**只允许以下组合**（2026-09-07 主线程裁决新增 `填空题`×`short_answer`）：

1. `选择题` → `single_choice`（**选择题一律禁用** `code_*` 与 `multi_blank`，即使题面是一段程序）
2. `填空题` → `code_reading` / `code_completion` / `multi_blank` / `short_answer`（新增）
3. `编程题` → `programming` / `short_answer`

**先定 `type`（答案形态：选项字母 / 填空 / 产程序）再定 `subType`。** subType 五条判定规则：

- 答案是**运行结果**、代码完整无空位 → `code_reading`（程序阅读写结果）
- 题目要求**补一段代码/一行代码**（单空）→ `code_completion`
- 题目要求**改错/找错** → `code_completion`（subType 用 code_completion，题面性质写进 note）
- **多个空**，或「概念填空 + 输出填空」混合 → `multi_blank`
- **无 `code` 的概念/表达式填空** → `multi_blank`（不是 code_reading）
- **既无选项、又无 `【n】` 填空位，答案要求书写步骤／文字解释** → `填空题` + `short_answer`，`expectedVerified=false`，不进自动判分（首例 题11.51）。**禁止为凑组合把填空题伪装成编程题。**

补充：`runtimeStdout` 行尾空格**不剥**；只有剥**末尾换行**。`expectedVerified=true` 必须同题存 `runtimeStdout`。

## 6. UB 与优化级别政策（用户裁决）

- Godbolt 优化级别**固定 `-O0`**（`userArguments: "-std=c99 -w -O0"`），所有 `expected` 均在该级别下生成。
- 程序阅读题涉及**未定义行为**时分三类处置：
  1. **题目本身考「这是 UB」** → 保留，答案为「未定义行为」；
  2. **本意考别的但不慎踩 UB** → 以 `-O0` 实测输出为准，`note` 标注「输出依赖编译器」；
  3. **输出无法稳定复现** → `subType` 改 `short_answer`，**不进自动判分**，答案写文字说明 + 实测值示例；`type` 保持忠于书的小节归属，**禁止为凑组合把填空题伪装成编程题**。
- 实测记录：题10.60 在 `-O0/-O1/-O2/-O3` 下 10/10 次同输出，但**结论不推广**到其他 UB 题，每题自测。

## 7. 实机验证优先（代码类答案以实机为准）

- 所有代码类题目（程序阅读、编程）的 `expected` **必须** Godbolt 实机验证；与书末答案不一致时**以实机输出为准**，`note` 记录差异与原因（书为 2012 年印刷，需考虑印刷错误与编译器差异）。
- **改标 ≠ 完成**：为满足组合规则而改 `subType`/`type` 的题，**仍须实机验证**，不得因「只是改标签」而跳过。
- 出现 MISMATCH 时：**先回读该题 `note` 定性**，再决定是否修补。已定性的「有 code 却 multi_blank」6 题（题3.37/3.38/4.54/4.55/6.87/10.73）**全部正确，禁止修改**。
- Godbolt 唯一 C 形态（详见 `batch/_progress.md` 第 8 节）：`POST https://godbolt.org/api/compiler/cg132/compile`，
  body 里 `executeParameters`（含 `stdin`）必须放在 `options` **内部**，放顶层会**静默丢 stdin**。
- **串行、间隔 ≥400ms、严禁并发**（实测吞吐 ≈1.36 QPS）；软超时 25s，Godbolt 自身 20s。
- **复验工具 `tools/reverify2.mjs`（加壳版）**：`expectedVerified=true` 且 code 无空位的题，若 code **无 `main`**（程序段形态）自动包成 `int main(void){ ... }` 再跑，结果行标 `[wrap]`；顶层函数定义形态（如 题11.50 的 `getbits(...)` 无 `main`）记「需人工 harness」并跳过。旧 `reverify.mjs` 只测含 `main` 的题，**对无 `main` 的历史批次是盲区**，故 48 道题需 M6 补跑。

## 8. 不可判分题与特殊题处置

- 原则：**不可判分的题单独归类，不得伪造 `testCases`**。
- 已裁决三例：题9.192（原书 0 基/1 基缺陷）照录原题 + 书末答案，`note` 标「原书参考程序与题面不一致，疑印刷缺陷」，另生成修正版变式题；
  题9.190（依赖 `argv[1]`）改造为 `scanf` 版本入库判分，原题保留并标注原依赖；
  题9.193（`%o` 打印八进制地址，随 ASLR 变化）→ `short_answer`，不进自动判分。
- **图形题不舍弃**：题面文字化描述 + `vizIds` 关联指针链可视化（MemoryBoard）。canonical 图形题 14 道：
  题4.5、6.76、6.130、9.4、9.5、9.82、10.29、10.31、10.32、10.33、10.65、10.70、10.83、10.91。
- 原书编程题不给测试用例：入库时**补充生成 3–4 组含边界**，`note` 标「测试用例为补充生成」；选择/填空/程序阅读不需要。
- **编程题输出格式必须写进题干**，消除格式歧义。
- 书含 `gets()` 的题目（20 道）：回填/入库时依据题意**重写为 `fgets` 版本**再跑 `expected`，不得直接用 `gets` 版本。

## 9. 工具口径（三条，2026-09-07 用户批准）

1. **viz 根目录真实路径是三段日期目录**：`C:\Users\zwr\.codex\visualizations\2026\09\06\01a07577-3dab-7dd2-90e9-8cc87e70c99a\`。
   环境声明里横杠日期形式在磁盘上不存在（`Test-Path` = False），写错形式直接 `Cannot find path`。
2. **「路径失效」vs「审批超时」鉴别**：`MODULE_NOT_FOUND` / `Cannot find path` ⇒ 路径错，改正即可，**不要重发审批**；
   只有 `CreateProcess { message: "Rejected(...did not finish before its deadline...)" }` ⇒ 真正审批器超时，**重试一次**即可。
   命令过长（PowerShell here-string）会显著提高审批器超时概率 ⇒ **提权命令保持最短**，逻辑放进 viz 里的 `.cjs`。
3. **取消 dry-run 通道**：不制作「写盘桩替换」的 `*-dry.cjs` 副本、不逐字节预演比对，落盘脚本直接跑（`apply8b-dry.cjs` 作废，仅历史留存）。
   ⚠ **实测沙盒并未真正放开**：对 `D:\C-practice-extract` 的 `fs.accessSync(W_OK)` 返回可写但真实写入 `EPERM` ⇒ 写提取目录**仍需一次提权到位**。

4. **提权路径改写陷阱（2026-09-07 22:20 实测）**：提权命令里写 viz 真实路径 `...\2026\09\06\<guid>\x.cjs`，
   审批器回显会被改写成磁盘上不存在的横杠形式 `...\2026-09-06\<guid>\x.cjs`，且本轮该次直接 `Rejected(...deadline...)`；
   改成先 `Copy-Item` 到 `%TEMP%`（路径不含日期段）再 `node "C:\Users\zwr\AppData\Local\Temp\x.cjs"` ⇒ **第二次尝试一次即批**。
   ⇒ 新口径：**提权执行的脚本一律先复制到 `%TEMP%` 再跑**；免提权的 here-string 写入仍直接写 viz。

另有红线：**`apply7.cjs` / `apply8.cjs` 永不再跑**（会重复插入）；**不写 `D:\C-practice\`**（本任务只在 `D:\C-practice-extract\`）。

## 10. 收批五步与车道纪律

每批完成后依次：`node tools/check-lane.cjs` → `node verify-extract.mjs` → `node tools/cross-check.cjs` → 实机 reverify → 落盘 totals（主线程回填 `batch/_progress.md` 第 3.2 节）。

- 每段写**独立 JSON，不互相合并**；**不得改动任何已交付批次**（5 个冻结批尤其）。
- 车道**禁止改写 `batch/_progress.md`**（第 3.2 节由主线程独占回填），批次登记行写在自己 `report.md` 末尾。
- 章名唯一真源 = `tools/check-lane.cjs` 的 `CH_NAMES` 与 `_progress.md` 第 2 节总账。
- 并行只在代码批通过后开放；全部完成后统一做一致性检查（题号连续、无重复、无缺失、无跨页未补）。

## 11. Godbolt 后端实测补充（2026-09-07 22:00 主线程）

1. **`cg132`（x86-64 gcc 13.2，C 模式）无法链接 libm**：任何含 `sqrt`/`pow`/`fabs` 之类数学函数的程序均
   `build.code=1` + `undefined reference to sqrt`。车道已穷举 6 种方案全部无效
   （`-lm`、`-static -lm`、`-Wl,--no-as-needed -lm`、`libraries:[{name:"m"}]`、`-O2 -fno-math-errno`、`-O1 -ffast-math`）。
   **可用替代 = `g132`（同主版本 x86-64 gcc 13.2，请求体 `lang:"c++"`）编译同一份 C 源码**，
   主线程实测 `sqrt=11.180340`、`top.code=0`、`build.code=0`、1599ms。
   ⇒ 政策：math 类题用 `g132/c++`，并在 `note` 写明「因 C 模式无 libm，实机用 g++ 13.2 编译同一份源码」。
   库内涉及 math 的题目前仅 5 道：题4.73、题4.74、题7.18、题7.21、题7.29（后三者多为含空位或原样不可编译）。
2. **`note` 必须记 stdin 配方**，措辞统一为 `stdin 为 <值>`（多值用空格分隔）。
   `tools/reverify2.mjs` 已能正则提取并自动注入复跑；若 note 未记配方、或值里含逗号分隔
   ⇒ 归为「需键盘输入（…）」跳过，**不算缺陷、不计 MISMATCH**。
3. **「原样不可编译」的题**（原书漏印分号／缺 `#include`）：入库 `code` 一字不改，实机跑只补必要两处、补丁不入库，
   且 `note` 必须含「原样不可编译」这五个字 —— `reverify2` 见此措辞即跳过自动复跑（离线无法复现补丁），
   凭据以车道 `report.md` 的实机表格为准。

## 12. 实机凭据硬口径（2026-09-07 22:25 主线程 · 证据审计 A1/A2/A3 结论）

1. **`note` 里的文字不算凭据**。写「已实机复核」「耗时 xxx ms」「Godbolt 通过」而无结构化证据，一律视为未验证。
   合法凭据只有两种：① 同题 `runtimeStdout` 字符串；② 完整 `testCases[].expectedStdout`。
   `tools/check-lane.cjs` 本轮起对此报 WARN（代码类 + `expectedVerified=true` + 两者皆无 ⇒ 拦下；
   `code` 内含 `【n】` 选项程序段的题除外，那属车道 harness 判定，按既有口径置 false）。
2. **`runtimeStdout` 归一化口径**：只剥**末尾换行**（`replace(/(\r?\n)+$/,'')`），**行尾空格必须保留**。
   原书 `printf("%d ", …)` 一类循环输出必然以空格结尾，剥掉就成了另一个答案。
   ⚠ 教训：主线程第一版补验脚本复用 `reverify2` 的 `norm()`（会剥每行行尾空格）⇒ 与本口径冲突，已用第二版重跑覆盖。
3. **审计三档结论（全库 627 题，`viz/audit-ev.cjs`）**：
   - **A1**（note 声称实机但无 `runtimeStdout`）103 题 ⇒ 绝大多数是**选择题**：车道用 harness 跑选项程序段判定答案，
     harness ≠ 题面 `code`，故置 `expectedVerified=false`，**合法、不改**；其中真缺陷子集＝A2 的 4 题 + p186-189 的 4 题，本轮已补。
   - **A2**（`expectedVerified=true` 且代码类但无 `runtimeStdout`）33 题 = 29 题 `code` 为空（书只给题面、参考程序在 report
     ⇒ 即**收尾③** 的范围，与 §15.9-4 口径一致）+ 4 题 code 完整（题5.97/5.98/5.99/5.100，本轮已补验）。
   - **A3**（有 `runtimeStdout` 但 `expectedVerified≠true`）2 题：题9.37（输入 `MyBooK` 与四选项字面皆不吻合，留待答案回填裁决）、
     题11.50（16 位题面 vs 32 位实机，convert 阶段转 `short_answer`）。**两题均为有意 false，勿动**。

## 13. 实机复验工具链口径（seed / blindspot / 诊断通道）（2026-09-07 23:25 主线程）

1. **编译器诊断只能读 `buildResult.stderr`**。Godbolt 的 gcc 诊断不进 `buildResult.stdout`；`tools/reverify2.mjs` 取 `bs || bo`（stderr 优先）是正确顺序。
   教训：题9.59 首轮「看不到诊断」曾被误判为「`-w` 吞掉了警告」，实为该 runner 读了 stdout。今后凡「诊断缺失」先查取的是哪个流。
2. **`tools/reverify-seed.json`（主线程独占）**：给「依赖预置文件 / 依赖 argv」的题注入运行前置，使原本不可自动复验的题重新进入可复验集合。
   实测：题12.43 播种后 **MATCH**，据此把它从「不可复验」定案为已验证。
3. **`tools/reverify-blindspot.json`（主线程独占）**：登记**永久不可自动复验**的题（如题12.41 依赖终端交互），`reverify2` 对其报「盲区」而非「MISMATCH」，
   且其 `expectedVerified` 保持 false，**不得为凑数改标**（改标≠完成）。
4. **`runtimeStdout` 写入必须用 `raw.replace(/(\r?\n)+$/, '')`** 只剥末尾换行；`reverify2.norm()` 只用于比对，
   **绝不可**拿它的返回值回写入库（会连每行行尾空格一起剥掉，与 §12-2 口径冲突）。
5. **网络失败单独计数**（汇总行的「网络失败 N」），不与 MISMATCH 混计；`ConnectTimeoutError` 不得使整批复验崩溃。
6. **改工具的固定四步**：`node --check` 语法自检 → 备份 `.bak` → 用**语句边界锚**替换并以 `split(n).length-1===1` 确认锚点唯一 → 提权安装 → 实跑验证。
   教训：锚点落在字符串字面量内部会让工具直接 `SyntaxError: Invalid left-hand side expression in postfix operation`，且报错位置离真实改动点很远。
7. **提权口径**：`node_repl` 对提取目录是静默只读（`writeFileSync` 不报错也不落盘），任何写 `D:\C-practice-extract\` 的动作必须走提权 node；
   落盘脚本一律先 `Copy-Item` 到 `%TEMP%` 再执行（viz 的三段日期路径在审批弹窗里会被改写成形似的横杠日期路径 ⇒ 必然找不到文件而超时）。

## 14. Godbolt 容器文件 I/O 与 argv 手法（2026-09-08 00:34 主线程 · 源自 BD06 实测）

1. **容器运行目录可写**：`cg132` 的执行沙箱允许 `fopen(...,"w")` 建立文件，并在**同一请求内**`fclose` 后重开读回。
   文件只存在于该次请求的容器 cwd，请求结束即销毁、本地无残留 ⇒ 第 12 章「读文件/写文件」类题可照常取 `expectedStdout`，
   不需要退化为「预存 expected + 学生自评」。
2. **argv 手法**：题面依赖命令行参数时，在参考程序 `main` 内自构造参数数组
   （例 `char *argvv[] = {"e12_48", "e12_48.txt", NULL};`）后代入被测逻辑；`note` 必须写明
   「实机以自构造 argv 复验，原题为命令行参数」。
3. **播种文件法**：需要预置数据文件的题，让程序**先自写再读回**（seed 段与题面逻辑同处一个源文件），避免依赖外部文件系统状态；
   若题面要求固定盘符/绝对路径，改成运行目录相对路径，并在 `note` 记录与题面的差异。
4. **凭据硬口径**：`code` 为 `null` 而 `expectedVerified=true` 的题（典型＝编程题），凭据**必须**能在该批 `*.report.md` 第 5 节找到
   （逐请求真实 stdout + 耗时 + 参考程序源码全文），否则按「改标≠完成」退回 `false`。
5. **`reverify2` 对 `code=null` 的题报「编程题无参考代码入库，无法离线复验（凭据在 report）」属正常跳过**，
   不计 MISMATCH、不计网络失败。

## 15. Godbolt 响应形态与 stdout 规范化（2026-09-08 主线程实测 · 阶段 4 前端必读）

1. **响应是扁平的，没有 `execResult` 包裹层**（`POST /api/compiler/cg132/compile`，payload 同时给
   `compilerOptions.executorRequest:true` + `filters.execute:true`，`userArguments:'-std=c99 -w -O0'`）：
   - `buildResult.code` ＝ 编译退出码（≠0 → compile-error，诊断文本在 `buildResult.stdout[].text` / `buildResult.stderr[].text`）
   - 顶层 `code` ＝ 进程退出码；`timedOut` / `truncated` / `didExecute` / `execTime` 全在顶层
   - `stdout` / `stderr` ＝ **按行的数组** `[{text:"..."}]`，不是字符串
   实测踩坑：误按 `j.execResult.stdout` 取值 → 30/30 组全部拿到空串、`exit=undefined`，而 `j.execResult||{}` 兜底
   不抛错，**静默全废**。前端解析器必须断言 `didExecute===true && truncated===false`，并把「取到空 stdout」当异常而非通过。
2. **stdout 规范化（`expected` 一律按此口径存）**：`(j.stdout||[]).map(o=>o.text).join('\\n')`
   - 末尾换行被后端丢弃：`printf("a\\nb\\nc\\n")` → `"a\\nb\\nc"`
   - 行首空行保留：`printf("\\ninput 10 scores:")` → `"\\ninput 10 scores:"`
   - 行中空行保留：`printf("x\\n\\ny")` → `"x\\n\\ny"`
   - 行尾空格保留：`printf("%3d ", v)` 的尾空格会进 `expected`（题6.58 每行以空格结尾）
   - stderr 不进 stdout；非 0 退出码（顶层 `code`）单独判，不靠 stdout 比对
3. **`accepted` 备选答案的「上下文有效性」铁律**：备选代入骨架后必须 ① 语法正确 ② 语义等价，否则删除。
   本轮剔出三个真实反例：
   - `if(【3】==0)` 里填 `i%3==0` → 实际成 `((i%3==0)==0)`，**语义翻转**（正确答案是 `i%3`）
   - `if (【2】) 【3】` 后紧跟另一条语句，填 `printf("\\n")`（缺分号）→ **语法错误**（正确答案须带分号）
   - `for(【2】i++)` 里填 `i=16;i<=31`（缺末尾分号）→ **语法错误**（正确答案 `i=16;i<=31;`）
   反之 `else 【3】;` 里填 `y=-1;` 合法（多一个空语句），可列为备选。
4. **10 道 code_completion rescue 口径**：`rescued/cc10.json`（人工补 solution + 3 组 testCases，30/30 组 `-O0`
   实机复验，stdout 与**独立重算模型**预测逐字一致）→ `scripts/convert-to-schema.mjs` 的 `RESCUE` 加载器按
   `originalId` 命中 → 直接产出合规 `code_completion`（converter 会打印 `rescue: loaded=10 applied=10`，未命中会 ★UNUSED 告警）。
   **`verified` 仍未写**（只能由 `npm run judge:verify` 置位，AGENTS.md 二·7）；证据落在
   `converted/_judge-evidence.json` 中带 `rescueFile` 标记的那 10 条（逐用例 stdin / expected / exitCode / predMatch）。
