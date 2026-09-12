# NEXT_SESSION —— 交接说明（更新于 2026-09-13 收尾轮）

> **状态：总任务的 4 个阶段（A/B/C/D1/D2）+ 收尾轮全部完成，无未竟工作。**
> 本文件不再是「断点续接」说明，而是「下一轮内容规划」的起点。

---

## 一、已完成（含提交号）

| 阶段 | 内容 | 提交 |
|---|---|---|
| 基线 | 1024 题（C 语言 1023 + DS 种子 1） | `c7fec12~1` |
| A | 数据结构 8 专题 **+449 题**（连同种子共 450） | 阶段 A 系列提交（见 `git log`，至 `b61b32b` 之前） |
| B | C 语言 12 章变式 **+601 题**（ch02=51，其余各 50） | 至 `b61b32b` |
| C | `_staging` 存疑 **38 道清零**（32 道实机取证自包含化 + 6 道改 Path B 描述题） | `cc40021` |
| D | 全量 `judge:verify`：**1078 道代码题全 PASS**，0 FAIL / 0 inconclusive | `35c7dcb` |
| D2 | 掌握度热力图、每日一题/随机练习入口、`report:ratio` 配比报告、ADR-0001 死代码清理 | `35b9026` |
| D1 | 全站终验全绿（9 套验收 9/9、20 题浏览器实判 21/21、a11y 34 次体检 0 问题、`docs/全站终验报告.md`） | `2d59bc0` |
| 收尾 | 存疑标记复审 + OCR 残留清理（详见下） | 本次提交 |

### 收尾轮做了什么
1. **6 道 `[?]` OCR 残缺补正 + Godbolt cg132 实机复核 12/12 PASS**：
   `c-ch04-sc-033`、`c-ch05-sc-009`、`c-ch09-fb-013`、`c-ch10-sc-018`、`c-ch10-sc-031`、`c-ch12-sc-019`；
   另补验 `c-ch10-sc-023`（`n+ +`→`n++`）。7 题 explanation 均加「实机复核」留痕。
2. **21 处全角/误识 OCR 残留清理**（仅题面与选项）：`一>`→`->`（16 题 49 处）、`″`→`"`、`＋`→`+`、
   `＊`→`*`、`p+ +`→`p++`、`q>link`→`q->link`、`＝＝`→`==`，集中在 c-ch09/10/12。
3. **新增闸门** `scripts/scan-doubt-markers.mjs`（`npm run scan:doubt`）：表面文本（stem/options/blanks/
   answer/solution/codeTemplate/testCases）命中 `[?]`/存疑/待裁决/待确认/TODO/`一>`/`″` 等即 exit 1；
   explanation 里的知情注记只计数。当前 **表面 0 残留 / 元信息注记 44 处 40 题（设计内保留）**。
4. 闸门复跑全绿：`verify:data` error 0 / warn 6、`typecheck`、`build`、`verify:pages`、`build:index`、acceptance 9 套件。

---

## 二、最终题量（权威数字，勿再重算）

- **全库 2074 道 = C 语言 1624 + 数据结构 450**
- C 分片：ch01=62 ch02=122 ch03=105 ch04=161 ch05=157 ch06=187 ch07=131 ch08=106 ch09=246 ch10=143 ch11=101 ch12=103
- DS 分片：ch01=30 ch02=70 ch03=60 ch04=40 ch05=80 ch06=60 ch07=50 ch08=60
- 题型配比：主力 1084 = **52.3%**（code_completion 354 / debug 54 / code_reading 514 / programming 162），辅助 990 = 47.7%
- `verified: true` 2068 道；未置位 6 道 = Path B 描述题（`c-ch03-cr-017/018`、`c-ch04-cr-004/011/012`、`c-ch11-cr-016`），
  即 `verify:data` 长期 warn 6 的唯一来源，**设计内永久保留，不要去「修」**

---

## 三、下一轮若要继续，建议按此优先级

1. **主力题型占比 52.3% → 80%**：缺口约 570 道。优先补 `debug`（改错）与 `code_completion`（填空），
   这两类改造成本低（可由现有 code_reading 题反向构造：把正确程序挖空/植入典型错误）。
2. **DS 无 `debug` 题**（54 道全在 C 语言）：为 DS 8 章各补 5~8 道改错题（链表越界、递归缺终止、
   循环队列判空判满混淆、排序边界 off-by-one 等经典错误）。
3. **`complexity` 题型仅 9 道**（全在 DS 绪论）：把散落在 single_choice 里的复杂度推导题迁归该题型，便于统计。
4. 每次扩库后固定跑：`build:index → verify:data → judge:verify → scan:doubt → acceptance:all`。

---

## 四、续接第一步（新会话第一条命令）

```powershell
cd D:\C-practice
git log --oneline -3
npm run verify:data      # 期望：题目总数 2074 · error 0 · warn 6
npm run scan:doubt       # 期望：表面文本 0 残留，exit 0
```
三条都符合预期即说明仓库处于健康交付态，可直接开始下一轮内容规划。

---

## 五、踩坑记录（务必读，能省数小时）

1. **Godbolt 是排队不是限流**：并发越高吞吐越低（串行 ≈1.36 QPS，并发 20 跌到 0.52 QPS）。
   多组测试用例**一律严格串行**，间隔 ≥120 ms。
2. **取运行时 stdout 必须同时给 `executorRequest: true` 与 `filters.execute: true`**，
   且 `executeParameters` 必须放在 `options` 层级下；响应是扁平的，**没有 `execResult` 包裹层**，禁止兜底猜测。
   断言 `didExecute===true && truncated===false`，stdout 用 `(j.stdout||[]).map(o=>o.text).join('\n')` 归一。
3. **软超时必须 25 s**：Godbolt 自身执行时限 ~20 s，两个 20 s 相撞会把「运行超时」误判成「后端不可用」。
4. **顶层 `code = -1` 有双重含义**（编译失败 / 运行时被信号杀死），必须靠 `buildResult.code` 区分。
5. **后端 5xx / 网络失败 = 「未判定」不是「失败」**：`verified` 一个字节都不改，
   成功证据走 `last_known_good` 只增不减（曾有一次真实 502 把已验证题悄悄翻回 false）。
6. **验收脚本别写死常量**：`acceptance-list-ui.mjs` 原先写死 TOTAL=517、章节数、难度边界、空组合，
   扩库后全部变假 FAIL；已改为从 `index.json` 现算。新增验收脚本请沿用这一做法。
7. **批跑脚本必须加看门狗**：`setTimeout(()=>process.exit(process.exitCode??0),3000).unref()`。
   否则 main() 抛异常时 Playwright browser 未 close，残留 chrome 占住 stdio 句柄，node 永不退出（曾卡死 15 分钟）。
   `scripts/acceptance-all.mjs` 用 `cmd /d /s /c` spawn + 监听 **exit** 事件 + 12 min 硬超时 `taskkill /T /F`。
8. **`verified` 只许 `judge:verify` 置位**，手工置 true 会被 `verify-data.ts` 的 `VERIFIED-NO-PROOF` 反查抓出。
9. **改题目 JSON 用「parse → 改 → JSON.stringify(obj,null,2)+'\n'」**：全部分片都是这个格式，
   round-trip 逐字节相同，diff 最小；不要用正则直接改文件文本。
10. **一次性补丁脚本放 `tmp/`（gitignore）**，可复用的固化为 `scripts/*.mjs` + package.json 别名。
11. 教材原文不可直接抄：严蔚敏是类 C 伪码；大话数据结构 PDF 的 OCR 代码有错（如 `typedef stru'ot`）。
    书末答案与实机冲突时**以实机为准**，并在 explanation 注明原书答案。
