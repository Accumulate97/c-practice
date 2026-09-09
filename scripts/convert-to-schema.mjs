#!/usr/bin/env node
/**
 * convert-to-schema.mjs —— 提取语料 → Problem.schema.json v3.1 合规 JSON
 *
 * 输入：D:/C-practice-extract/batch/p*.json（33 个批次文件，1008 条）
 *       可选 --with-answers 时再 join D:/C-practice-extract/batch/_answers/A*.json
 * 输出：D:/C-practice/converted/c-chNN.json                （合规交付物，可直接过 Ajv）
 *       D:/C-practice/converted/_staging/c-chNN.staging.json（暂不合规，带 _pendingReason）
 *       D:/C-practice/converted/_judge-evidence.json        （实机证据 sidecar）
 *       D:/C-practice/converted/_index.json                 （总账）
 *
 * ★铁律：不伪造任何答案 / 选项 / 运行输出 / 参考代码。
 *        语料里没有的字段一律留空串或空数组，或整题进 _staging。
 * ★verified 分两类：代码题一律不写（schema default:false），只能由
 *   `npm run judge:verify` 走 Godbolt 写入，禁止在 converter 里手工置 true（AGENTS.md 二·7）。
 *   实机证据改走 _judge-evidence.json sidecar。
 *   非代码题（sc/fb/sa/tf/co/cx/mt）按 Schema「非代码题固定 true」写 true，见 withVerified()。
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- 配置
const SRC_DIR = 'D:/C-practice-extract/batch';
const ANS_DIR = 'D:/C-practice-extract/batch/_answers';
const OUT_DIR = 'D:/C-practice/converted';
const GEN_DATE = '2026-09-08';
const BOOK = '《C程序设计试题汇编》（谭浩强系列，12 章体例）';

/** short_answer 是否改判为 code_reading + answerIsDescription:true。
 *  默认 false：遵用户「不可判分题设为 short_answer」的显式规则；
 *  置 true 可让 15 道带代码的 sa 保留结构化 code 字段（阶段 4 可选）。 */
const SA_AS_CODE_READING = false;

const PREFIX = {
  code_completion: 'cc', debug: 'dbg', code_reading: 'cr', programming: 'pg',
  single_choice: 'sc', true_false: 'tf', fill_blank: 'fb',
  code_ordering: 'co', short_answer: 'sa', complexity: 'cx', matching: 'mt',
};
const LETTERS = ['A', 'B', 'C', 'D'];

const argv = process.argv.slice(2);
const WITH_ANSWERS = argv.includes('--with-answers');
const DRY = argv.includes('--dry');

// ---------------------------------------------------------------- rescue
// 阶段4前置：10 道 code_completion 已人工补 solution + testCases，并经 Godbolt
// cg132 (gcc 13.2) -std=c99 -w -O0 实机编译+执行复验（30/30 组用例 stdout 与独立
// 模型预测逐字一致）。证据与原始记录见 rescued/*.json；verified 仍一律不写。
const RESCUE_DIR = 'D:/C-practice/rescued';
const RESCUE = new Map();
if (fs.existsSync(RESCUE_DIR)) {
  for (const f of fs.readdirSync(RESCUE_DIR).filter(x => x.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(RESCUE_DIR, f), 'utf8'));
    for (const e of Array.isArray(arr) ? arr : []) {
      if (!e || typeof e.originalId !== 'string') continue;
      if (RESCUE.has(e.originalId)) throw new Error('rescue 重复 originalId: ' + e.originalId);
      RESCUE.set(e.originalId, { ...e, __file: 'rescued/' + f });
    }
  }
}
/** rescue 记录是否足以产出 schema 合规的 code_completion */
function rescueOk(e) {
  return !!e
    && typeof e.code === 'string' && /\/\*__BLANK_1__\*\//.test(e.code)
    && typeof e.solution === 'string' && e.solution.length > 0
    && Array.isArray(e.blanks) && e.blanks.length >= 1 && e.blanks.length <= 4
    && e.blanks.every(b => b && Number.isInteger(b.index) && b.index >= 1 && typeof b.answer === 'string' && b.answer.length > 0)
    && Array.isArray(e.testCases) && e.testCases.length >= 1
    && e.testCases.every(t => t && typeof t.stdin === 'string' && typeof t.expected === 'string');
}

// ---------------------------------------------------------------- authored
// 阶段4内容补充：debug（程序改错）原书无此题型，全部为原创变式题，存于 authored/*.json。
// 每题的 code（bug 版）与 fixed_code 都已由 scripts/authoring-verify.ts 走**冻结判分层**
// （src/judge/backends/godbolt.ts + base.normalizeOutput）实机验证三条：
//   ① bug 版能编译 ② bug 版至少一组输出与 expected 不同 ③ fixed_code 全组逐字一致。
// 证据存 verification 字段并同步进 _judge-evidence.json；verified 仍一律不写，
// 只由 npm run judge:verify 置位（AGENTS.md 二.7）。
const AUTHORED_DIR = 'D:/C-practice/authored';
const AUTHORED = [];
if (fs.existsSync(AUTHORED_DIR)) {
  for (const f2 of fs.readdirSync(AUTHORED_DIR).filter(x => x.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(AUTHORED_DIR, f2), 'utf8'));
    for (const e of Array.isArray(arr) ? arr : []) {
      if (e && typeof e.id === 'string') AUTHORED.push({ ...e, __file: 'authored/' + f2 });
    }
  }
}
/** 原创题是否足以入库：字段齐全 + **带实机验证证据且 fixed 全组匹配**，否则宁可不要 */
function authoredOk(e) {
  const v = e && e.verification;
  const fixed = v && Array.isArray(v.fixed && v.fixed.runs) ? v.fixed.runs : [];
  const buggy = v && Array.isArray(v.buggy && v.buggy.runs) ? v.buggy.runs : [];
  return !!e && typeof e.id === 'string' && typeof PREFIX[e.type] === 'string'
    && typeof e.chapter === 'string' && /第\s*\d+\s*章/.test(e.chapter)
    && typeof e.section === 'string' && typeof e.stem === 'string' && e.stem.length > 0
    && typeof e.explanation === 'string' && e.explanation.length > 0
    && Number.isInteger(e.difficulty) && e.difficulty >= 1 && e.difficulty <= 5
    && typeof e.code === 'string' && e.code.length > 0 && typeof e.fixed_code === 'string' && e.fixed_code.length > 0
    && Array.isArray(e.bugs) && e.bugs.length >= 1 && e.bugs.every(b => typeof b === 'string' && b.length > 0)
    && Array.isArray(e.testCases) && e.testCases.length >= 1
    && e.testCases.every(tc => tc && typeof tc.stdin === 'string' && typeof tc.expected === 'string')
    && v && v.buggy && v.buggy.compiled === true && buggy.length >= 1 && buggy.some(r => r.match === false)
    && fixed.length === e.testCases.length && fixed.every(r => r.match === true);
}

// ---------------------------------------------------------------- 读入
function readBatchFiles() {
  const files = fs.readdirSync(SRC_DIR)
    .filter(f => f.startsWith('p') && f.endsWith('.json') && !f.includes('.bak'))
    .sort();
  const recs = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
    if (!Array.isArray(arr)) throw new Error(f + ': top level is not an array');
    for (const r of arr) recs.push({ ...r, __file: f });
  }
  return { files, recs };
}

function readAnswers() {
  if (!WITH_ANSWERS) return new Map();
  if (!fs.existsSync(ANS_DIR)) return new Map();
  const map = new Map();
  for (const f of fs.readdirSync(ANS_DIR).filter(x => x.endsWith('.json'))) {
    for (const r of JSON.parse(fs.readFileSync(path.join(ANS_DIR, f), 'utf8'))) map.set(r.originalId, r);
  }
  return map;
}

// ---------------------------------------------------------------- 小工具
const num = s => (s == null ? 0 : Number(String(s).replace(/\D/g, '')) || 0);
const chOf = r => num(/第\s*(\d+)\s*章/.exec(r.chapter || '')?.[1] ?? 0);
const qnum = r => num(String(r.originalId || '').split('.').pop());
const sortKey = r => chOf(r) * 1e6 + qnum(r);
const hasCode = r => typeof r.code === 'string' && r.code.trim() !== '';
const codeLines = r => (hasCode(r) ? r.code.split('\n').length : 0);
const hasBlankMark = s => /【\s*\d*\s*】/.test(String(s || ''));

/** 难度启发式（handoff 定型规则，勿改）：基础 2；有 code +1；>12 行 +1；>25 行 +1；cap 5，floor 1 */
function difficulty(r) {
  let d = 2;
  const L = codeLines(r);
  if (L > 0) d += 1;
  if (L > 12) d += 1;
  if (L > 25) d += 1;
  return Math.max(1, Math.min(5, d));
}

/** 从 stem 的 【n】 / 【 】 标记推导空位序号 */
function blanksFromStem(stem) {
  const marks = [...String(stem).matchAll(/【\s*(\d*)\s*】/g)].map(m => m[1]);
  if (!marks.length) return [];
  const numbered = marks.filter(x => x !== '').map(Number);
  const idx = numbered.length
    ? [...new Set(numbered)].sort((a, b) => a - b)
    : marks.map((_, i) => i + 1);
  return idx.map(i => ({ index: i, answer: '' }));
}

/** single_choice 的字母答案 → 0..3，且逐项校验选项前缀与字母一致 */
function letterToIndex(rec, ans) {
  const v = String(ans ?? '').trim();
  if (v.length !== 1) return null;
  const i = LETTERS.indexOf(v.toUpperCase());
  if (i < 0) return null;
  if (!Array.isArray(rec.options) || rec.options.length !== 4) return null;
  const ok = rec.options.every((o, k) => {
    const t = String(o).trim();
    return t.startsWith(LETTERS[k] + ')') || t.startsWith(LETTERS[k] + '）')
        || t.startsWith(LETTERS[k] + '.') || t.startsWith(LETTERS[k] + '、');
  });
  return ok ? i : null;
}

/** Schema verified 字段描述：「代码类题目是否通过实机编译验证。非代码题固定 true」。
 *  非代码题没有可编译物，true 是定义而非伪造实机结论；代码题一律 false，
 *  只能由 npm run judge:verify 走 Godbolt 置位（AGENTS.md 二·7）。 */
const CODE_TYPES = new Set(['code_completion', 'debug', 'code_reading', 'programming']);
const withVerified = p => ({ ...p, verified: !CODE_TYPES.has(p.type) });

// ---------------------------------------------------------------- 路由
/** 返回 {kind:'ok', problem} 或 {kind:'stage', reason, missing, partial} */
function route(r, answers) {
  const sub = r.subType;
  const base = {
    category: 'c',
    chapter: r.chapter,
    section: r.section,
    source: `教材原题转录：${BOOK} ${r.chapter} ${r.originalId}（PDF p${r.page} / 书页 p${r.bookPage}）`,
    difficulty: difficulty(r),
    stem: r.stem,
    explanation: '',            // 收尾⑤ 推迟，先留空串（schema 无 minLength）
    ai_generated: false,        // 教材原题转录，非 AI 原创
    generated_at: GEN_DATE,
  };
  const stage = (reason, missing, extra = {}) => ({ kind: 'stage', reason, missing, partial: { ...base, ...extra } });

  // 1) code_reading → cr
  if (sub === 'code_reading') {
    if (!hasCode(r)) return stage('code_reading 缺 code', ['code']);
    const answer = typeof r.runtimeStdout === 'string' ? r.runtimeStdout
                 : (typeof r.answer === 'string' && r.answer.trim() ? r.answer : '');
    const p = { ...base, type: 'code_reading', bloom: 'analyze', code: r.code, answer };
    if (!answer && /功能|作用/.test(r.stem)) { p.answer = ''; p.answerIsDescription = true; }
    return { kind: 'ok', problem: p };
  }

  // 2) multi_blank 无 code → fb
  if (sub === 'multi_blank' && !hasCode(r)) {
    const blanks = blanksFromStem(r.stem);
    if (!blanks.length) return stage('multi_blank 无 code 且 stem 内无 【】 空位标记', ['blanks']);
    const ans = typeof r.answer === 'string' ? r.answer.trim() : '';
    if (ans) blanks[0].answer = ans;      // 语料里已有的真实答案（仅 5 条），非伪造
    return { kind: 'ok', problem: { ...base, type: 'fill_blank', bloom: 'remember', blanks } };
  }

  // 3) multi_blank 有 code → 隔离（code_completion 需 solution + testCases，语料无）
  if (sub === 'multi_blank' && hasCode(r)) {
    return stage('multi_blank 含代码：schema 的 fill_blank 不允许 code 字段；改判 code_completion 又缺 solution 与 testCases',
      ['solution', 'testCases'], { type: 'code_completion', bloom: 'apply', code: r.code, blanks: [], solution: '', testCases: [] });
  }

  // 4) code_completion：rescue 命中 → 合规产出；否则隔离
  if (sub === 'code_completion') {
    const resc = RESCUE.get(r.originalId);
    if (rescueOk(resc)) {
      return { kind: 'ok', problem: { ...base, type: 'code_completion', bloom: 'apply',
        code: resc.code, blanks: resc.blanks, solution: resc.solution, testCases: resc.testCases,
        // base.explanation 是收尾⑤留下的空串；救援批次已补好详解，有就用，没有才回落空串
        explanation: resc.explanation || '' } };
    }
    return stage('code_completion 缺 solution（补全后的完整代码）与 testCases；两者都属收尾② 答案回填范畴，本轮明令推迟',
      ['solution', 'testCases'], { type: 'code_completion', bloom: 'apply', code: hasCode(r) ? r.code : '', blanks: [], solution: '', testCases: [] });
  }

  // 5) programming → pg
  if (sub === 'programming') {
    const tcs = Array.isArray(r.testCases) ? r.testCases : [];
    if (!tcs.length) return stage('programming 无 testCases', ['testCases']);
    const testCases = tcs.map(t => ({
      stdin: typeof t.stdin === 'string' ? t.stdin : '',
      expected: typeof t.expectedStdout === 'string' ? t.expectedStdout : '',
      note: typeof t.name === 'string' ? t.name : '',
    }));
    return { kind: 'ok', problem: { ...base, type: 'programming', bloom: 'apply', reference: hasCode(r) ? r.code : '', testCases } };
  }

  // 6) short_answer → sa（code 内联进 stem，因 schema 的 sa 不允许 code 字段）
  if (sub === 'short_answer') {
    const ans = typeof r.answer === 'string' ? r.answer : '';
    if (SA_AS_CODE_READING && hasCode(r)) {
      return { kind: 'ok', problem: { ...base, type: 'code_reading', bloom: 'analyze', code: r.code, answer: ans, answerIsDescription: true } };
    }
    const stem = hasCode(r) ? `${r.stem}\n\n\`\`\`c\n${r.code}\n\`\`\`` : r.stem;
    return { kind: 'ok', problem: { ...base, type: 'short_answer', bloom: 'understand', stem, reference_answer: ans, grading_points: [] } };
  }

  // 7) single_choice → sc（需 answer:int 0-3 + options 恰 4 项）
  if (sub === 'single_choice') {
    const opts4 = Array.isArray(r.options) && r.options.length === 4;
    const a = answers.get(r.originalId);
    const idx = opts4 && a && !a.omitted && a.alignable === '是' ? letterToIndex(r, a.answer) : null;
    const missing = [];
    if (!opts4) missing.push('options（需恰好 4 项，实际 ' + (Array.isArray(r.options) ? r.options.length : 'null') + '）');
    if (idx === null) missing.push('answer（需 int 0-3；答案回填属收尾②，本轮明令推迟' + (WITH_ANSWERS ? '，已开 --with-answers 仍不可判' : '') + '）');
    if (missing.length) {
      return stage('single_choice 不满足 schema：' + missing.join('；'), missing,
        { type: 'single_choice', bloom: 'understand', options: Array.isArray(r.options) ? r.options : [], code: hasCode(r) ? r.code : undefined });
    }
    const p = { ...base, type: 'single_choice', bloom: 'understand', options: r.options, answer: idx };
    if (hasCode(r)) p.code = undefined;   // sc 不允许 code 字段 → 内联进 stem
    if (hasCode(r)) p.stem = `${r.stem}\n\n\`\`\`c\n${r.code}\n\`\`\``;
    delete p.code;
    return { kind: 'ok', problem: p };
  }

  return stage('未知 subType=' + sub, ['type']);
}

// ---------------------------------------------------------------- 主流程
const { files, recs } = readBatchFiles();
const answers = readAnswers();
recs.sort((a, b) => sortKey(a) - sortKey(b));

const chapters = new Map();   // ch -> {name, ok:[], stage:[]}
for (const r of recs) {
  const ch = chOf(r);
  if (!chapters.has(ch)) chapters.set(ch, { name: r.chapter, ok: [], stage: [] });
  const res = route(r, answers);
  const bucket = chapters.get(ch);
  if (res.kind === 'ok') bucket.ok.push({ problem: res.problem, raw: r });
  else bucket.stage.push({ ...res, raw: r });
}

// 原创题注入：verification 是出题期证据，不进 problem（schema unevaluatedProperties:false），
// 只留在 raw 上供 evidence sidecar 取用。
const authoredSkipped = [];
for (const a of AUTHORED) {
  if (!authoredOk(a)) { authoredSkipped.push(a.id + '（字段不全或缺实机验证证据）'); continue; }
  const ch = chOf(a);
  if (!chapters.has(ch)) chapters.set(ch, { name: a.chapter, ok: [], stage: [] });
  const problem = { ...a };
  delete problem.verification; delete problem.__file;
  chapters.get(ch).ok.push({ problem, raw: a, authored: true });
}

// id 编号：per (chapter, typePrefix) 按 originalId 数字序三位补零
const counters = new Map();
const evidence = [];
const out = { generated_at: GEN_DATE, withAnswers: WITH_ANSWERS, sourceFiles: files.length, sourceRecords: recs.length, chapters: [] };

for (const ch of [...chapters.keys()].sort((a, b) => a - b)) {
  const bucket = chapters.get(ch);
  const chTag = 'c-ch' + String(ch).padStart(2, '0');

  bucket.ok.sort((a, b) => (a.authored ? 1 : 0) - (b.authored ? 1 : 0) || sortKey(a.raw) - sortKey(b.raw));
  for (const e of bucket.ok) {
    // 原创题自带显式 id（c-chNN-dbg-NNN），不参与教材题连号，否则会把既有 492 题的编号全部推后
    if (e.authored) continue;
    const pre = PREFIX[e.problem.type];
    const key = chTag + '-' + pre;
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    e.problem.id = `${chTag}-${pre}-${String(n).padStart(3, '0')}`;
  }
  const seenIds = new Set();
  for (const e of bucket.ok) {
    if (!e.problem.id || seenIds.has(e.problem.id)) throw new Error(chTag + ' id 冲突或缺失：' + String(e.problem.id));
    seenIds.add(e.problem.id);
  }
  bucket.stage.sort((a, b) => sortKey(a.raw) - sortKey(b.raw));

  // 实机证据 sidecar：有 runtimeStdout 或 expectedVerified 的题
  for (const e of bucket.ok) {
    const r = e.raw;
    const ev = (typeof r.runtimeStdout === 'string') || r.expectedVerified === true;
    if (!ev) continue;
    evidence.push({
      id: e.problem.id, originalId: r.originalId, chapter: r.chapter, type: e.problem.type,
      expectedVerified: r.expectedVerified === true,
      hasRuntimeStdout: typeof r.runtimeStdout === 'string',
      runtimeStdout: typeof r.runtimeStdout === 'string' ? r.runtimeStdout : null,
      sourceBatch: r.__file, page: r.page, bookPage: r.bookPage,
      evidence: 'Godbolt gcc 13.2 (cg132) -std=c99 -w -O0，提取阶段存档于 runtimeStdout',
    });
  }
  // rescue 复验证据（code_completion 10 道）：无 runtimeStdout 存档，expected 来自本轮实机运行
  for (const e of bucket.ok) {
    const resc = RESCUE.get(e.raw.originalId);
    if (!resc || e.problem.type !== 'code_completion') continue;
    const v = resc.verification || {};
    const runs = Array.isArray(v.runs) ? v.runs : [];
    evidence.push({
      id: e.problem.id, originalId: e.raw.originalId, chapter: e.raw.chapter, type: 'code_completion',
      expectedVerified: true, hasRuntimeStdout: false, runtimeStdout: null,
      rescueFile: resc.__file, sourceBatch: e.raw.__file, page: e.raw.page, bookPage: e.raw.bookPage,
      runs: runs.map(x => ({ stdin: x.stdin, expected: x.expected, exitCode: x.exitCode, predMatch: x.predMatch })),
      evidence: 'Godbolt cg132 (gcc 13.2) ' + (v.userArguments || '-std=c99 -w -O0') + '，' + (v.date || GEN_DATE)
        + ' rescue 复验：' + runs.length + '/' + runs.length + ' 组用例编译通过、exit 0、stdout 与独立模型预测逐字一致；详见 ' + resc.__file,
    });
  }
  // 原创改错题证据：三条验证结论 + bug 版/fixed 版逐组实机记录
  for (const e of bucket.ok) {
    if (!e.authored) continue;
    const v = e.raw.verification || {};
    const buggyRuns = (v.buggy && v.buggy.runs) || [];
    const fixedRuns = (v.fixed && v.fixed.runs) || [];
    const exposed = buggyRuns.filter(x => x.match === false).length;
    evidence.push({
      id: e.problem.id, originalId: e.problem.id, chapter: e.raw.chapter, type: e.problem.type,
      expectedVerified: true, hasRuntimeStdout: false, runtimeStdout: null,
      authoredFile: e.raw.__file, ai_generated: true,
      runs: fixedRuns.map(x => ({ stdin: x.stdin, expected: x.expected, exitCode: x.exitCode, match: x.match })),
      buggyRuns: buggyRuns.map(x => ({ stdin: x.stdin, expected: x.expected, actual: x.actual, differs: x.match === false, errorClass: x.errorClass, exitCode: x.exitCode })),
      evidence: 'Godbolt cg132 (gcc 13.2) ' + (v.userArguments || '-std=c99 -w -O0') + '，' + (v.date || GEN_DATE)
        + ' 原创改错题三条实机验证：① bug 版编译通过=' + (v.buggy && v.buggy.compiled === true)
        + ' ② ' + exposed + '/' + buggyRuns.length + ' 组用例暴露错误（其余为边界掩盖，已在 note 标注）'
        + ' ③ fixed_code ' + fixedRuns.filter(x => x.match === true).length + '/' + fixedRuns.length
        + ' 组与 expected 逐字一致；详见 ' + e.raw.__file,
    });
  }
  for (const s of bucket.stage) {
    const r = s.raw;
    if (!(typeof r.runtimeStdout === 'string' || r.expectedVerified === true)) continue;
    evidence.push({
      id: null, originalId: r.originalId, chapter: r.chapter, type: s.partial.type || null,
      staged: true, expectedVerified: r.expectedVerified === true,
      hasRuntimeStdout: typeof r.runtimeStdout === 'string',
      runtimeStdout: typeof r.runtimeStdout === 'string' ? r.runtimeStdout : null,
      sourceBatch: r.__file, page: r.page, bookPage: r.bookPage,
      evidence: 'Godbolt gcc 13.2 (cg132) -std=c99 -w -O0，提取阶段存档于 runtimeStdout（该题暂在 _staging）',
    });
  }

  const problems = bucket.ok.map(e => withVerified(e.problem));
  const pending = bucket.stage.map(s => ({
    originalId: s.raw.originalId,
    sourceBatch: s.raw.__file,
    page: s.raw.page, bookPage: s.raw.bookPage,
    subType: s.raw.subType,
    _pendingReason: s.reason,
    _missing: s.missing,
    _unlockHint: unlockHint(s),
    partial: s.partial,
  }));

  out.chapters.push({
    chapter: ch, id: chTag, name: bucket.name,
    converted: problems.length, staged: pending.length,
    byType: problems.reduce((o, p) => (o[p.type] = (o[p.type] || 0) + 1, o), {}),
    stagedBySubType: pending.reduce((o, p) => (o[p.subType] = (o[p.subType] || 0) + 1, o), {}),
  });

  if (!DRY) {
    fs.mkdirSync(path.join(OUT_DIR, '_staging'), { recursive: true });
    const clean = o => JSON.parse(JSON.stringify(o, (k, v) => v === undefined ? undefined : v));
    fs.writeFileSync(path.join(OUT_DIR, chTag + '.json'),
      JSON.stringify(clean({ category: 'c', chapter: bucket.name, generated_at: GEN_DATE, count: problems.length, problems }), null, 2) + '\n', 'utf8');
    // 无条件写入：pending 为 0 时也要覆盖旧文件，否则残留上一轮（未加 --with-answers）的陈旧 pending
    fs.writeFileSync(path.join(OUT_DIR, '_staging', chTag + '.staging.json'),
      JSON.stringify(clean({ category: 'c', chapter: bucket.name, generated_at: GEN_DATE, count: pending.length, pending }), null, 2) + '\n', 'utf8');
  }
}

function unlockHint(s) {
  const m = s.missing || [];
  if (s.partial?.type === 'single_choice') {
    return m.some(x => x.startsWith('answer'))
      ? '收尾② 答案回填后重跑本脚本（或加 --with-answers，现成 _answers 覆盖 ch1–ch4）即可解锁；answer = 字母 A/B/C/D → 0/1/2/3'
      : '需把选项规范化为恰好 4 项（原书即印 2–3 项，属印刷体例，不得凭空补项）';
  }
  if (s.partial?.type === 'code_completion') {
    return '收尾② 补 solution（把 【n】 换成真实答案）+ 收尾③ 补 testCases 后即可转 code_completion';
  }
  return '见 _pendingReason';
}

out.totals = {
  records: recs.length,
  converted: out.chapters.reduce((a, c) => a + c.converted, 0),
  staged: out.chapters.reduce((a, c) => a + c.staged, 0),
  byType: out.chapters.reduce((o, c) => { for (const [k, v] of Object.entries(c.byType)) o[k] = (o[k] || 0) + v; return o; }, {}),
  stagedBySubType: out.chapters.reduce((o, c) => { for (const [k, v] of Object.entries(c.stagedBySubType)) o[k] = (o[k] || 0) + v; return o; }, {}),
  judgeEvidence: evidence.length,
  withRealExpected: evidence.filter(e => e.hasRuntimeStdout).length,
    rescuedCodeCompletion: evidence.filter(e => typeof e.rescueFile === 'string').length,
    authoredDebug: evidence.filter(e => typeof e.authoredFile === 'string').length,
    authoredSkipped: authoredSkipped.length,
};

if (!DRY) {
  fs.writeFileSync(path.join(OUT_DIR, '_judge-evidence.json'),
    JSON.stringify({ generated_at: GEN_DATE, backend: 'Godbolt cg132 (gcc 13.2) + 主线程本地 gcc 8.1.0 复验', note: '本文件是证据 sidecar，不是 verified 标记。public/data/ 的 verified 只能由 npm run judge:verify 写入。', count: evidence.length, items: evidence }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------- 报告
console.log(`convert-to-schema  src=${files.length} files / ${recs.length} records  withAnswers=${WITH_ANSWERS}  dry=${DRY}`);
console.log('章  converted  staged   byType');
for (const c of out.chapters) {
  console.log(` ${c.id}  ${String(c.converted).padStart(6)}  ${String(c.staged).padStart(6)}   ` + Object.entries(c.byType).map(([k, v]) => k + '=' + v).join(' '));
}
console.log('---');
console.log('TOTAL converted=' + out.totals.converted + '  staged=' + out.totals.staged + '  (' + out.totals.records + ' records)');
console.log('byType        : ' + JSON.stringify(out.totals.byType));
console.log('stagedBySubType: ' + JSON.stringify(out.totals.stagedBySubType));
console.log('judge-evidence: ' + out.totals.judgeEvidence + ' items, of which withRealExpected=' + out.totals.withRealExpected
  + '  rescuedCodeCompletion=' + out.totals.rescuedCodeCompletion
  + '  authoredDebug=' + out.totals.authoredDebug + (authoredSkipped.length ? '  SKIPPED=' + authoredSkipped.join('|') : ''));
if (RESCUE.size) {
  const applied = new Set(evidence.filter(e => typeof e.rescueFile === 'string').map(e => e.originalId));
  const unused = [...RESCUE.keys()].filter(k => !applied.has(k));
  console.log('rescue        : loaded=' + RESCUE.size + ' applied=' + applied.size + (unused.length ? '  ★UNUSED=' + unused.join(',') : '  (无未命中)'));
}
if (!DRY) console.log('written to ' + OUT_DIR);
