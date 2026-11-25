/**
 * [INPUT]: 无外部模块依赖，仅使用 Node 标准路径分隔符与内置 API
 * [OUTPUT]: 导出百分比规整、重置倒计时格式化、模型到配额分组匹配、PATH 补全等纯函数
 * [POS]: src/ 公共纯逻辑层，供 providers、sync-service 及单元测试复用
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import os from 'node:os'
import path from 'node:path'

// ============================================================================
// 数值与百分比规整
// ============================================================================

/**
 * 将 0..1 的剩余比例规整为保留一位小数的百分比（0..100）。
 * @param {unknown} fraction
 * @returns {number | null}
 */
export function fractionToPercent(fraction) {
  const num = Number(fraction)
  if (!Number.isFinite(num)) return null
  const clamped = Math.max(0, Math.min(1, num))
  return Math.round(clamped * 1000) / 10
}

/**
 * 将 0..100 的百分比规整为保留一位小数并钳制在 0..100。
 * @param {unknown} value
 * @returns {number | null}
 */
export function clampPercent(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const clamped = Math.max(0, Math.min(100, num))
  return Math.round(clamped * 10) / 10
}

/**
 * 由剩余百分比计算已用百分比，保证二者之和为 100 且无浮点尾差。
 * @param {number} remainingPercent
 * @returns {number}
 */
export function remainingToUsed(remainingPercent) {
  return Math.round((100 - clampPercent(remainingPercent)) * 10) / 10
}

/**
 * 规整 ISO 时间戳字符串，非法值返回 null。
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeIsoTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const d = new Date(value.trim())
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ============================================================================
// 模型标识与配额分组匹配
// ============================================================================

/**
 * 将文本切分为小写匹配词元。
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * 从形如 `agy@gemini-4-neon` 的路由 ID 中拆出 agentId 与裸模型名。
 * @param {string | null | undefined} modelId
 * @returns {{ agentId: string | null, modelSlug: string }}
 */
export function parseRouteModelId(modelId) {
  const raw = String(modelId ?? '').trim()
  if (!raw) return { agentId: null, modelSlug: '' }
  const at = raw.indexOf('@')
  if (at > 0) {
    return {
      agentId: raw.slice(0, at),
      modelSlug: raw.slice(at + 1),
    }
  }
  return { agentId: null, modelSlug: raw }
}

/**
 * 为给定的模型标识选择最匹配的配额分组。
 * @param {Array<{ id?: string, name?: string, description?: string, fiveHour?: object | null, weekly?: object | null }>} groups
 * @param {string | null | undefined} modelId
 * @returns {object | null}
 */
export function matchQuotaGroup(groups, modelId) {
  if (!Array.isArray(groups) || groups.length === 0) return null
  const { modelSlug } = parseRouteModelId(modelId)
  const slug = modelSlug.toLowerCase()

  if (!slug) {
    return groups.find(g => g.fiveHour || g.weekly) ?? groups[0]
  }

  // 1. 专属 Argon 分组优先（涵盖 gemini-4-argon 与 orchestrator-g1-pro）
  if (slug.includes('argon') || slug.includes('g1-pro')) {
    const argonGroup = groups.find(g => String(g.name ?? '').toLowerCase().includes('argon'))
    if (argonGroup) return argonGroup
  }

  // 2. 第三方模型分组优先（Claude / GPT）
  if (slug.includes('claude') || slug.includes('gpt') || slug.includes('sonnet') || slug.includes('opus')) {
    const thirdParty = groups.find(g => {
      const hay = `${g.name ?? ''} ${g.description ?? ''}`.toLowerCase()
      return hay.includes('claude') || hay.includes('gpt')
    })
    if (thirdParty) return thirdParty
  }

  // 3. 按词元重叠度打分匹配
  const modelTokens = new Set(tokenize(slug))
  let bestGroup = null
  let bestScore = 0
  for (const group of groups) {
    const hayTokens = new Set(tokenize(`${group.name ?? ''} ${group.description ?? ''}`))
    let score = 0
    for (const token of modelTokens) {
      if (hayTokens.has(token)) score += token.length > 2 ? 2 : 1
    }
    // 排除仅因 "gemini" 误命中独立 Argon 分组
    if (String(group.name ?? '').toLowerCase().includes('argon') && !slug.includes('argon')) {
      score -= 3
    }
    if (score > bestScore) {
      bestScore = score
      bestGroup = group
    }
  }

  return bestGroup ?? groups.find(g => g.fiveHour || g.weekly) ?? groups[0]
}

// ============================================================================
// 重置倒计时格式化
// ============================================================================

/**
 * 将 ISO 重置时间格式化为可读倒计时。
 * @param {string | null | undefined} resetAtIso
 * @param {{ nowMs?: number, zh?: boolean }} [options]
 * @returns {string}
 */
export function formatCountdown(resetAtIso, options = {}) {
  if (!resetAtIso) return ''
  const targetMs = Date.parse(resetAtIso)
  if (!Number.isFinite(targetMs)) return ''
  const nowMs = options.nowMs ?? Date.now()
  const zh = options.zh !== false
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000))
  if (diffSec < 60) return zh ? '即将重置' : 'resetting soon'

  const totalMin = Math.floor(diffSec / 60)
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins = totalMin % 60

  if (days > 0) {
    if (zh) return hours > 0 ? `${days}天${hours}小时后重置` : `${days}天后重置`
    return hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`
  }
  if (hours > 0) {
    if (zh) return mins > 0 ? `${hours}小时${mins}分后重置` : `${hours}小时后重置`
    return mins > 0 ? `resets in ${hours}h ${mins}m` : `resets in ${hours}h`
  }
  return zh ? `${mins}分钟后重置` : `resets in ${mins}m`
}

// ============================================================================
// macOS / Linux GUI 环境 PATH 补全
// ============================================================================

/**
 * 为从桌面图标启动的 Electron 进程补齐常见 CLI 路径，防止找不到 agy / codex。
 * @param {string | undefined} basePath
 * @returns {string}
 */
export function buildAugmentedPath(basePath = process.env.PATH ?? '') {
  const home = os.homedir()
  const extras = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.gemini', 'antigravity-cli', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  const current = String(basePath ?? '')
    .split(path.delimiter)
    .filter(Boolean)
  const seen = new Set(current)
  for (const dir of extras) {
    if (!seen.has(dir)) {
      seen.add(dir)
      current.push(dir)
    }
  }
  return current.join(path.delimiter)
}
