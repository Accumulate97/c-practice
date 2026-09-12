# NEXT_SESSION.md —— 断点续接说明（阶段B ch06 起）

> 最后更新：2026-09-12。若本文件与仓库实际状态冲突，以仓库为准（先看 git log 与题量统计）。

## 1. 当前状态（精确）
- 全库 **1724 道**，工作区干净，最新 commit `5fe812f`（阶段B ch05）。
- ✅ 阶段 A（数据结构 450 道）已完成：ds-ch01..08 = 30/70/60/40/80/60/50/60。
- ✅ 阶段 B 已完成 ch01–ch05 = **251 道变式题**（50/51/50/50/50），代码题 Godbolt 实机验证全 PASS。
- 🟡 **ch06 进行中**：`tmp/gen/v06a.mjs`（20 道 cr）+ `tmp/gen/v06b.mjs`（10 cc + 3 dbg）已写好且 `node --check` 通过，**尚未 emit**。`v06c.mjs`（6 pg + 11 概念）与 `v06.mjs`（主 emit）待写。
- ⬜ 未开始：ch07–ch12 变式（各 50 道，共 300）、阶段 C（存疑裁决 ~37 道）、阶段 D（全站终验）。

## 2. 续接第一步
1. `node -e "…统计题量…"` 核对当前分片题量（见下命令）。
2. 写 `tmp/gen/v06c.mjs` + `tmp/gen/v06.mjs`，然后：
   `node tmp/gen/v06.mjs` → `node tmp/preflight.mjs --only=c-ch06-` → `npm run build:index` → `npm run verify:data`（须 error 0）
   → 后台 `Start-Process cmd.exe "/c npx tsx scripts/judge-verify.ts --only=c-ch06- > tmp\jv06.log 2>&1"`（约 5 分钟，期间写 ch07 的 gen 文件）
   → 完成后再 `build:index` + `verify:data` → `git add -A` + 中文 commit。
3. 同节奏做 ch07–ch12：每章先查该分片既有 max ID、chapter 名、知识卡标题（`public/data/knowledge/c-chNN-*.json` 或索引）。

题量统计命令：
```powershell
node -e "const fs=require('fs');let t=0;for(const f of fs.readdirSync('public/data/problems')){if(!/^(c|ds)-ch/.test(f))continue;const j=JSON.parse(fs.readFileSync('public/data/problems/'+f,'utf8'));t+=j.problems.length;console.log(f,j.problems.length)}console.log('TOTAL',t)"
```

## 3. DSL 与流水线（固定套路，勿重新设计）
- `tmp/gl2.mjs` 导出：`emit/sc/fb/tf/cr/ccf/pgf/dbgf/cx/sa/mt` + 骨架 `PRE_SQ/PRE_LL/PRE_DL/MAIN_SQ/MAIN_LL/MAIN_LLN/PRINT_*`。
- `emit({shard,category:'c',chapter:'第N章 xxx',specs:[...]})`：自动续号（读分片 max）、自动填 id/source/verified（代码类 verified=false，只由 `judge:verify` 置位）。
- `cr({sec,d,bl,kid,tags,code,stdin,e})`：answer 自动 `@@AUTO@@`，由 `tmp/preflight.mjs` 用本地 gcc（`D:/mingw/mingw64/bin/gcc.exe`）回填真实输出。
- `ccf({sec,d,bl,full,ask,b,cases,e,tags,kid})`：`full` 里用 `@@1@@` 标空位；`b=[[答案,[接受项],[hint]]]`，**空数 ≤ 4**（schema maxItems）。
- `dbgf({...,full,ask,site,cases})`：`site=[[错写,对写,说明]]`；**bugs ≥ 2 项**（schema 强制，ch05 曾因单 bug 返工 18 个 error）。
- `pgf({...,ref,ask,inF,outF,cases})`：**解题逻辑必须写在 `int main(void)` 之前的具名函数里**，否则 code_starter 泄露完整 main。
- `tmp/gen/_h.mjs`：`mk(ch,S1)` → `{KD,SC,FB,TF}`；SC 答案传 `'A'..'D'`，TF 传 `'true'/'false'`；`fill(t,o)` 替换 `{{KEY}}`。
- 概念题配比：每章 50 道 = 39 代码（20 cr + 10 cc + 3 dbg + 6 pg）+ 11 概念（6 SC + 3 FB + 2 TF）。
- 硬坑：R`` 模板内禁止 `\'`（直接写 `'` 与 `'\0'`）；避免 `%e/%E`、裸 `long`（Win64 为 4 字节）、`M_PI`、`pow`；用 `long long`+`%lld`；数组题统一 I/O：首行 n、次行 n 个整数；写文件用 PowerShell `@'...'@` here-string + `[IO.File]::WriteAllText($p,$c,[Text.UTF8Encoding]::new($false))`。
- 某章要重来：`git checkout public/data/problems/c-chNN.json` 再修 gen 重跑（emit 是**追加**，直接重跑会重复入库）。
- preflight 报「编译失败 N」若全是既有 `cr-00x` 片段题 = 正常（属阶段 C 内容）。

## 4. ch06 事实
- 分片 `public/data/problems/c-ch06.json`，chapter=`第6章 数组`，既有 137 道；ID 上限 sc=49/fb=9/cc=32/cr=34/pg=10/dbg=9（emit 自动续）。
- 节名：代码类 `S2='6.6 变式练习（代码类）'`，概念类 `S1='6.5 变式练习（概念类）'`。
- 知识卡 `c-ch06-01..35`：01定义/03下标越界/04内存与sizeof/05输入输出/06插入删除/07逆置去重/11二维遍历/12转置/13对角线/14最值/16字符数组/17strlen与sizeof/21手写strlen/25一维数组作参数/27冒泡/31折半/32计数数组/34斐波那契应用。

## 5. 阶段 C 存疑清单（约 37 道，多为 snippet 型 code_reading）
`c-ch03-cr-004/005/006/017/018`；`c-ch04-cr-019/021/022`；`c-ch05-cr-004/005/006/007/012/020`；`c-ch06-cr-001/002/004/007/015/016/018/023/024/029`；`c-ch09-cr-051/052`；`c-ch11-cr-001/002/006/007/011/016`；`c-ch12-cr-001/002`；另有 1 道 code_reading 缺 answer。
裁决口径：①实机可验证→以实机为准；②书末答案冲突→以实机为准并在 explanation 注明原书答案；③题面与代码不符→以代码为准留痕；④印刷/OCR 缺陷→修正留痕；⑤确实无法唯一确定→`answerIsDescription:true` 或改 `short_answer`。做法：补全成完整程序后用本地 gcc/Godbolt 实机验证 → 回填 answer；目标清零。
注意：`npm run verify:data` 当前 warn 37 全部来自这批题，处理完应降到 0（或仅剩标记争议）。

## 6. 阶段 D 全站终验
总题量核对（1024 + 450 + 600 ≈ 2074）→ `npm run verify:data`（error 0）→ `npm run judge:verify` 全量 → `npm run typecheck` / `npm run build` / `npm run verify:pages` → acceptance 全套件（site-ui / list-ui / progress-ui / viz-ui / dbg-ui / subpath / stage10，脚本见 `scripts/` 与 package.json scripts）→ 随机抽 20 题浏览器实测提交（含 5 代码题 + 5 指针题）→ 控制台无 error/warn → 输出 `docs/全站终验报告.md`。
D2 有余力：备用判分后端（Piston/Wandbox 死代码，接通或明确移除）/ 掌握度热力图 / 每日一题 / 题型配比报告。

## 7. 硬约束（不可违反）
Godbolt cg132 + `executorRequest:true` + `filters.execute:true`；`executeParameters` 在 options 层级；响应扁平、禁止 execResult 兜底；断言 `didExecute===true && truncated===false`；-O0、软超时 25s、严格串行禁并发；stdout 规范化 `(j.stdout||[]).map(o=>o.text).join('\n')`；verified 只许 judge:verify 置位；**不改 schema / AGENTS.md**；代码必须标准 C（禁 gets/conio.h/getch/system("pause")/C++ 语法）。

## 8. 工作方式
无人值守、自主决策（授权清单见原始任务书：缺答案自己推导、实机优先、题面与代码不符以代码为准、OCR 错误修正留痕、歧义收敛为唯一答案或标记不判分、验证失败改等价写法重验、题型按最合适归类、新工具脚本放 tmp/）。写盘即忘、不回读已写文件、报告极简（数量+存疑数+token 估算）。每章：写盘→build:index→verify:data→judge:verify→中文 commit。

## 9. 踩坑记录
- schema 对 `debug.bugs` 要求 ≥2 项；`code_completion.blanks` ≤4 项。
- pgf 的 ref 若把逻辑写在 main 内，code_starter 会泄露答案。
- judge:verify 后端 5xx 属「未判定」，不改 verified；内容错误（编译失败/输出不符）不重试，必须自己修题。
- Windows 下 `long` 为 4 字节，涉及大数一律 `long long` + `%lld`。
- 直接重跑 gen 文件会重复入库（emit 追加），重来前先 `git checkout` 分片。