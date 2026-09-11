#!/usr/bin/env node
/**
 * build.mjs —— omp-architect 插件打包（生产形态组装；阶段二，TB-1789118466569-9frw0）。
 *
 * 用法：bun scripts/build.mjs   （须在 omp-architect 仓根执行；依赖 Bun 与大脑仓同级挂载）
 *
 * 产物 dist-plugin/：
 *   package.json        ← 插件清单（omp.extensions 指向 dist/extension.js）
 *   dist/extension.js   ← Bun 打包的扩展入口（core 内联，生产态无大脑仓也可运行）
 *   dist/index.js       ← custom-tools 形态（备用）
 *   knowledge/          ← 大脑知识库五类只读快照（发布时点切片）
 *   skills/             ← 五个 SKILL 快照
 *
 * 安装（生产）：omp plugin install ./dist-plugin 或 marketplace/git
 * 升级：大脑知识库/核心更新 → 重跑本脚本 → 发新版本 → 生产端 omp plugin upgrade
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = process.cwd()
const brain = resolve(here, '..')
const out = process.env.PLUGIN_OUT ? resolve(process.env.PLUGIN_OUT) : join(here, 'dist-plugin')
const distOut = process.env.BUILD_OUT ? resolve(process.env.BUILD_OUT) : join(here, 'dist')

if (!existsSync(join(here, 'src', 'index.ts'))) { console.error('✗ 须在 omp-architect 仓根执行'); process.exit(1) }
const kbSrc = join(brain, 'architect-knowledge')
if (!existsSync(kbSrc)) { console.error('✗ 找不到大脑知识库：' + kbSrc); process.exit(1) }
const skillsSrc = join(brain, 'skills')
const coreLib = join(brain, 'packages', 'architect-core', 'lib')
if (!existsSync(coreLib)) { console.error('✗ core 未构建：先 npm --prefix ../packages/architect-core run build'); process.exit(1) }

console.log('① Bun 打包扩展与 custom-tools 入口（core 内联）')
rmSync(distOut, { recursive: true, force: true })
for (const entry of ['src/extension.ts', 'src/index.ts']) {
  const p = Bun.spawnSync(['bun', 'build', entry, '--outdir', distOut, '--target', 'bun'])
  if (p.exitCode !== 0) { console.error(p.stderr.toString()); process.exit(1) }
}

console.log('② 组装 dist-plugin/')
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'dist'), { recursive: true })
cpSync(distOut, join(out, 'dist'), { recursive: true })
for (const d of ['knowledge', 'skills']) mkdirSync(join(out, d), { recursive: true })

console.log('③ 知识库快照（五类全量，不含 evidence 大文件与 harｖested）')
for (const dir of ['meta', 'principle', 'scenario', 'practice', 'reference']) {
  const src = join(kbSrc, dir)
  if (existsSync(src)) cpSync(src, join(out, 'knowledge', dir), { recursive: true })
}
// 快照标记：lintKnowledgeAt 识别后进入快照宽松模式（R4/R5/R7 降 warning）
writeFileSync(join(out, 'knowledge', '.snapshot'), `snapshot: true
builtAt: ${new Date().toISOString()}
source: brain architect-knowledge（发布时点切片）`)

console.log('④ skills 快照')
cpSync(skillsSrc, join(out, 'skills'), { recursive: true })

console.log('⑤ 插件清单')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  description: pkg.description + '（生产打包形态，含知识库只读快照）',
  license: pkg.license,
  type: 'module',
  omp: { extensions: ['dist/extension.js'] },
}, null, 2))

console.log(`✅ 打包完成：${out}
安装（生产机器）：omp plugin install <本目录>（或推 git 后 omp plugin install github:lomehong/omp-architect）
升级：大脑知识库/核心更新 → 重跑本脚本 → 发新版本 → 生产端 omp plugin upgrade`)
