/**
 * [INPUT]: 依赖 node:fs、node:os、node:path 与 src/format.js 的数值/时间工具
 * [OUTPUT]: 导出 createCodexProvider、parseCodexRateLimits、isCodexAgent
 * [POS]: src/providers/ 的 OpenAI Codex 配额采集适配器，只读扫描 ~/.codex/sessions 最新 rate_limits 快照
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clampPercent, normalizeIsoTime } from '../format.js'

// ============================================================================
// Codex rate_limits 结构解析
// ============================================================================

function classifyCodexWindow(windowMinutes) {
  const mins = Number(windowMinutes)
  if (!Number.isFinite(mins)) return 'other'
  if (mins >= 240 && mins <= 360) return '5h'
  if (mins >= 9600 && mins <= 10800) return 'weekly'
  return 'other'
}

function formatWindowLabel(windowMinutes) {
  const mins = Number(windowMinutes)
  if (mins === 300) return 'Five Hour Limit Remaining'
  if (mins === 10080) return 'Weekly Limit Remaining'
  if (mins === 43200) return 'Monthly Limit Remaining'
  if (Number.isFinite(mins) && mins >= 60) {
    return `${Math.round(mins / 60)}h Limit Remaining`
  }
  return 'Rate Limit Remaining'
}

function toBucket(slotName, slot) {
  if (!slot || typeof slot !== 'object') return null
  const used = clampPercent(slot.used_percent)
  if (used === null) return null
  const remaining = Math.round((100 - used) * 10) / 10
  const win = classifyCodexWindow(slot.window_minutes)
  return {
    id: `codex-${slotName}-${win}`,
    label: formatWindowLabel(slot.window_minutes),
    window: win,
    remainingPercent: remaining,
    usedPercent: used,
    resetAt: normalizeIsoTime(slot.resets_at),
    description: Number.isFinite(Number(slot.window_minutes))
      ? `window: ${slot.window_minutes} min`
      : null,
  }
}

/**
 * 将 Codex 会话日志中的单个 `rate_limits` 对象规整为插件统一分组格式。
 * @param {object} rateLimits
 * @param {string | null} [capturedAt]
 */
export function parseCodexRateLimits(rateLimits, capturedAt = null) {
  if (!rateLimits || typeof rateLimits !== 'object') return null
  const buckets = [
    toBucket('primary', rateLimits.primary),
    toBucket('secondary', rateLimits.secondary),
  ].filter(Boolean)

  if (buckets.length === 0) return null

  let fiveHour = null
  let weekly = null
  const extraBuckets = []
  for (const b of buckets) {
    if (b.window === '5h' && !fiveHour) fiveHour = b
    else if (b.window === 'weekly' && !weekly) weekly = b
    else extraBuckets.push(b)
  }

  const groupName = typeof rateLimits.limit_name === 'string' && rateLimits.limit_name.trim()
    ? rateLimits.limit_name.trim()
    : 'OpenAI Codex'

  return {
    provider: 'codex',
    description: capturedAt ? `Latest Codex session snapshot (${capturedAt})` : null,
    groups: [
      {
        id: 'codex',
        name: groupName,
        description: rateLimits.plan_type ? `Plan: ${rateLimits.plan_type}` : 'Codex subscription quota',
        fiveHour,
        weekly,
        extraBuckets,
      },
    ],
  }
}

// ============================================================================
// 本地会话目录扫描（只读最新 JSONL）
// ============================================================================

function collectJsonlFiles(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFiles(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(full)
        out.push({ path: full, mtimeMs: stat.mtimeMs })
      } catch {
        // 忽略并发消失的临时文件
      }
    }
  }
  return out
}

function readLatestRateLimitsFromDir(sessionsDir) {
  const files = collectJsonlFiles(sessionsDir)
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const file of files.slice(0, 12)) {
    let text
    try {
      text = fs.readFileSync(file.path, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]
      if (!line || !line.includes('rate_limits')) continue
      try {
        const obj = JSON.parse(line)
        const rl = obj?.payload?.rate_limits ?? obj?.rate_limits
        if (rl && (rl.primary || rl.secondary)) {
          return {
            rateLimits: rl,
            capturedAt: normalizeIsoTime(obj.timestamp) ?? new Date(file.mtimeMs).toISOString(),
          }
        }
      } catch {
        // 忽略单行残缺 JSON
      }
    }
  }
  return null
}

/**
 * 判断某个 NTR Agent 是否属于 Codex。
 * @param {{ id?: string, command?: string, args?: string[] }} agentDef
 */
export function isCodexAgent(agentDef) {
  const id = String(agentDef?.id ?? '').toLowerCase()
  const cmd = String(agentDef?.command ?? '').toLowerCase()
  const args = Array.isArray(agentDef?.args) ? agentDef.args.join(' ').toLowerCase() : ''
  return id === 'codex' || id.startsWith('codex-') || cmd.includes('codex') || args.includes('codex-acp')
}

/**
 * 创建 Codex 配额采集适配器。
 * @param {{ sessionsDir?: string }} [deps]
 */
export function createCodexProvider(deps = {}) {
  const sessionsDir = deps.sessionsDir ?? path.join(os.homedir(), '.codex', 'sessions')
  return {
    id: 'codex',
    matches: isCodexAgent,
    async fetchQuota() {
      const found = readLatestRateLimitsFromDir(sessionsDir)
      if (!found) {
        throw new Error('未在 ~/.codex/sessions 中找到包含 rate_limits 的会话快照')
      }
      const parsed = parseCodexRateLimits(found.rateLimits, found.capturedAt)
      if (!parsed) {
        throw new Error('Codex 会话快照中的 rate_limits 字段不包含可用配额')
      }
      return parsed
    },
  }
}
