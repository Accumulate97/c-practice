import { Link } from 'react-router-dom'
import { APP_NAME, judge, sections } from '../app/config'

const CONSTRAINTS = [
  '纯静态、无后端，必须能部署在 GitHub Pages',
  '不得引入任何需要服务端运行时的方案',
  '用户进度用 localStorage 保存',
  '数据以 JSON 存放，按章节分片 + 索引文件，前端懒加载',
  `编译层抽象成独立模块并做节流排队（现役后端：${judge.backend}）`,
  '题目代码必须是标准 C99，禁 C++ 语法与教材类C伪码',
  '所有代码类题目须实机验证通过后才可置 verified: true',
]

const PHASES: { n: number; name: string; state: 'done' | 'current' | 'todo' }[] = [
  { n: 1, name: '仓库与站点骨架（Vite + TS + Tailwind + 路由 + 主题 + Pages 相对 base）', state: 'current' },
  { n: 2, name: '编译模块：JudgeBackend 抽象 + 并发/排队 + 错误分类 + 试验台', state: 'todo' },
  { n: 3, name: '数据管线：Schema 校验 + 索引与分片 + 非法构造扫描 + 3 道种子题', state: 'todo' },
  { n: 4, name: '刷题闭环：CodeMirror + 四个主力题型 + 判分器', state: 'todo' },
  { n: 5, name: '七个辅助题型 + 错题本 / 收藏 / 进度导出导入', state: 'todo' },
  { n: 6, name: '知识库：卡片渲染 + 语法速查 + 导航树 + 全局搜索', state: 'todo' },
  { n: 7, name: '可视化内核：Step / Player / Renderer + 控件', state: 'todo' },
  { n: 8, name: '8 种排序可视化 + 多算法对比 + 复杂度计数', state: 'todo' },
  { n: 9, name: '链表 / 栈队列 / 树（含 AVL 旋转）/ 图 / 查找 / KMP / 内存指针', state: 'todo' },
  { n: 10, name: '三向跳转打通 + 响应式打磨 + CI 全量校验与题库批量验证', state: 'todo' },
]

export function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
        <p className="mt-2 max-w-2xl" style={{ color: 'var(--fg-muted)' }}>
          不是单纯的刷题站，而是"学—懂—练"三板块联动的 C 语言与数据结构学习平台。
          知识卡片、算法演示、题目三者通过 knowledgeIds / vizIds / relatedProblems 双向跳转。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {sections.map((s) => (
          <Link
            key={s.path}
            to={s.path}
            className="rounded-xl border p-5 transition hover:-translate-y-0.5"
            style={{ borderColor: 'var(--border)', textDecoration: 'none', color: 'inherit' }}
          >
            <div className="text-2xl">{s.emoji}</div>
            <div className="mt-2 font-semibold">{s.title}</div>
            <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>{s.intent} · {s.desc}</div>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-lg font-semibold">项目硬约束</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--fg-muted)' }}>
            {CONSTRAINTS.map((c) => <li key={c}>{c}</li>)}
          </ol>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">实施阶段</h2>
          <ul className="space-y-1 text-sm">
            {PHASES.map((p) => (
              <li key={p.n} className="flex gap-2">
                <span>{p.state === 'current' ? '🔵' : '⚪'}</span>
                <span style={{ color: p.state === 'current' ? 'var(--fg)' : 'var(--fg-muted)' }}>
                  阶段 {p.n} · {p.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border p-5 text-sm" style={{ borderColor: 'var(--border)' }}>
        <h2 className="font-semibold">关于在线编译后端</h2>
        <p className="mt-1" style={{ color: 'var(--fg-muted)' }}>
          原硬性约束指定的 Piston 公共 API 自 2026-02-15 起改为白名单制（匿名调用返回 401）。
          依据 <code>docs/adr/0001-judge-backend.md</code>，本站改用 Godbolt Compiler Explorer 公共接口，
          浏览器直连、无需 key；实测其策略为服务端排队而非限流，故并发上限压到 {judge.maxConcurrency}。
          编译层保留 PistonAdapter / Judge0Adapter，将来可切换。后端不可用时自动进入降级模式：
          读取构建期预存的真实输出供自评，站点不瘫。
        </p>
      </section>
    </div>
  )
}