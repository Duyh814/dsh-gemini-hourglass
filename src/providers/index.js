/**
 * [INPUT]: 依赖 src/providers/agy.js 与 src/providers/codex.js
 * [OUTPUT]: 导出 createDefaultProviders 与 resolveProvider
 * [POS]: src/providers/ 的适配器注册中心，按开放封闭原则将 NTR Agent 路由到对应配额采集器
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { createAgyProvider } from './agy.js'
import { createCodexProvider } from './codex.js'

/**
 * 创建内置配额采集适配器列表。
 * @param {{ agy?: object, codex?: object }} [options]
 */
export function createDefaultProviders(options = {}) {
  return [
    createAgyProvider(options.agy),
    createCodexProvider(options.codex),
  ]
}

/**
 * 根据 NTR Agent 定义匹配第一个支持的配额适配器。
 * @param {Array<{ id: string, matches: (agentDef: object) => boolean, fetchQuota: (agentDef: object) => Promise<object> }>} providers
 * @param {object} agentDef
 */
export function resolveProvider(providers, agentDef) {
  for (const provider of providers) {
    if (provider.matches(agentDef)) return provider
  }
  return null
}
