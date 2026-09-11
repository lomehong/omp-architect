/**
 * omp-architect 扩展入口（package.json#omp.extensions 指向本文件）。
 *
 * 职责：把 architect-core 的四个检查器注册为 omp 原生工具（pi.registerTool），
 * 与 custom-tools 形态（src/index.ts 的 CustomToolFactory）**同名同语义**。
 *
 * 说明：ExtensionAPI 注入 pi.zod / pi.arktype / pi.typebox（兼容 builder），
 * createTools 会用同一 resolveZod 逻辑取用。本扩展不落盘、不联网；
 * 治理纪律（push/发布/删除 → ask 主人）由适配层与 SKILL 承载。
 */
import { createTools, type OmpApi } from './index.ts'

type AnyFn = (...args: unknown[]) => unknown

interface ExtApiLike {
  registerTool?: (tool: unknown) => unknown
  registerCommand?: (cmd: unknown) => unknown
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void }
  zod?: unknown
  arktype?: unknown
  typebox?: unknown
  pi?: { zod?: unknown }
}

export default function architectExtension(pi: ExtApiLike): unknown {
  const api = pi as unknown as OmpApi & ExtApiLike
  const tools = createTools(api as never)
  for (const t of tools) {
    try {
      pi.registerTool?.({
        name: t.name,
        description: t.description,
        parameters: (t as unknown as { parameters: unknown }).parameters,
        execute: async (toolCallId: string, params: unknown, onUpdate: unknown, ctx: unknown, signal: unknown) =>
          t.execute(toolCallId, params, onUpdate, ctx, signal),
      })
      pi.logger?.info?.(`[omp-architect] 工具已注册：${t.name}`)
    } catch (e) {
      pi.logger?.warn?.(`[omp-architect] 工具 ${t.name} 注册失败（跳过）: ` + (e instanceof Error ? e.message : String(e)))
    }
  }
  return undefined
}
