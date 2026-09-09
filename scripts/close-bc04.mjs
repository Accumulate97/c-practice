// BC04 收批落盘（幂等）：
//   ① §3.2 表 BC04 行 [ ] -> [x] 36 / 0
//   ② §3.2 交付登记行（插在 BD06 登记行之后）
//   ③ §3.3 快照行「已交付 27 批」-> 28 批
//   ④ 文末追加 §15.27
//   ⑤ 补落盘 batch/p201-212.report.md
import fs from 'node:fs';

const ROOT = 'D:/C-practice-extract/batch';
const PROG = ROOT + '/_progress.md';
const REPORT = ROOT + '/p201-212.report.md';
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

const orig = fs.readFileSync(PROG, 'utf8');
const BAKDIR = 'D:/C-practice/tmp';
fs.mkdirSync(BAKDIR, { recursive: true });
fs.writeFileSync(BAKDIR + '/_progress.md.bak27', orig, 'utf8');

let md = orig.replace(/^\uFEFF/, '');
const done = [];

const rowOld = '| BC04 | C | 9 | p201-212.json | p201-p212 | 12 | [ ] |  |  |';
const rowNew = '| BC04 | C | 9 | p201-212.json | p201-p212 | 12 | [x] | 36 | 0 |';
if (md.includes(rowOld)) { md = md.replace(rowOld, rowNew); done.push('[1] 3.2 table BC04 -> [x] 36 / 0'); }
else if (md.includes(rowNew)) done.push('[1] 3.2 table BC04 already [x], skip');
else throw new Error('BC04 table row not found');

const regLine = '> 2026-09-08 交付登记（主线程五步收批）：**BC04**（车道 C 末批，第 9 章 指针 9.2 填空题，题9.119–9.154，36 题连续无跳号，真存疑 **0** 处）。type＝填空题 36（`multi_blank` 19 / `code_reading` 17）；含代码 35、`code=null` 1（题9.137 定义内嵌题干）；`answer` 非空 0、`runtimeStdout` 18、`expectedVerified` true 18 / false 18。check-lane PASS（E=0 W=0 code=35 vfy=18）；cross-check 本批 0 命中、全库 11 命中 unregistered=0；主线程本地实机复验（gcc 8.1.0 `-std=c99 -w -O0`）**18/18 MATCH、0 MISMATCH**。★车道会话写盘后崩溃，未产 report / judge.json ⇒ 报告由主线程依 §15.22 先例补落盘（`p201-212.report.md`，9519 字符），实机凭据走本地通道 `scripts/local-verify.mjs`，不追认不存在的车道日志。同批修复崩溃遗留「行分隔逗号」缺陷 6 条（题9.149–9.154），详见 §15.27。**第 9 章 193/193 收口，批次 28/28，全库 1008/1008 = 100%。**';
if (!md.includes('**BC04**（车道 C 末批')) {
  const ai = md.indexOf('> 2026-09-08 交付登记（主线程五步收批）：**BD06**');
  if (ai < 0) throw new Error('BD06 registration anchor not found');
  const le = md.indexOf('\n', ai);
  md = md.slice(0, le + 1) + regLine + '\n' + md.slice(le + 1);
  done.push('[2] registration line inserted after BD06');
} else done.push('[2] registration line exists, skip');

const snapOld = '各车道剩余页次：A=0 B=0 C=12 D=0，合计 12 页次 / 1 批（BC04）。批次总数 28，**已交付 27 批**。';
const snapNew = '各车道剩余页次：A=0 B=0 C=0 D=0，合计 0 页次 / 0 批。批次总数 28，**已交付 28 批（全交付；2026-09-08 BC04 收口，见 §15.27）**。';
if (md.includes(snapOld)) { md = md.replace(snapOld, snapNew); done.push('[3] 3.3 snapshot -> 28/28'); }
else if (md.includes(snapNew)) done.push('[3] 3.3 snapshot already updated, skip');
else done.push('[3] 3.3 snapshot pattern not matched, skip (no change)');

if (!md.includes('### 15.27')) {
  md = md.replace(/\s*$/, '\n') + rd(BAKDIR + '/bc04-section.md');
  done.push('[4] 15.27 appended');
} else done.push('[4] 15.27 exists, skip');

fs.writeFileSync(PROG, md, 'utf8');

if (!fs.existsSync(REPORT)) {
  const rep = rd(BAKDIR + '/bc04-report.md');
  fs.writeFileSync(REPORT, rep, 'utf8');
  done.push('[5] p201-212.report.md written (' + rep.length + ' chars)');
} else done.push('[5] p201-212.report.md exists, skip');

console.log(done.join('\n'));
console.log('_progress.md: ' + orig.length + ' -> ' + md.length + ' chars');
