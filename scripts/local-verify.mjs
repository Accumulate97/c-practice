// 主线程本地实机复验（BC04 收批步骤 ④ 的替代通道）
// 口径：gcc -std=c99 -w -O0（与 handbook §8 的 Godbolt 配方同优化级别，仅后端不同）
// 用途：对 batch/*.json 中「有 code + 有 runtimeStdout + code 内无【】空位」的记录做真机复跑比对。
// 不改任何题目 JSON，只读 + 输出报告。禁止据此手工置 verified=true。
// 用法：node scripts/local-verify.mjs <batch.json> [more.json ...]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const GCC = 'D:/mingw/mingw64/bin/gcc.exe';
const TMP = 'D:/C-practice/tmp/lv';
fs.mkdirSync(TMP, { recursive: true });

// stdin 覆盖表：note 里「stdin 为 ...」能自动解析的用解析值，解析不了的在这里写死
const STDIN_OVERRIDE = {
  '题9.152': '1 2 3 6 8 1 2 3 5 1 2 3 9 1 2 3',
};

function stdinFromNote(note) {
  if (!note) return '';
  const m = /stdin\s*为\s*([^；;]+)/.exec(note);
  if (!m) return '';
  let s = m[1].trim();
  s = s.replace(/[□·]/g, ' ').replace(/＜回车＞|<回车>/g, '').replace(/－/g, '-');
  s = s.replace(/个整数.*/g, '').trim();
  if (!/^[-\d\s]+$/.test(s)) return ''; // 只有纯数字串可用
  return s.replace(/\s+/g, ' ').trim();
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: local-verify.mjs <batch.json> ...'); process.exit(2); }

const rows = [];
for (const f of files) {
  const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of arr) {
    if (typeof r.code !== 'string' || !r.code.trim()) continue;
    if (typeof r.runtimeStdout !== 'string') continue;
    if (/【\d*】|【\s*】/.test(r.code)) { rows.push({ id: r.originalId, st: 'SKIP-BLANK' }); continue; }
    if (/argc|argv/.test(r.code)) { rows.push({ id: r.originalId, st: 'SKIP-ARGV' }); continue; }
    if (/fopen|freopen/.test(r.code)) { rows.push({ id: r.originalId, st: 'SKIP-FILE' }); continue; }

    const safe = r.originalId.replace(/[^\w]/g, '_');
    const src = path.join(TMP, safe + '.c');
    const exe = path.join(TMP, safe + '.exe');
    fs.writeFileSync(src, r.code, 'utf8');

    const cc = spawnSync(GCC, ['-std=c99', '-w', '-O0', src, '-o', exe], { encoding: 'utf8' });
    if (cc.status !== 0) {
      rows.push({ id: r.originalId, st: 'COMPILE-FAIL', detail: (cc.stderr || '').split('\n').slice(0, 3).join(' | ').slice(0, 220) });
      continue;
    }
    const stdin = STDIN_OVERRIDE[r.originalId] !== undefined ? STDIN_OVERRIDE[r.originalId] : stdinFromNote(r.note);
    const run = spawnSync(exe, [], { input: stdin, encoding: 'utf8', timeout: 15000 });
    if (run.error) { rows.push({ id: r.originalId, st: 'RUNTIME-ERR', detail: String(run.error.message).slice(0, 160) }); continue; }
    let got = run.stdout == null ? '' : String(run.stdout);
    got = got.replace(/\r\n/g, '\n').replace(/\r$/, ''); // Windows 控制台 CRLF -> LF（Godbolt 为 Linux，存档口径即 LF）
    got = got.replace(/\n$/, '');            // 口径：仅剥末尾一个换行，行尾空格保留
    const want = r.runtimeStdout;
    const needsStdin = /scanf|getchar|gets/.test(r.code);
    rows.push({
      id: r.originalId, sub: r.subType,
      st: got === want ? 'MATCH' : 'MISMATCH',
      stdin: needsStdin ? (stdin ? 'used(' + stdin.length + 'ch)' : 'NONE!') : '-',
      got: got === want ? '' : JSON.stringify(got).slice(0, 200),
      want: got === want ? '' : JSON.stringify(want).slice(0, 200),
    });
  }
}

const cnt = {};
for (const x of rows) cnt[x.st] = (cnt[x.st] || 0) + 1;
for (const x of rows) {
  console.log(x.st.padEnd(13) + String(x.id).padEnd(10) + String(x.sub || '').padEnd(14) + 'stdin=' + String(x.stdin || '-') + (x.detail ? '  ' + x.detail : ''));
  if (x.st === 'MISMATCH') { console.log('              got : ' + x.got); console.log('              want: ' + x.want); }
}
console.log('---');
console.log('total=' + rows.length + '  ' + Object.entries(cnt).map(([k, v]) => k + '=' + v).join('  '));
try { console.log('gcc: ' + execFileSync(GCC, ['--version'], { encoding: 'utf8' }).split('\n')[0]); } catch (e) { console.log('gcc: version query failed (' + e.code + ')'); }


