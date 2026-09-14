#!/usr/bin/env node
/**
 * 判分后端探活（ADR-0002 的取证脚本）。
 *
 * 用途：任务 3 要求「主后端失败时自动切换到备用后端」。切换链能不能成立，取决于
 * 备用端此刻是否真的活着 —— 公共免费端点说变就变（Piston 2026-02-15 起白名单化、
 * Wandbox 沙箱 500），所以这个脚本必须能在任何时刻重新给出事实，而不是相信文档。
 *
 * 它只读不写业务数据：探测结果打到 stdout，并存一份 tmp/backend-probe.json 备查。
 * 全部请求严格串行 + 间隔 300 ms，与判分链路同一口径（Godbolt 并发越高吞吐越低）。
 *
 * 用法：
 *   node scripts/probe-backends.mjs                 # 探 Godbolt 梯队 + Piston + Wandbox
 *   node scripts/probe-backends.mjs --godbolt-only  # 只探 Godbolt（CI 里用，避免第三方噪声）
 *   node scripts/probe-backends.mjs --ids cg132,cg142
 */
import fs from 'node:fs';

const HELLO = '#include <stdio.h>\nint main(void) { printf("ok\\n"); return 0; }\n';
const ARGS = '-std=c99 -Wall -Wextra';
const TIMEOUT_MS = 25000;
const OUT = 'tmp/backend-probe.json';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, body, headers = {}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 响应本身就是证据 */ }
    return { ms: Date.now() - t0, status: res.status, json, text: text.slice(0, 400) };
  } catch (e) {
    return { ms: Date.now() - t0, status: 0, json: null, text: String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

/** Godbolt：编译 + 执行一次 hello world，看 didExecute 与 stdout 是否都到位 */
async function probeGodbolt(compiler) {
  const r = await postJson(`https://godbolt.org/api/compiler/${compiler}/compile`, {
    compiler, lang: 'c', source: HELLO,
    options: {
      compilerOptions: { executorRequest: true, userArguments: ARGS, filters: { execute: true } },
      executeParameters: { stdin: '' },
    },
  });
  const j = r.json || {};
  const stdout = Array.isArray(j.stdout) ? j.stdout.map((l) => l.text).join('') : '';
  return {
    vendor: 'godbolt', compiler, http: r.status, ms: r.ms,
    didExecute: j.didExecute === true,
    buildCode: j.buildResult ? j.buildResult.code : null,
    exitCode: typeof j.code === 'number' ? j.code : null,
    stdout: stdout.trim(),
    usable: r.status === 200 && j.didExecute === true && stdout.trim() === 'ok',
    note: r.status === 200 ? undefined : r.text,
  };
}

async function listGodboltCCompilers() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://godbolt.org/api/compilers/c?fields=id,name', {
      headers: { Accept: 'application/json' }, signal: ctl.signal,
    });
    if (!res.ok) return { http: res.status, list: [] };
    const list = await res.json();
    return { http: res.status, list: Array.isArray(list) ? list : [] };
  } catch (e) {
    return { http: 0, list: [], error: String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

async function probePiston() {
  const r = await postJson('https://emkc.org/api/v2/piston/execute', {
    language: 'c', version: '*', files: [{ name: 'main.c', content: HELLO }], stdin: '',
    compile_timeout: 10000, run_timeout: 10000,
  });
  const j = r.json || {};
  return {
    vendor: 'piston', http: r.status, ms: r.ms,
    usable: r.status === 200 && j.run && typeof j.run.stdout === 'string' && j.run.stdout.trim() === 'ok',
    note: r.status === 200 ? (j.run ? 'run.stdout=' + JSON.stringify(j.run.stdout).slice(0, 60) : 'no run field') : r.text,
  };
}

async function probeWandbox() {
  const r = await postJson('https://wandbox.org/api/compile.json', {
    compiler: 'gcc-head-c', code: HELLO, stdin: '', 'compiler-option-raw': '-std=c99',
    save: false,
  });
  const j = r.json || {};
  return {
    vendor: 'wandbox', http: r.status, ms: r.ms,
    usable: r.status === 200 && typeof j.program_output === 'string' && j.program_output.trim() === 'ok',
    note: r.status === 200 ? JSON.stringify(j).slice(0, 120) : r.text,
  };
}

const report = { at: new Date().toISOString(), args: ARGS, godbolt: [], thirdParty: [] };

// 1. Godbolt 梯队：默认探现役主编译器 + 两个候选同厂梯队
const ids = (argVal('--ids') || 'cg132,cg142,cg131').split(',').map((s) => s.trim()).filter(Boolean);
if (!flag('--no-list')) {
  const { http, list } = await listGodboltCCompilers();
  const gcc = list.filter((c) => /x86-64 gcc/.test(c.name || ''));
  report.godboltCompilerList = { http, total: list.length, x86_64_gcc: gcc.slice(-8) };
  console.log(`Godbolt C 编译器列表 HTTP ${http}，共 ${list.length} 个；x86-64 gcc 末尾 8 个：`);
  for (const c of gcc.slice(-8)) console.log(`  ${c.id}  ${c.name}`);
  await sleep(300);
}

console.log('');
for (const id of ids) {
  const r = await probeGodbolt(id);
  report.godbolt.push(r);
  console.log(`Godbolt ${id}: HTTP ${r.http} ${r.ms}ms didExecute=${r.didExecute} build=${r.buildCode} exit=${r.exitCode} stdout=${JSON.stringify(r.stdout)} => ${r.usable ? 'USABLE' : 'UNUSABLE'}${r.note ? ' | ' + r.note : ''}`);
  await sleep(300);
}

if (!flag('--godbolt-only')) {
  console.log('');
  for (const p of [probePiston, probeWandbox]) {
    const r = await p();
    report.thirdParty.push(r);
    console.log(`${r.vendor}: HTTP ${r.http} ${r.ms}ms => ${r.usable ? 'USABLE' : 'UNUSABLE'} | ${r.note}`);
    await sleep(300);
  }
}

report.usableGodboltTiers = report.godbolt.filter((g) => g.usable).map((g) => g.compiler);
report.usableThirdParty = report.thirdParty.filter((t) => t.usable).map((t) => t.vendor);
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n可用 Godbolt 梯队：${report.usableGodboltTiers.join(' -> ') || '（无）'}`);
console.log(`可用第三方后端：${report.usableThirdParty.join(', ') || '（无）'}`);
console.log(`证据存 ${OUT}`);
