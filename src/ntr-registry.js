/**
 * [INPUT]: 依赖 node:fs、node:os、node:path 读取 ~/.dsh/dsh-ntr/agents.json
 * [OUTPUT]: 导出 readNtrRegistry，提供已配置 NTR Agent 清单与会话模型映射
 * [POS]: src/ 的 NTR 状态只读适配层，将 dsh-ntr 磁盘配置解耦为稳定内存结构
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ============================================================================
// 默认路径与数据规整
// ============================================================================

export function defaultNtrAgentsPath() {
  return path.join(os.homedir(), '.dsh', 'dsh-ntr', 'agents.json')
}

/**
 * 规整单个 NTR Agent 定义。
 * @param {unknown} raw
 * @returns {{ id: string, title: string, command: string, args: string[], env: Record<string, string>, exposedModels: string[] } | null}
 */
function normalizeAgent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (!id || !command) return null
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id
  const args = Array.isArray(raw.args) ? raw.args.filter(x => typeof x === 'string') : []
  const env = {}
  if (raw.env && typeof raw.env === 'object') {
    for (const [k, v] of Object.entries(raw.env)) {
      if (typeof v === 'string') env[k] = v
    }
  }
  const exposedModels = Array.isArray(raw.exposedModels)
    ? raw.exposedModels.filter(x => typeof x === 'string')
    : []
  return { id, title, command, args, env, exposedModels }
}

/**
 * 只读解析 ~/.dsh/dsh-ntr/agents.json。
 * 文件缺失或格式损坏时安全降级为空注册表，不抛异常中断宿主。
 *
 * @param {string} [filePath]
 * @returns {{
 *   exists: boolean,
 *   filePath: string,
 *   defaultAgentId: string | null,
 *   agents: Array<{ id: string, title: string, command: string, args: string[], env: Record<string, string>, exposedModels: string[] }>,
 *   sessions: Record<string, { agentId: string, modelId: string | null }>
 * }}
 */
export function readNtrRegistry(filePath = defaultNtrAgentsPath()) {
  const empty = {
    exists: false,
    filePath,
    defaultAgentId: null,
    agents: [],
    sessions: {},
  }
  let rawText
  try {
    rawText = fs.readFileSync(filePath, 'utf8')
  } catch {
    return empty
  }

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { ...empty, exists: true }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ...empty, exists: true }
  }

  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.map(normalizeAgent).filter(Boolean)
    : []

  const defaultAgentId = typeof parsed.defaultAgentId === 'string' && parsed.defaultAgentId.trim()
    ? parsed.defaultAgentId.trim()
    : (agents[0]?.id ?? null)

  /** @type {Record<string, { agentId: string, modelId: string | null }>} */
  const sessions = {}

  if (parsed.conversations && typeof parsed.conversations === 'object') {
    for (const [sessionId, entry] of Object.entries(parsed.conversations)) {
      if (!entry || typeof entry !== 'object') continue
      const agentId = typeof entry.agentId === 'string' ? entry.agentId.trim() : ''
      if (!agentId) continue
      const modelId = typeof entry.modelId === 'string' && entry.modelId.trim()
        ? entry.modelId.trim()
        : null
      sessions[sessionId] = { agentId, modelId }
    }
  }

  if (Array.isArray(parsed.chatSessions)) {
    for (const row of parsed.chatSessions) {
      if (!row || typeof row !== 'object') continue
      const dshSessionId = typeof row.dshSessionId === 'string' ? row.dshSessionId.trim() : ''
      const agentId = typeof row.agentId === 'string' ? row.agentId.trim() : ''
      if (!dshSessionId || !agentId) continue
      const modelId = typeof row.modelId === 'string' && row.modelId.trim()
        ? row.modelId.trim()
        : (sessions[dshSessionId]?.modelId ?? null)
      sessions[dshSessionId] = { agentId, modelId }
    }
  }

  return {
    exists: true,
    filePath,
    defaultAgentId,
    agents,
    sessions,
  }
}
