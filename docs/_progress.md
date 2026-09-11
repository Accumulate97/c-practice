# 进度流水（大会话 1 · 阶段 10 收口）

每完成一个子任务追加一行。格式：`日期 | 子任务 | 产出 | 验收`。

- 2026-09-11 | 阶段 10-1 三向联动闭环 | 新增 `src/modules/knowledge/`（loader + links）、`KnowledgeListPage` / `KnowledgeDetailPage`、`Markdown` / `CodeBlock` 组件、`scripts/acceptance-stage10.mjs`；`build-index.ts` 知识索引补 file/category/order/summary/keyPoints；删除死配置 `SectionPage`；题目页与演示页新增反向关联区 | `npm run acceptance:stage10` 30/30 全绿（列表页筛选/搜索/分页、卡片→演示→题目→卡片闭环、404 与索引 500 重试、深浅色、375px，控制台 0 error 0 warn）；typecheck / verify:pages 通过
- 2026-09-11 | 阶段 10-2 GitHub Pages 部署配置 | 新增 `.github/workflows/deploy.yml`（push main → npm ci → typecheck → build → verify:pages → verify:data → `.nojekyll` → actions/deploy-pages；UI 验收独立 job 且不阻塞发布）、`scripts/acceptance-subpath.mjs`（node:http 把 dist 挂在 `/C-practice/` 下用真实 Chrome 验子目录形态）、npm scripts 补 `acceptance:stage10` / `acceptance:subpath` | base 已是 `./` + createHashRouter，无需 SPA 404 兜底；`node scripts/acceptance-subpath.mjs` 9/9 全绿（首页 200、无绝对资源引用、三板块数据可拉、三条深链刷新不 404、控制台 0 error）；verify:pages 通过；按要求未 push
