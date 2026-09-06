# 项目：C practice

C 语言 + 数据结构在线学习平台。纯静态网站，最终部署到 GitHub Pages。

---

## 一、项目定位

不是单纯的刷题站，而是三大板块联动的学习平台：

| 板块 | 作用 | 用户心智 |
|---|---|---|
| 📖 知识点汇总 | 学 | "这个概念是什么" |
| 🎬 可视化演示 | 懂 | "它是怎么工作的" |
| ✍️ 在线刷题 | 练 | "我会不会用" |

三者通过 `knowledgeIds` / `vizIds` / `relatedProblems` **双向关联**：
知识卡片 → 跳转演示 → 跳转题目 → 回指知识卡片。

---

## 二、硬性约束（不可违反）

### 架构
1. **纯静态、无后端** —— 必须能部署在 GitHub Pages
2. **不得引入任何需要服务端运行时的方案**
3. **用户进度用 `localStorage` 保存**
4. **数据以 JSON 文件存放**，按章节分片 + 索引文件，前端懒加载

### 编译
5. 编译引擎用 **Compiler Explorer（Godbolt）公共 API**，浏览器直连
   （2026-09-06 用户裁决一。原 Piston 公共 API 自 2026-02-15 起对非白名单请求返回 401；
   Wandbox 三次探测全部 504。理由：本项目要开源，不能依赖个人自建实例）
   - 端点：`POST https://godbolt.org/api/compiler/cg132/compile`，免 API Key
   - 编译参数固定 `-std=c99 -Wall -Wextra`
   - **取运行时 stdout 必须同时给 `executorRequest: true` 与 `filters.execute: true`**
     （双执行开关，少一个只有汇编/编译产物）
   - **实测限流：Godbolt 是排队不是限流，且并发越高吞吐越低**
     （串行 ≈ 1.36 QPS，并发 20 跌到 0.52 QPS）→ **多组测试用例一律严格串行，禁止并发**；
     参数 `maxConcurrency: 2` + FIFO 队列 + `minIntervalMs: 100`
   - **软超时 25 s，必须 > Godbolt 自身 ~20 s 执行时限**（实测挂死程序 `execTime` 20154 / 20357 ms）；
     两个 20 s 相撞会把「运行超时」误判成「后端不可用」
   - **判分顺序固定**：`buildResult.code != 0 → compile-error` → `timedOut → timeout` →
     退出码 → 输出截断。顶层 `code = -1` 有**双重含义**（编译失败 / 运行时被信号杀死），
     必须靠 `buildResult` 区分
   - **降级模式必须实现**：后端不可用时读构建期预存 stdout 让学生自评，
     不计正确率、不置 verified，绝不伪造「通过」
   - 编译层抽象成独立模块 `JudgeBackend`（`src/judge/`），后端**可切换**：
     `BACKENDS` 注册表 + `getBackend()` + `registerBackend()`，新增后端按契约补一个适配器即可

### 代码
6. **题目代码必须是标准 C**
   - ❌ 禁用 C++ 语法（`&` 引用、`new`/`delete`、`cin`/`cout`）
   - ❌ 禁用严蔚敏教材的"类C伪码"
   - ❌ 禁用 `gets()`、`conio.h`、`getch()`、`system("pause")` 等非标准内容
7. **所有代码类题目必须经 Godbolt 实机验证**，通过后才可置 `verified: true`
   —— 由 `npm run judge:verify` 真实编译 + 执行 + 比对后写入，并把真实 stdout 与逐请求耗时
   存档进 `public/data/problems/verification-report.json`；**禁止手工置 true**
   （`verify-data.ts` 会用 `VERIFIED-NO-PROOF` 反查报告里查无记录的 verified 标记）
   - **后端抖动（HTTP 5xx / 网络失败）= 「未判定」，不是「失败」**：该题 `verified` 一个字节都不改，
     报告里的成功证据走 `last_known_good` 只增不减（2026-09-06 真实 502 曾把一道已验证题悄悄翻回 false）；
     传输层错误串行复跑 2 轮，内容错误（编译失败/输出不符）不重试；进程退出码仍为 1，闸门不放行

---

## 三、主力题型（占题量 80%）

| 题型 | type 值 | 判分 |
|---|---|---|
| 程序填空 | `code_completion` | 补全后跑测试用例 |
| 程序改错 | `debug` | 修正后跑测试用例 |
| 程序阅读写结果 | `code_reading` | 比对真实运行输出 |
| 编程题 | `programming` | 多组测试用例 |

辅助题型（20%）：`single_choice` `true_false` `fill_blank`
`code_ordering` `complexity` `short_answer` `matching`

**每道题必须带 `explanation` 详解。**

---

## 四、规范文件（出题/写知识点前必读）

本目录下：

| 文件 | 何时读 |
|---|---|
| `00_任务书.md` | 项目启动 |
| `01_知识大纲_C语言.md` | 确定 C 语言章节与考点 |
| `02_知识大纲_数据结构.md` | 确定数据结构章节与考点 |
| `03_真实题目原文.md` | **建立"什么算好题"的质量直觉** |
| `04_题型规范与样例.md` | 写任何一道题之前 |
| `05_教材代码风格约定.md` | 写任何 C 代码之前 |
| `06_变式出题方法论.md` | 由教材内容生成新题时 |
| `07_可视化演示规范.md` | 实现演示功能时 |
| `08_知识点汇总规范.md` | 编写知识点卡片时 |
| `schema/Problem.schema.json` | 输出题目 JSON 前 |
| `schema/Knowledge.schema.json` | 输出知识卡片 JSON 前 |

---

## 五、关键提醒

### ⚠️ 教材代码不可直接抄
- 严蔚敏教材是**类C伪码**，不能编译
- 大话数据结构 PDF 的 OCR 代码有错（如 `typedef stru'ot`）
- **用自己的 C 语言知识写正确代码，不要抄录教材正文**

### ⚠️ 版权
- `03_真实题目原文.md` 中的原题仅作**风格参考**，不得照抄进仓库
- 题目依据教材知识点体系变式生成
- `source` 字段如实注明出处

---

## 六、协作规则

1. **每个阶段开始前**，先用 3 句话说明要改动哪些文件、各负责什么，我确认后再动手
2. **不要改动上一阶段已验证通过的文件**，确需改动先说明原因
3. **每个阶段结束**，给出本地验证方法与命令
4. **提交信息用中文**
5. 遇到规范文件未覆盖的情况，先问我，不要自行发挥

---

## 七、技术建议（供参考，可与用户商议）

- 框架：Vite + React + TypeScript
- 编辑器：CodeMirror 6（体积小于 Monaco）
- 可视化：**SVG + React**，算法写成 Generator 产出 Step 快照
  （不推荐 D3——本场景用不到其数据绑定能力，体积 ~90KB）
- 搜索：MiniSearch 等纯前端方案
- 编译：Godbolt 浏览器直连（详见第二节第 5 条与 `docs/adr/0001-judge-backend.md`），
  封装为独立模块 + **串行**请求队列
