#!/usr/bin/env node
// validate-converted.mjs — 用 Ajv(2020-12) + ajv-formats 对 converted/c-ch*.json 逐题校验 Problem.schema.json
// 用法: node scripts/validate-converted.mjs   （全部 pass 退出码 0，否则 1）
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = 'D:/C-practice';
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'Problem.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const dir = path.join(ROOT, 'converted');
const files = fs.readdirSync(dir).filter((f) => /^c-ch\d{2}\.json$/.test(f)).sort();

let total = 0, pass = 0, fail = 0;
const ids = new Map();
for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const probs = Array.isArray(doc.problems) ? doc.problems : [];
  const errs = [];
  for (const p of probs) {
    total++;
    if (validate(p)) pass++;
    else {
      fail++;
      for (const e of validate.errors) errs.push('    ' + (p.id || '(no-id)') + ' ' + (e.instancePath || '/') + ' ' + e.message);
    }
    if (p.id) {
      if (ids.has(p.id)) { fail++; errs.push('    duplicate id ' + p.id + ' (first in ' + ids.get(p.id) + ')'); }
      else ids.set(p.id, f);
    }
  }
  const ok = errs.length === 0;
  console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + f + '  problems=' + probs.length + '  errors=' + errs.length);
  if (errs.length) console.log(errs.join('\n'));
}
console.log('------------------------------------------------------------------');
console.log('TOTAL ' + total + ' problems | schema pass ' + pass + ' | fail ' + fail + ' | unique ids ' + ids.size);
process.exit(fail === 0 && ids.size === total ? 0 : 1);
