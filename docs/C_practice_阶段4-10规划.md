# C practice 阶段 4–10 实施规划

> 本文件是阶段 4 起的路线图。放到项目 `docs/` 下，可作为长期参照。
> 所有阶段沿用既有硬约束（Godbolt 后端、标准 C、纯静态、expected 实机验证）。

---

## 一、当前位置（2026-09-06）

```
[✅] 阶段 0   Godbolt spike
[✅] 阶段 1   站点骨架（Vite+TS+Tailwind+HashRouter+主题）
[✅] 阶段 2   编译模块 + JudgeLab 试验台
[✅] 阶段 3   数据管线 + 3 道种子题
[🔄] 题库     总账 + 校验脚本 + 全量提取（进行中）
[ ] 阶段 4    4 种主力题型闭环
[ ] 阶段 5    辅助 7 题型 + 进度体系
[ ] 阶段 6    知识库板块
[ ] 阶段 7    Viz 内核
[ ] 阶段 8    排序可视化全家桶
[ ] 阶段 9    剩余可视化 A–H
[ ] 阶段 10   三向联动 + 打磨 + 题库整合
```

---

## 二、题库提取与主线开发的节奏

全量 328 页视觉提取是**长任务**，不建议阻塞主线。建议交替推进：

| 时点 | 动作 |
|---|---|
| 现在 | Codex 建题号总账 + `verify-extract.mjs` + 提取第 1–3 章（约 100 题） |
| 第 1–3 章完成 | **暂停提取 → 切阶段 4**（用这 100 题测 4 种题型渲染器） |
| 阶段 4 完成 | 继续提取第 4–6 章，同时进入阶段 5 |
| 阶段 5–6 | 章节提取穿插推进，优先完成指针/数组/函数三章（占全书 50%+） |
| 阶段 10 | 题库全量整合、统一跑 `judge:verify` |

**为什么不等 1000 道全提完再开阶段 4**：题型渲染器的代码逻辑与题目数量无关，
有 50–100 道就足够测试。early feedback 比 late rework 便宜得多。

---

## 三、阶段 4：刷题闭环（4 种主力题型）

### 目标
学生能打开题目、写代码/填空/改错/读程序，提交后看到判分结果与详解。

### 产出
1. `src/pages/ProblemListPage.tsx` —— 题目列表（按章节/难度/题型筛选 + 搜索）
2. `src/pages/ProblemDetailPage.tsx` —— 题目详情 + 提交区
3. **程序填空空位 widget** —— CodeMirror 的 `Decoration` 把 `/*__BLANK_1__*/`
   渲染成可 Tab 跳转的行内输入槽（这是四个主力题型里最刚需的能力）
4. `src/modules/problems/grading/` —— 判分器：
   `exact`（阅读题比对）/ `stdin-run`（编程题多用例）/ `blank-match`（填空等价写法）
5. `src/modules/problems/renderers/` —— 4 个主力题型渲染器
6. 结果展示：用例级通过情况 + 输出 diff + `explanation`（默认折叠）

### 验收（机器可判定）
- 4 种题型各取 1 道真题：**故意答错 → 看到用例级失败详情；答对 → 判分通过**
- 程序填空输入 `*(p--)` / `*p--` 等等价写法均被接受（`accepted` 数组生效）
- 编程题多组用例**串行**执行（禁止并发，Godbolt 并发会恶化到 22–38s/请求），
  UI 显示「第 N/M 组」进度
- 判分结果写入 `localStorage`，刷新页面后答题记录仍在
- 控制台 error/warn 为空

### 关键约束
- 判分顺序不得先看顶层 `code`（`-1` 同时表示编译失败与超时）：
  `buildResult.code≠0`→compile-error ▸ `timedOut`→TLE ▸ `code≠0`→RE ▸ `truncated`→转自评 ▸ 否则比 stdout
- stdout 归一化：CRLF→LF、逐行剥离行尾空白、剥离末尾换行
- 软超时 25s（不得 ≤20s，与 Godbolt 自身 20s 相撞）

### 工作量
约 1–2 天有效对话

### 启动话术
```
【阶段 4：刷题闭环（4 种主力题型）】

目标：学生能打开题目、作答、提交后看到判分结果与详解。

产出：
1. src/pages/ProblemListPage.tsx —— 题目列表，支持章节/难度/题型筛选
2. src/pages/ProblemDetailPage.tsx —— 题目详情 + 提交区
3. 程序填空空位 widget —— 用 CodeMirror 的 Decoration 把
   /*__BLANK_1__*/ 渲染成可 Tab 跳转的行内输入槽
4. src/modules/problems/grading/ —— 三个判分器：
   exact（阅读题比对输出）、stdin-run（编程题多用例串行）、
   blank-match（填空题等价写法匹配）
5. src/modules/problems/renderers/ —— code_completion / debug /
   code_reading / programming 四个渲染器
6. 结果展示：用例级通过情况 + 输出 diff + explanation（默认折叠）

验收标准（必须逐条实测，贴出真实输出）：
- 4 种题型各取 1 道真题：故意答错能看到用例级失败详情，
  答对能判分通过
- 程序填空输入 *(p--) 与 *p-- 等等价写法均被接受
- 编程题多组用例串行执行，UI 显示「第 N/M 组」进度，
  实测总耗时
- 判分结果写入 localStorage，刷新后仍在
- 控制台 error/warn 为空

硬约束：
- 判分顺序：buildResult.code≠0 → compile-error ▸ timedOut → TLE
  ▸ code≠0 → RE ▸ truncated → 转自评 ▸ 否则比 stdout
  不得先看顶层 code（-1 同时表示编译失败与超时）
- stdout 归一化：CRLF→LF、逐行剥离行尾空白、剥离末尾换行
- 软超时 25s
- 多组用例禁止并发

用第 1-3 章已提取的题目做测试，不要新造题目。
每阶段开始前用三句话说明要改哪些文件，我确认后再动手。
完成后给我本地验证命令。
```

---

## 四、阶段 5：辅助 7 题型 + 进度体系

### 目标
补全题型覆盖，建立完整的学习追踪闭环。

### 产出
1. 7 个辅助题型渲染器：
   `single_choice` / `true_false` / `fill_blank` / `code_ordering` /
   `complexity` / `short_answer` / `matching`
2. `src/modules/progress/` —— 进度体系：
   - 答题历史、正确率、按章节掌握度
   - 错题本（自动收集 + 重做 + 移除）
   - 收藏/标记
   - **导出/导入 JSON**（换浏览器不丢进度）
   - `schemaVersion` + migrate 链（一开始就要有，否则将来改结构必炸）
3. `src/pages/ProgressPage.tsx` —— 进度统计可视化

### 验收
- 清 `localStorage` → 答题 → 刷新 → 进度保留
- 导出 JSON → 换浏览器导入 → 进度与错题**完全一致**
- 7 个判分器各有单测覆盖边界情况
- 不可判分题（如 `short_answer`、依赖 argv 的题）明确标记为自评，
  **不伪造 testCases**

### 工作量
约 1 天

### 启动话术
```
【阶段 5：辅助 7 题型 + 进度体系】

产出：
1. 7 个辅助题型渲染器：single_choice / true_false / fill_blank /
   code_ordering / complexity / short_answer / matching
2. src/modules/progress/ —— 答题历史、正确率、按章节掌握度、
   错题本（自动收集+重做+移除）、收藏标记、
   导出/导入 JSON、schemaVersion + migrate 链
3. src/pages/ProgressPage.tsx —— 进度统计可视化

验收：
- 清 localStorage → 答题 → 刷新 → 进度保留
- 导出 JSON → 换浏览器导入 → 进度与错题完全一致
- 7 个判分器各有单测覆盖边界
- 不可判分题（short_answer、依赖 argv 的题）标记为自评，
  不伪造 testCases

注意：schemaVersion 与 migrate 链从一开始就要有，
否则将来改数据结构会导致老用户进度全部损坏。

每阶段开始前用三句话说明要改哪些文件，我确认后再动手。
```

---

## 五、阶段 6：知识库板块

### 目标
打开就能直观看到、可检索、示例代码可直接运行的知识库。

### 产出
1. `src/modules/knowledge/` —— 加载、类型、导航树、卡片渲染
2. `src/pages/KnowledgeTreePage.tsx` / `KnowledgeCardPage.tsx`
3. 卡片渲染：`summary` / `content` / `keyPoints` / `pitfalls` /
   `examples`（可运行）/ `tables` / `complexity`
4. **示例代码一键运行**（调 Godbolt）+ 复制按钮
5. 语法速查：`public/data/reference/`（32 关键字、运算符优先级全表、
   数据类型范围、转义字符、printf/scanf 格式符、库函数索引）
6. 数据结构对比表：顺序表 vs 链表、**排序算法总表**、查找算法对比、
   邻接矩阵 vs 邻接表
7. MiniSearch 全局搜索（索引构建期生成，首次进搜索页才加载）
8. 已读标记（localStorage）

### 内容规模与分批
**350–420 张卡片**（按「节」粒度）。**禁止一次做完**，分批：

| 批次 | 内容 | 卡片数 |
|---|---|---|
| 第一批 | **指针专题**（最大考点，含指针运算/数组/函数/多级指针/动态内存） | ~40 |
| 第二批 | 数据类型与运算符、控制结构 | ~50 |
| 第三批 | 数组与字符串、函数 | ~50 |
| 第四批 | 结构体、文件、预处理、位运算 | ~40 |
| 第五批 | 线性表、栈与队列 | ~40 |
| 第六批 | 树与二叉树 | ~45 |
| 第七批 | 图 | ~35 |
| 第八批 | 查找、排序 | ~40 |
| 第九批 | 串、复杂度分析、绪论 | ~30 |

### 验收
- 搜索「指针与数组」能命中指针卡片
- 点示例代码「▶ 运行」能出真实 stdout
- 导航树节点计数 == `index.json` 条目数（脚本断言）
- 首屏不含知识数据全量（懒加载生效）
- 每张卡片 3–6 个 `keyPoints`、至少 1 个可运行 `example`

### 工作量
约 2–3 天（内容生成占大头）

### 启动话术
```
【阶段 6：知识库板块】

产出：
1. src/modules/knowledge/ —— 加载、类型、导航树、卡片渲染
2. src/pages/KnowledgeTreePage.tsx / KnowledgeCardPage.tsx
3. 卡片渲染：summary / content / keyPoints / pitfalls /
   examples（可运行）/ tables / complexity
4. 示例代码一键运行（调 Godbolt）+ 复制按钮
5. public/data/reference/ 语法速查：32 关键字、运算符优先级全表、
   数据类型范围、转义字符、printf/scanf 格式符、库函数索引
6. 对比表：顺序表 vs 链表、排序算法总表、查找算法对比、
   邻接矩阵 vs 邻接表
7. MiniSearch 全局搜索（索引构建期生成，进搜索页才加载）
8. 已读标记（localStorage）

内容规模 350-420 张，按节粒度。分 9 批推进，禁止一次做完：
第一批先做【指针专题】（约 40 张，最大考点），我验收后
再推进后续批次。

先交付：框架代码 + 第一批指针卡片 + 语法速查表。
验收后再继续。

验收标准：
- 搜索「指针与数组」命中指针卡片
- 点示例代码「▶ 运行」出真实 stdout
- 导航树节点计数 == index.json 条目数（脚本断言）
- 首屏不含知识数据全量
- 每张卡片 3-6 个 keyPoints、至少 1 个可运行 example

符合 schema/Knowledge.schema.json，id 用 c-xxx / ds-xxx 格式。
```

---

## 六、阶段 7：Viz 内核

### 目标
建立可视化的核心抽象，用 1 个演示验证整套机制。

### 产物（严格照 `07_可视化演示规范.md`）
```typescript
interface VisualState { kind, nodes, edges, pointers, memory,
                        counters, callStack, annotations }
interface Step<S> { snapshot, description, highlights,
                    codeLines, metrics, phase, checkpoint, status }
type Algorithm<Input,S> = (input: Input) => Generator<Step<S>,void,void>
interface PlayerApi<S> { step, index, total, playing, speed,
                         play, pause, toggle, reset, next, prev,
                         seek, seekToLine, setSpeed, setDelay }
type VizRenderer = React.FC<RendererProps>
```

### 产出文件
1. `src/modules/viz/core/` —— `step.ts` / `player.ts` / `usePlayer.ts` / `registry.ts` / `types.ts`
2. `src/modules/viz/controls/` —— `ControlBar` / `SpeedMenu` / `DataEditor` / `StepCaption` / `CodeSync`
3. `src/modules/viz/renderers/SortBoard.tsx`
4. `src/modules/viz/algorithms/sorting/bubbleSort.ts`
5. `src/pages/VizDetailPage.tsx`
6. 单测：`tests/viz-steps/`（步数 / description / golden 快照）

### 关键技术点（必须实现）
- **后退 O(1)**：`prev()` 只是 `index--`，靠快照数组，不做逆运算
- **RAF 驱动**：`requestAnimationFrame` + 累积时间，不用 `setInterval`（丢帧）
- **有界生成**：`maxSteps` 默认 2000，触顶显示「≥2000 步」
- **算法层零 React / 零 DOM / 零定时器** —— 可单测、可 golden 快照
- **布局与渲染分离**：`viz/layout/*.ts` 是纯函数 `(nodes,edges) => nodes-with-xy`

### 验收
- `npm run test:viz` 通过（步数 / description / golden 快照）
- 页面上：播放、暂停、单步前进、单步后退、0.5×–4×、重置全部可用
- **后退 100 步画面完全一致**（这是"不做逆运算"的直接验证）
- 深色模式下 SVG 清晰

### 工作量
约 1 天

### 启动话术
```
【阶段 7：Viz 内核】

严格照 07_可视化演示规范.md 实现核心抽象。

产出：
1. src/modules/viz/core/ —— step.ts / player.ts / usePlayer.ts /
   registry.ts / types.ts
2. src/modules/viz/controls/ —— ControlBar / SpeedMenu /
   DataEditor / StepCaption / CodeSync
3. src/modules/viz/renderers/SortBoard.tsx
4. src/modules/viz/algorithms/sorting/bubbleSort.ts
5. src/pages/VizDetailPage.tsx
6. 单测 tests/viz-steps/（步数 / description / golden 快照）

必须实现的关键点：
- 后退 O(1)：prev() 只是 index--，靠快照数组，不做逆运算
- RAF 驱动：requestAnimationFrame + 累积时间，不用 setInterval
- 有界生成：maxSteps 默认 2000，触顶显示「≥2000 步」
- 算法层零 React / 零 DOM / 零定时器，可单测
- 布局与渲染分离：viz/layout/*.ts 是纯函数

验收：
- npm run test:viz 通过
- 页面：播放/暂停/单步前进/单步后退/0.5x-4x/重置 全部可用
- 后退 100 步画面完全一致（这是"不做逆运算"的直接验证）
- 深色模式下 SVG 清晰

本阶段只做冒泡排序这一个演示，验证机制，不做其他。
```

---

## 七、阶段 8：排序可视化全家桶

### 目标
8 种排序算法 + 多算法同屏对比（最有说服力的教学形式）。

### 产出
`algorithms/sorting/`：`bubble` / `insertion` / `selection` / `shell` /
`merge` / `quick` / `heap` / `radix`

每种要素：
- 柱状图（高度 = 数值）
- 颜色语义：**比较中**（黄）/ **交换**（红）/ **已就位**（绿）/ **基准元**（蓝）
- 统计面板：比较次数、交换次数、移动次数
- 控制：播放/暂停、单步前后退、速度 0.5×–4×、重置
- 数据：随机生成（带 seed 可复现）/ 手动输入 / 预设（逆序、已排序）
- **代码同步高亮**：右侧显示 C 代码，高亮当前执行行

### 对比模式
选中多种算法，用同一组数据同步跑，横向对比步数与耗时。

### 验收
- n=50 时帧率 ≥30fps（Performance 面板实测）
- 对比模式 4 算法同时跑，主线程不卡
- 随机数组可复现（seed）
- 8 种算法的步数/description 各有 golden 快照

### 工作量
约 1–2 天

### 启动话术
```
【阶段 8：排序可视化全家桶】

产出 algorithms/sorting/ 下 8 种：
bubble / insertion / selection / shell / merge / quick / heap / radix

每种必须包含：
- 柱状图（高度 = 数值）
- 颜色语义：比较中(黄) / 交换(红) / 已就位(绿) / 基准元(蓝)
- 统计面板：比较次数、交换次数、移动次数
- 控制：播放/暂停、单步前后退、速度 0.5x-4x、重置
- 数据：随机生成（带 seed 可复现）/ 手动输入 /
  预设（逆序数组、已排序数组）
- 代码同步高亮：右侧显示 C 代码，高亮当前执行行

对比模式：选中多种算法，用同一组数据同步跑，
横向对比步数与耗时。

验收：
- n=50 时帧率 ≥30fps（Performance 面板实测，贴出数据）
- 对比模式 4 算法同时跑，主线程不卡
- 随机数组可复现（seed）
- 8 种算法各有 golden 快照
- AVL 旋转所需的 tree layout 工具一并建好（阶段 9 要用）
```

---

## 八、阶段 9：剩余可视化 A–H

### 目标
补齐 `07_可视化演示规范.md` 中 A–H 的全部演示（约 30 个组件）。

### 清单

| 组 | 演示 | 数量 |
|---|---|---|
| **A 线性表** | 单链表、双向链表、循环链表、顺序表 vs 链表对比 | 4 |
| **B 栈与队列** | 顺序栈、链栈、循环队列（`front==rear` 歧义）、括号匹配、表达式求值 | 5 |
| **C 树** | 四种遍历、BST 插入删除、**AVL 四种旋转拆解**、哈夫曼构造、线索二叉树 | 6 |
| **D 图** | 邻接矩阵 vs 邻接表、DFS、BFS、Prim、Kruskal、Dijkstra、拓扑排序 | 7 |
| **E 排序** | （阶段 8 已完成） | — |
| **F 查找** | 顺序、折半、BST 查找、散列表（含冲突处理） | 4 |
| **G 串** | KMP（含 next 数组推导）、BF 对比 | 2 |
| **H 指针与内存** ★ | 指针运算、多级指针、数组与指针、函数调用栈、值传递 vs 地址传递、malloc/free 与野指针 | 6 |

> ★ **H 组是 C 语言站点的差异化优势**，一般数据结构站没有，务必做。

### 分批（每批一个组，验收后再下一批）
A+B → C → D → F → H → G

### 验收
逐条走 `07_可视化演示规范.md` 第七节 **7 项验收清单**：
- [ ] 能否单步执行并后退？
- [ ] 当前步骤是否有文字解说？
- [ ] 关键状态变化是否有高亮？
- [ ] 能否自定义数据？
- [ ] 深色模式下是否清晰？
- [ ] 窄屏是否可用（至少不破版）？
- [ ] 算法逻辑是否与教材一致（命名、边界处理）？

另外：**每个 demo 至少关联 1 张知识卡 + 2 道题**（`vizIds` 双向，CI 断言不悬空）。

### 工作量
约 3–5 天（**全项目最大块**）

### 启动话术
```
【阶段 9：剩余可视化 A-H】

按 07_可视化演示规范.md 的清单补齐，分批推进：
第一批 A（线性表 4 个）+ B（栈与队列 5 个）
验收后再做 C（树 6 个），依此类推：D → F → H → G

C 组必须包含 AVL 四种旋转（LL/RR/LR/RL）的逐步拆解。
H 组（指针与内存）是本站差异化优势，务必做：
指针运算、多级指针、数组与指针、函数调用栈、
值传递 vs 地址传递、malloc/free 与野指针。

每个演示验收 7 项（照 07 规范第七节）：
1. 能否单步执行并后退
2. 当前步骤是否有文字解说
3. 关键状态变化是否有高亮
4. 能否自定义数据
5. 深色模式下是否清晰
6. 窄屏是否可用（至少不破版）
7. 算法逻辑是否与教材一致

每个 demo 至少关联 1 张知识卡 + 2 道题（vizIds 双向，
verify:data 断言不悬空）。

本轮先做 A + B，完成给我验收清单的逐项实测结果。
```

---

## 九、阶段 10：三向联动 + 打磨 + 题库整合

### 目标
把三大板块缝合成一个整体，整合全部题库，准备开源。

### 产出
1. **三向跳转闭环**：知识卡片 → 演示 → 题目 → 回指知识卡片
   - 题目带 `knowledgeIds` / `vizIds`
   - 知识卡片带 `relatedViz` / `relatedProblems`
   - 演示带 `knowledgeIds` / `problemIds`
   - **CI 双向完整性检查**：A 指向 B 而 B 不回指 A 也算 fail
2. **题库整合**：原题（~1007）+ 变式（~600），
   统一跑 `judge:verify`，失败的题单独列出修正
3. **响应式**：移动端/平板适配
4. **打磨**：404 页、深色下 SVG 配色、加载骨架屏、空状态
5. **首页学习路径**：三大板块入口 + 进度概览 + 推荐学习顺序
6. **部署准备**：`README.md`、LICENSE、GitHub Actions Pages 部署
7. **CI 加 `size-limit`**：首屏 JS ≤180KB gzip、单个数据分片 ≤120KB、
   搜索索引 ≤200KB，超线 fail

### 验收
- `npm run verify:data && npm run test && npm run build` 全绿
- 部署到 GitHub Pages 后，线上点通 20 条随机路径
- `judge:verify` 报告中代码类题目 `verified` 100%
- 三向跳转无 404、无悬空

### 工作量
约 2–3 天

---

## 十、阶段 10 之后：开源与持续迭代

### 开源发布清单
1. `README.md` —— 项目介绍、功能截图位、在线访问链接、本地开发方式、
   **题库来源说明**、如何贡献题目
2. `LICENSE` —— 建议 MIT（注意：题库为变式生成，需声明来源）
3. `CONTRIBUTING.md` —— 如何加题、加演示
4. `.github/workflows/deploy-pages.yml`
5. **版权声明**：题目依据谭浩强《C程序设计》、严蔚敏《数据结构》等教材
   知识点体系编写，由 AI 生成并人工校验中
   ⚠️ **原题不进公开仓库**，仅本地使用

### 持续迭代机制
| 内容 | 方式 |
|---|---|
| 补充题目 | Codex 批量生成 → `judge:verify` 验证 → 你抽检 |
| 补充演示 | 按 A–H 分类逐个加 |
| 补充知识卡片 | 按章节批次加 |
| 修正错误 | 用户反馈 → 标记 → 批量修 |

### 可选进阶（超出当前范围，供参考）
- 后端化：用户账号、云端同步进度（会破坏"纯静态"约束，需新建服务）
- 支持更多语言（C++、Python）
- 题目难度自适应推荐
- 社区贡献题目审核流程

---

## 十一、全局质量红线（贯穿所有阶段）

1. **每道题必须有 `explanation` 详解**（不只是答案）
2. **每章 `apply` 及以上 Bloom 层级 ≥ 40%**（CI 强制）
3. **同章内题目相似度 > 0.8 判重复，fail**
4. **`verified` 只能由脚本写入，禁止手填**
5. **`expected` 必须实机验证，禁止手推**（代码批已证明手推 9% 会错）
6. **三向引用不悬空，且必须双向**（CI 强制）
7. **标准 C，禁用类C伪码与 C++ 语法**（`lint-code.ts` 硬扫）
8. **多组用例串行，禁止并发**（Godbolt 并发会恶化到 22–38s/请求）
9. **判分顺序不得先看顶层 `code`**
10. **软超时 25s，不得 ≤20s**
11. **每阶段开始前三句话声明改动文件，我确认后再动手**
12. **不改动上一阶段已验证的文件**
13. **提交信息用中文**

---

## 十二、风险清单

| 风险 | 影响 | 规避 |
|---|---|---|
| 知识卡片 350–420 张内容生成质量不均 | 阶段 6 拖长 | 分 9 批，每批验收 |
| 可视化 30+ 组件工作量爆炸 | 阶段 9 最长 | 分批，A+B 先做验收 |
| 三向引用悬空 | 跳转 404 | CI 双向完整性检查 |
| `localStorage` 结构变更损坏老用户进度 | 数据丢失 | `schemaVersion` + migrate 链（阶段 5 就要有） |
| 题库批量验证耗时 | 阶段 10 阻塞 | 分批验证，每批 50 道 |
| GitHub Pages 子路径 404 | 线上打不开 | `base:'./'` + `verify:pages` 断言 |
| 依赖自动升级破坏已验证组合 | 构建崩 | `package.json` 锁精确版本号（去掉 `^`） |

---

## 十三、总工作量估算

| 阶段 | 工作量 | 累计 |
|---|---|---|
| 4 刷题闭环 | 1–2 天 | 1–2 天 |
| 5 辅助题型 + 进度 | 1 天 | 2–3 天 |
| 6 知识库 | 2–3 天 | 4–6 天 |
| 7 Viz 内核 | 1 天 | 5–7 天 |
| 8 排序全家桶 | 1–2 天 | 6–9 天 |
| 9 剩余可视化 | 3–5 天 | 9–14 天 |
| 10 联动打磨 | 2–3 天 | 11–17 天 |

**约 2–3 周**（有效对话时间，不含内容无限迭代）。
题库提取穿插进行，不额外阻塞。
