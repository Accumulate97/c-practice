/**
 * 题型 / 难度 / 题目 id 的展示元数据（阶段 4 模块 5 抽出，列表页与详情页共用）。
 *
 * 为什么要抽出来：模块 1 把 TYPE_LABEL 与 stars() 写在 ProblemDetailPage 里，模块 5 的列表页
 * 同样要显示题型中文名与难度星号。详情页那个模块**静态 import 三个 Renderer + 整套判分层**，
 * 列表页若从它 re-export，就把判分代码拖进 /problems 首屏（模块 3 刚刚才靠路由级 lazy 拆掉）。
 * 故下沉到本文件，两处共用一份 —— 与 verdict-meta.ts 同理：标签映射只允许有一份，不要新增第三份。
 */

/** schema/Problem.schema.json 的 type 枚举 → 中文名（04_题型规范与样例.md 的口径） */
export const TYPE_LABEL: Record<string, string> = {
  programming: '编程题',
  code_reading: '程序阅读写结果',
  code_completion: '程序填空',
  debug: '程序改错',
  single_choice: '选择题',
  true_false: '判断题',
  fill_blank: '填空题',
  code_ordering: '程序排序',
  complexity: '复杂度分析',
  short_answer: '简答题',
  matching: '匹配题',
}

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type
}

/** 难度 1–5 → ★☆。数据越界或缺失一律夹回 1–5，不抛错（列表页一次要渲染几十行） */
export function difficultyStars(difficulty: number): string {
  const d = Math.min(5, Math.max(1, Math.round(difficulty) || 1))
  return '★'.repeat(d) + '☆'.repeat(5 - d)
}

/** 分片文件名 → 章节键：'c-ch09.json' → 'c-ch09'（与 index.json 的 shards[].file 同源） */
export function shardKey(file: string): string {
  return file.replace(/\.json$/i, '')
}

/**
 * 题目 id 的「类别-章」前缀：'c-ch09-cr-043' → 'c-ch09-'。
 * 章号在数据里恒为两位（build-index.ts 的 isShardName 口径），故写死 ch\d\d。
 */
const ID_PREFIX_RE = /^[a-z]+-ch\d+-/i

/**
 * 题目 id 简写：'c-ch09-cr-043' → 'cr-043'。
 * 列表页恒显示章节列，简写不产生歧义；完整 id 放在 title 里，悬停可见、复制不丢。
 * 前缀不匹配（历史命名 / 手写数据）时原样返回，绝不返回空串。
 */
export function shortId(id: string): string {
  const short = id.replace(ID_PREFIX_RE, '')
  return short.length > 0 ? short : id
}

/**
 * 阶段 4 已交付渲染器、能在详情页真作答 + 判分的题型（其余七个辅助题型属阶段 5）。
 * 列表页用它把「点进去只是占位」的题型标出来，不让学生白点。
 * 新增渲染器时在这里加一项即可 —— 只有这一处清单，详情页的分派逻辑各自独立。
 */
export const RENDERABLE_TYPES: ReadonlySet<string> = new Set([
  'programming',
  'code_reading',
  'code_completion',
  'debug',
])
