// scripts/merge-to-public.mjs —— 把 converted/ 的转换结果**增量合并**进 public/data/problems/
// 铁律：已上线题目（按 source 匹配）一字不动，只追加新题；新题 id 按 (章, 前缀) 续号分配。
// 用法: node scripts/merge-to-public.mjs [--chapters=03,04] [--dry]
import fs from 'node:fs';
import path from 'node:path';

const CONV = 'converted';
const PUB = 'public/data/problems';
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const chArg = args.find(a => a.startsWith('--chapters='));
const only = chArg ? new Set(chArg.split('=')[1].split(',').map(s => s.trim())) : null;

const pad = n => String(n).padStart(3, '0');
const idRe = /^c-ch(\d+)-([a-z]+)-(\d+)$/;

const files = fs.readdirSync(CONV).filter(f => /^c-ch\d+\.json$/.test(f));
const report = [];
let addedTotal = 0, skippedTotal = 0;

for (const f of files) {
  const chNo = /c-ch(\d+)\.json/.exec(f)[1];
  if (only && !only.has(chNo)) continue;
  const convPath = path.join(CONV, f);
  const pubPath = path.join(PUB, f);
  const conv = JSON.parse(fs.readFileSync(convPath, 'utf8'));
  if (!fs.existsSync(pubPath)) { report.push(`${f}: 线上文件缺失，跳过`); continue; }
  const pub = JSON.parse(fs.readFileSync(pubPath, 'utf8'));

  const bySource = new Map();
  const maxSeq = new Map();
  for (const p of pub.problems) {
    if (typeof p.source === 'string') bySource.set(p.source, p);
    const m = idRe.exec(p.id || '');
    if (m) { const k = m[2]; maxSeq.set(k, Math.max(maxSeq.get(k) || 0, Number(m[3]))); }
  }

  const added = [];
  let skipped = 0;
  for (const p of conv.problems) {
    if (typeof p.source !== 'string') { report.push(`${f}: 转换结果缺 source，跳过一题`); continue; }
    if (bySource.has(p.source)) { skipped++; continue; }
    const m = idRe.exec(p.id || '');
    if (!m) { report.push(`${f}: 转换结果 id 非法 ${p.id}，跳过`); continue; }
    const prefix = m[2];
    const seq = (maxSeq.get(prefix) || 0) + 1;
    maxSeq.set(prefix, seq);
    const np = { ...p, id: `c-ch${chNo}-${prefix}-${pad(seq)}` };
    added.push(np);
    bySource.set(np.source, np);
  }

  if (added.length) {
    const out = { ...pub, problems: [...pub.problems, ...added], count: pub.problems.length + added.length };
    if (!dry) fs.writeFileSync(pubPath, JSON.stringify(out, null, 2) + '\n');
  }
  addedTotal += added.length; skippedTotal += skipped;
  report.push(`${f}: 新增 ${added.length} 题，已存在跳过 ${skipped} 题${added.length ? '  [' + added.map(p => p.id).join(' ') + ']' : ''}${dry ? '  (dry)' : ''}`);
}
console.log(report.join('\n'));
console.log(`合计：新增 ${addedTotal}，跳过 ${skippedTotal}${dry ? '（dry-run 未写盘）' : ''}`);
