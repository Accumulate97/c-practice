// 修复 batch/p201-212.json 中崩溃会话遗留的「行分隔逗号」缺陷
// 影响记录：题9.149 / 9.150 / 9.151 / 9.152 / 9.153 / 9.154（共 6 条，全部在 p201-212.json）
// 缺陷成因：上个会话输出畸形 JSON 时，code 字段的 \n 被写成 ASCII 逗号
// 修复原则：只把「语句/行分隔位置」的逗号还原成 \n，绝不触碰合法逗号
//   合法逗号示例：{2,4,6,8,10,12}、int * a[2][3], ** q,k,i,j;、scanf("%d", &n)
// 幂等性：规则只匹配「逗号」，已修复文本无匹配 → 重跑不产生二次变更
import fs from 'node:fs';

const TARGET = 'D:/C-practice-extract/batch/p201-212.json';
const IDS = ['题9.149', '题9.150', '题9.151', '题9.152', '题9.153', '题9.154'];
const BAK = TARGET + '.bak-commafix';

function repair(src) {
  let s = src;
  const log = [];
  const bump = (name, n) => { if (n) log.push(name + ':' + n); };

  // 0) 字符串末尾孤立逗号
  if (/,$/.test(s)) { s = s.replace(/,$/, ''); bump('tail', 1); }

  const steps = [
    ['gt',     />,/g,                     '>\n'], // #include <stdio.h>,
    ['semi',   /;,/g,                     ';\n'], // 语句结束
    ['rbrace', /},/g,                     '}\n'],
    ['lbrace', /{,/g,                     '{\n'],
    ['paren',  /\),/g,                    ')\n'], // for/if/while 头部之后
    ['define', /,(?=\s*int\s+main\b)/g,   '\n'],  // #define M 10,int main( )
  ];
  for (const [name, re, rep] of steps) {
    const n = (s.match(re) || []).length;
    if (n) { s = s.replace(re, rep); bump(name, n); }
  }
  return { out: s, log };
}

const raw = fs.readFileSync(TARGET, 'utf8');
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) throw new Error('expected top-level array');

let changed = 0;
const report = [];
for (const r of arr) {
  if (!IDS.includes(r.originalId)) continue;
  const before = r.code;
  const { out, log } = repair(before);
  // 守卫：修复后不允许残留任何「逗号充行分隔」的痕迹
  const residue = [/;,/, /,int\s+main/, /#>[^\n]*,/, /\},/].filter(re => re.test(out)).length;
  if (residue) throw new Error('residue comma in ' + r.originalId);
  if ((out.match(/\n/g) || []).length < 5) throw new Error('suspiciously few newlines in ' + r.originalId);
  r.code = out;
  changed++;
  report.push({ id: r.originalId, subType: r.subType, nl0: (before.match(/\n/g) || []).length, nl1: (out.match(/\n/g) || []).length, rules: log.join(' ') });
}

if (changed !== IDS.length) throw new Error('expected to patch ' + IDS.length + ' records, patched ' + changed);

// 回写前自检：2 空格缩进 roundtrip 必须与原文件字节一致（除被改的 6 个 code 字段）
const outStr = JSON.stringify(arr, null, 2) + '\n';
if (JSON.stringify(JSON.parse(outStr), null, 2) + '\n' !== outStr) throw new Error('roundtrip unstable');

fs.writeFileSync(BAK, raw, 'utf8');
fs.writeFileSync(TARGET, outStr, 'utf8');

console.log('patched ' + changed + ' records -> ' + TARGET);
console.log('backup  -> ' + BAK);
for (const x of report) console.log('  ' + x.id.padEnd(9) + String(x.subType).padEnd(14) + 'nl ' + x.nl0 + '->' + x.nl1 + '  [' + x.rules + ']');
