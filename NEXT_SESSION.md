# NEXT_SESSION —— 续接说明

状态：**上一轮 6 个任务（0 全量自检 / 1 GitHub 上线 / 2 3D 可视化馆 / 3 五个新板块 / 4 体验打磨 / 5 全站终验）已全部完成，无未完成项。** 本文件不再是断点续接说明，只留续接者最需要的几条事实。

## 事实速览
- 线上地址：https://accumulate97.github.io/c-practice/ （GitHub Pages，Source = GitHub Actions，push main 即部署）
- 仓库：Accumulate97/c-practice，分支 main
- 完整交付说明见 **docs/网站完成报告.md**（功能清单 20 路由、内容规模、判分契约、验收矩阵、体积策略、已知缺口 7 条、后续建议 8 条、踩坑 9 条）
- 基线：题目 2074（verified 2068）· 卡片 345 · 2D 演示 34 · 3D 演示 38 · 展品 10 · 速查 293 · 搜索语料 2806
- 验收：verify:data error 0 / warn 6 · scan:doubt 0 · acceptance:all 15/15 · acceptance:online 36/36 · a11y:probe 23 页 ×2 主题 + 375px 0 问题 · typecheck/build/verify:pages 全绿 · CI 三 job 全 success

## 续接第一步该做什么
1. `npm ci`（或 `npm i`）→ `npm run build` → `npm run acceptance:all`，确认本地基线仍全绿
2. 若要动判分：先读 AGENTS.md 第二节第 5 条与 docs/adr/0001-judge-backend.md，切勿改双开关 / executeParameters 位置 / 串行约束
3. 若要提升 verified 到 2074/2074：给 6 道 code_reading（c-ch03-cr-017、c-ch03-cr-018、c-ch04-cr-004、c-ch04-cr-011、c-ch04-cr-012、c-ch11-cr-016）补可运行程序并跑 `npm run judge:verify`；**禁止手工置 true**

## 踩坑提醒（会重复踩的）
- **push 必须绕行 SNI 过滤**：github.com 默认解析到的 IP 会 TLS reset。先探测可用 IP（140.82.112~121 段，本轮可用：113.4 / 114.3 / 114.4 / 116.3 / 121.4），再
  `git -c http.curloptResolve=github.com:443:140.82.114.3 -c http.curloptResolve=github.com:443:140.82.113.4 push origin HEAD`
  探测脚本：tmp/probe-gh.mjs（node https + servername: github.com 逐个 IP GET /，看谁返回 200）
- PowerShell 下不要用 `&&`，用 `;`；本仓库补丁流程 = 写 `tmp/patch-*.txt`（`### FILE / ### FROM / ### TO`）+ `node tmp/apply-patch.mjs tmp/patch-*.txt`
- 验收脚本禁止「盲点一次 click 切筛选再断言」（CI 慢机上会落空），改为读 aria-pressed + waitForFunction 等目标计数
- CRLF 提交告警正常（src 为 LF）
