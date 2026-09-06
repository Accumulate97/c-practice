/**
 * 验证 dist/ 是否可以在 GitHub Pages 的任意子路径下工作。
 * 判定标准：index.html 里不得出现以 "/" 开头的绝对资源路径
 *（那意味着部署到 /<repo>/ 时资源 404）。
 *
 * 用法：npm run build && npm run verify:pages
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const indexFile = join(distDir, 'index.html')

if (!existsSync(indexFile)) {
  console.error('❌ 找不到 dist/index.html，请先执行 npm run build')
  process.exit(1)
}

const html = readFileSync(indexFile, 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
const absolute = refs.filter((r) => r.startsWith('/'))

console.log('构建产物资源引用：')
for (const ref of refs) console.log(`  ${ref.startsWith('/') ? '✗' : '✓'} ${ref}`)

const problems = []
if (absolute.length > 0) {
  problems.push(`发现 ${absolute.length} 个绝对路径引用（子目录部署会 404）：${absolute.join(', ')}`)
}
if (!/id="root"/.test(html)) problems.push('index.html 缺少 #root 挂载点')
if (!/\.js|\.css/.test(html)) problems.push('index.html 未引用任何打包后的 js/css')

if (problems.length > 0) {
  console.error('\n❌ Pages 路径校验失败：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\n✅ 全部资源为相对路径，dist/ 可放在任意子目录下访问')