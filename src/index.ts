/**
 * omp-architect · 架构师 Agent 的 omp 宿主外壳（唯一入口）。
 *
 * 职责：把 architect-core（宿主中立纯函数，唯一事实源）注册为 omp 工具：
 * - architect_digest：需求准入（六项覆盖）
 * - architect_design：方案覆盖自检（六维度+五问）
 * - architect_review：方案评审评分 + 骨架
 * - architect_lint：知识库机械校验（R1~R9，知识库改动提交前必跑）
 *
 * 安装（v3 容器）：大脑仓挂 /opt/architect，agent 级工具发现指向本文件——
 * `~/.omp/agent/tools/architect/index.ts` → `/opt/architect/omp-architect/src/index.ts`。
 * 核心经相对路径引用（本仓必须位于大脑仓内：`../packages/architect-core`）；
 * 后续核心发布为 npm 包后可改为版本依赖（见任务 TB-1789108205507-kbsoa 走查记录）。
 *
 * omp 无 dsh 账本 → 治理类动作（push/发布/删除）一律停并 `ask` 主人，不得静默放行。
 *
 * @module omp-architect
 */
import { checkDesign, renderReviewSkeleton, checkDigest, lintKnowledgeAt, type CoverageResult, type DigestInput } from '../../packages/architect-core/src/index.ts'

interface OptionalLike { optional(): unknown }
interface ZodLike {
  object(fields: Record<string, unknown>): unknown
  string(): OptionalLike
  boolean(): OptionalLike
  array(schema: unknown): OptionalLike
}

export interface OmpApi {
  cwd?: string
  hasUI?: boolean
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void }
  zod?: ZodLike
  arktype?: ZodLike
  typebox?: ZodLike
  pi?: { zod?: ZodLike }
}

export interface OmpCustomTool {
  name: string
  label: string
  description: string
  loadMode: 'essential'
  parameters: unknown
  execute: (toolCallId: string, params: unknown, onUpdate: unknown, ctx: unknown, signal: unknown) => Promise<OmpToolResult>
}

export interface OmpToolResult {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}

function resolveZod(api: OmpApi): ZodLike {
  const z = api.zod ?? api.pi?.zod ?? api.arktype ?? api.typebox
  if (z === undefined) {
    throw new Error('未找到 zod 兼容 schema builder（pi.zod / arktype / typebox）——无法构建工具参数 schema')
  }
  return z
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function designDetails(value: CoverageResult): Record<string, unknown> {
  const dimensionsText = value.dimensions
    .map(d => `${d.title} ${d.score}/10${d.issues.length > 0 ? `（${d.issues.join('；')}）` : ''}`)
    .join('\n')
  return {
    total: value.total,
    max: value.max,
    pass: value.pass,
    five_questions_answered: value.fiveQuestions.answered,
    dimensions_text: dimensionsText,
    issues: value.issues,
  }
}

/** ── architect_digest：需求准入 ── */
function digestTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_digest',
    label: '架构师需求准入',
    description:
      '架构师需求准入：对结构化需求做六项覆盖检查（需求/系统/证据/风险/验证/不确定性），' +
      '产出准入结论与补齐清单。不足处登记「未知/待验证」，**不得编造**。' +
      '准入不通过时按 missing 清单补齐后重跑；通过后进入 architect-design 流程（读 architect-design 技能）。',
    loadMode: 'essential',
    parameters: z.object({
      requirement: z.string().optional(),
      do_items: z.array(z.string()).optional(),
      dont_items: z.array(z.string()).optional(),
      to_confirm: z.array(z.string()).optional(),
      assumptions: z.array(z.string()).optional(),
      blockers: z.array(z.string()).optional(),
      systems: z.array(z.string()).optional(),
      evidences: z.array(z.object({ conclusion: z.string().optional(), source: z.string().optional() })).optional(),
      risks_checked: z.boolean().optional(),
      validation_plan: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
      const requirement = str(a.requirement)
      if (requirement.trim() === '') throw new Error('requirement 必填（需求原文）')
      const doItems = asStringArray(a.do_items)
      if (doItems.length === 0) throw new Error('do_items 必填（至少一项「做」；不做与待确认用 dont_items/to_confirm 表达）')
      const input: DigestInput = {
        requirement,
        doItems,
        dontItems: asStringArray(a.dont_items),
        toConfirm: asStringArray(a.to_confirm),
        assumptions: asStringArray(a.assumptions),
        blockers: asStringArray(a.blockers),
        systems: asStringArray(a.systems),
        evidences: Array.isArray(a.evidences)
          ? a.evidences.map(e => {
              const o = (e ?? {}) as Record<string, unknown>
              return { conclusion: str(o.conclusion), source: str(o.source) }
            })
          : [],
        risksChecked: a.risks_checked === true,
        validationPlan: str(a.validation_plan),
      }
      const result = checkDigest(input)
      const coverageText = result.coverage.map(c => `${c.ok ? '✅' : '⛔'} ${c.item}：${c.note}`).join('\n')
      const head = result.admission === '通过' ? '✅ 需求准入通过' : '⛔ 需求准入不通过'
      const text = [
        head,
        coverageText,
        result.missing.length > 0 ? `补齐清单：\n- ${result.missing.join('\n- ')}` : '',
        result.next,
      ].filter(Boolean).join('\n\n')
      return {
        content: [{ type: 'text', text }],
        details: { admission: result.admission, missing: result.missing, next: result.next },
      }
    },
  }
}

/** ── architect_design：设计期覆盖自检 ── */
function designTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_design',
    label: '架构师方案自检',
    description:
      '架构师方案覆盖自检（设计期）：按六维度+五问检查技术方案的结构完整性与填写纪律' +
      '（缺章节/空单元格/未填占位符），给出得分与逐项修复指引。产出方案前自检用；评审期请用 architect_review。',
    loadMode: 'essential',
    parameters: z.object({
      design_md: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
      const md = str(a.design_md)
      if (md.trim() === '') throw new Error('design_md 必填（方案 markdown 全文）')
      const result = checkDesign(md)
      const head = result.pass ? `✅ 自检通过：${result.total}/${result.max}` : `⛔ 自检未通过：${result.total}/${result.max}`
      const details = designDetails(result)
      const text = [
        head,
        String(details.dimensions_text ?? ''),
        '修复上方 issue 后重跑自检；通过后交 architect_review 评审（自报 ≠ 完成）',
      ].filter(Boolean).join('\n')
      return { content: [{ type: 'text', text }], details }
    },
  }
}

/** ── architect_review：评审评分 + 骨架 ── */
function reviewTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_review',
    label: '架构师方案评审',
    description:
      '架构师方案评审（评审期）：五问+六维度覆盖评分，产出可直接落盘的评审结论骨架。' +
      '**评审通过 ≠ 方案落定**：落定以主人确认为准（自报 ≠ 完成）。评审者应抽查证据回源后再定稿。',
    loadMode: 'essential',
    parameters: z.object({
      design_md: z.string().optional(),
      title: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
      const md = str(a.design_md)
      if (md.trim() === '') throw new Error('design_md 必填（方案 markdown 全文）')
      const title = str(a.title).trim() !== '' ? str(a.title).trim() : '未命名方案'
      const result = checkDesign(md)
      const head = result.pass
        ? `✅ 评审评分 ${result.total}/${result.max}：通过（待主人确认落定）`
        : `⛔ 评审评分 ${result.total}/${result.max}：驳回`
      return {
        content: [{
          type: 'text',
          text: `${head}\n\n评审骨架已生成（review_md 字段）：抽查证据回源、补评语后落盘。注意自报 ≠ 完成——落定以主人确认为准。`,
        }],
        details: { total: result.total, max: result.max, pass: result.pass, review_md: renderReviewSkeleton(title, result) },
      }
    },
  }
}

/** ── architect_lint：知识库结构校验（R1~R9，与 dsh 同名同语义）── */
function lintTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_lint',
    label: '架构师知识库校验',
    description:
      '知识库机械校验（knowledge-lint R1~R9）：必填字段/状态枚举/队列与索引一致/ref 存在性/**设备路径禁止入库**。' +
      '落在知识库前与提交前必跑。omp 无插件强制面 → 本工具即纪律入口；也可 bash 兜底：' +
      '`node /opt/architect/dsh-architect/scripts/lint-knowledge.mjs /opt/architect/architect-knowledge`。',
    loadMode: 'essential',
    parameters: z.object({
      kb_root: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
      const kbRoot = str(a.kb_root).trim() !== '' ? str(a.kb_root).trim() : 'architect-knowledge'
      const r = lintKnowledgeAt(kbRoot)
      const isoNote = r.isolated
        ? `⚠️ 隔离上下文（快照/活仓挂载）：KB 外 ref 降 warning，备案计数 ${r.warnings.length} 条；如需严格请加 --full`
        : ''
      const head = r.pass
        ? `✅ 知识库校验通过：${r.stats.entries} 条（已确认 ${r.stats.confirmed} / 待审核 ${r.stats.pending}）${r.isolated ? '（隔离上下文）' : ''}`
        : `⛔ 知识库校验失败：错误 ${r.errors.length} 处`
      const text = [
        head,
        isoNote,
        `root=${r.root}`,
        ...r.errors.map(i => `⛔ [${i.rule}] ${i.path}：${i.message}`),
        r.errors.length > 0 ? '修复后重跑；error 非空期间不得提交。' : '',
      ].filter(Boolean).join('\n')
      return {
        content: [{ type: 'text', text }],
        details: {
          pass: r.pass,
          isolated: r.isolated,
          warningCount: r.warnings.length,
          root: r.root,
          entries: r.stats.entries,
          confirmed: r.stats.confirmed,
          pending: r.stats.pending,
          errors: r.errors,
          warnings: r.warnings,
        },
      }
    },
  }
}

/** 注册四个工具（供测试与高级宿主直接调用；builder 缺失抛错）。 */
export function createTools(api: OmpApi): OmpCustomTool[] {
  const z = resolveZod(api)
  return [digestTool(z), designTool(z), reviewTool(z), lintTool(z)]
}

/** omp CustomToolFactory：模块默认导出。builder 缺失降级为空数组 + 告警（不炸宿主加载）。 */
export default function factory(api: OmpApi): OmpCustomTool[] {
  try {
    return createTools(api)
  } catch (e) {
    api.logger?.warn?.('[omp-architect] 工具注册失败（跳过）: ' + (e instanceof Error ? e.message : String(e)))
    return []
  }
}
