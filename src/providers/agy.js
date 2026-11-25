/**
 * [INPUT]: 依赖 node:child_process 与 src/format.js 的数值/时间/PATH 工具
 * [OUTPUT]: 导出 createAgyProvider、parseAgyUsageJson、parseAgyUsageText
 * [POS]: src/providers/ 的 Antigravity CLI 配额采集适配器，通过官方 `agy -p "/usage" --output-format json` 零 Token 获取五小时与每周用量
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { execFile as nodeExecFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildAugmentedPath,
  clampPercent,
  fractionToPercent,
  normalizeIsoTime,
  remainingToUsed,
} from '../format.js'

const execFileAsync = promisify(nodeExecFile)

const DEFAULT_TIMEOUT_MS = 30_000
const PRINT_TIMEOUT_ARG = '25s'

// ============================================================================
// 数据归一化：JSON 与纯文本双路径解析
// ============================================================================

function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'group'
}

/**
 * 判断单个 bucket 属于 5h、weekly 还是其他窗口。
 * @param {{ id?: string, name?: string, window?: string }} bucket
 * @returns {'5h' | 'weekly' | 'other'}
 */
function classifyWindow(bucket) {
  const win = String(bucket.window ?? '').toLowerCase()
  if (win === '5h' || win === 'five_hour' || win === 'five-hour') return '5h'
  if (win === 'weekly' || win === '7d' || win === 'week') return 'weekly'

  const label = `${bucket.id ?? ''} ${bucket.name ?? ''}`.toLowerCase()
  if (label.includes('5h') || label.includes('five hour') || label.includes('5-hour')) return '5h'
  if (label.includes('weekly') || label.includes('7d') || label.includes('week')) return 'weekly'
  return 'other'
}

function normalizeBucket(raw) {
  if (!raw || typeof raw !== 'object') return null
  let remainingPercent = fractionToPercent(raw.remaining_fraction)
  if (remainingPercent === null && raw.remaining_percent !== undefined) {
    remainingPercent = clampPercent(raw.remaining_percent)
  }
  if (remainingPercent === null) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : slugify(raw.name),
    label: typeof raw.name === 'string' && raw.name ? raw.name : 'Limit',
    window: classifyWindow(raw),
    remainingPercent,
    usedPercent: remainingToUsed(remainingPercent),
    resetAt: normalizeIsoTime(raw.reset_time ?? raw.resetAt),
    description: typeof raw.description === 'string' ? raw.description : null,
  }
}

/**
 * 解析 `agy -p "/usage" --output-format json` 的标准输出。
 * 容忍前后附加日志行，自动定位 JSON 对象。
 *
 * @param {string} stdout
 * @returns {{ description: string | null, groups: Array<object> } | null}
 */
export function parseAgyUsageJson(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return null

  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
  }
  if (!parsed || typeof parsed !== 'object') return null

  const data = parsed.command?.data
  if (data && Array.isArray(data.groups)) {
    const groups = data.groups.map(rawGroup => {
      const buckets = Array.isArray(rawGroup.buckets)
        ? rawGroup.buckets.map(normalizeBucket).filter(Boolean)
        : []
      let fiveHour = null
      let weekly = null
      const extraBuckets = []
      for (const b of buckets) {
        if (b.window === '5h' && !fiveHour) fiveHour = b
        else if (b.window === 'weekly' && !weekly) weekly = b
        else extraBuckets.push(b)
      }
      return {
        id: slugify(rawGroup.name),
        name: String(rawGroup.name ?? 'Unknown'),
        description: typeof rawGroup.description === 'string' ? rawGroup.description : null,
        fiveHour,
        weekly,
        extraBuckets,
      }
    })
    return {
      description: typeof data.description === 'string' ? data.description : null,
      groups,
    }
  }

  // 若 JSON 中仅带 response TSV 文本，交由文本解析器兜底
  if (typeof parsed.response === 'string' && parsed.response.trim()) {
    return parseAgyUsageText(parsed.response)
  }
  return null
}

/**
 * 兜底解析 `agy -p "/usage"` 的纯文本或 TSV 行输出。
 * 支持格式：
 *   Gemini Models\tWeekly Limit Remaining\t98%\t2026-11-30T07:44:29Z
 *   Gemini Models          Five Hour Limit Remaining    96%   2026-11-23 20:44 CST
 *
 * @param {string} text
 * @returns {{ description: string | null, groups: Array<object> } | null}
 */
export function parseAgyUsageText(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^quota:?$/i.test(l))

  /** @type {Map<string, { id: string, name: string, description: null, fiveHour: object | null, weekly: object | null, extraBuckets: object[] }>} */
  const byGroup = new Map()

  for (const line of lines) {
    let parts = line.includes('\t')
      ? line.split('\t').map(s => s.trim()).filter(Boolean)
      : line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean)

    if (parts.length < 3) continue
    const [groupName, bucketName, pctRaw, resetRaw] = parts
    const pctMatch = String(pctRaw).match(/(\d+(?:\.\d+)?)\s*%/)
    if (!pctMatch) continue

    const remainingPercent = clampPercent(Number(pctMatch[1]))
    if (remainingPercent === null) continue

    const win = classifyWindow({ name: bucketName })
    const bucket = {
      id: `${slugify(groupName)}-${win}`,
      label: bucketName,
      window: win,
      remainingPercent,
      usedPercent: remainingToUsed(remainingPercent),
      resetAt: normalizeIsoTime(resetRaw),
      description: null,
    }

    let group = byGroup.get(groupName)
    if (!group) {
      group = {
        id: slugify(groupName),
        name: groupName,
        description: null,
        fiveHour: null,
        weekly: null,
        extraBuckets: [],
      }
      byGroup.set(groupName, group)
    }

    if (win === '5h' && !group.fiveHour) group.fiveHour = bucket
    else if (win === 'weekly' && !group.weekly) group.weekly = bucket
    else group.extraBuckets.push(bucket)
  }

  if (byGroup.size === 0) return null
  return {
    description: null,
    groups: Array.from(byGroup.values()),
  }
}

// ============================================================================
// Provider 工厂（支持测试注入 execFile）
// ============================================================================

/**
 * 判断某个 NTR Agent 是否属于 Antigravity CLI。
 * @param {{ id?: string, command?: string }} agentDef
 */
export function isAgyAgent(agentDef) {
  const id = String(agentDef?.id ?? '').toLowerCase()
  const base = path.basename(String(agentDef?.command ?? '')).toLowerCase()
  return id === 'agy' || id.startsWith('agy-') || id.includes('antigravity') || base === 'agy' || base === 'agy.exe'
}

/**
 * 创建 Antigravity CLI 配额采集适配器。
 * @param {{ execFile?: typeof execFileAsync, timeoutMs?: number }} [deps]
 */
export function createAgyProvider(deps = {}) {
  const runExecFile = deps.execFile ?? execFileAsync
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    id: 'agy',
    matches: isAgyAgent,

    /**
     * 执行 `agy -p "/usage" --output-format json` 并返回归一化配额结果。
     * @param {{ id: string, title: string, command: string, env?: Record<string, string> }} agentDef
     */
    async fetchQuota(agentDef) {
      const command = agentDef.command || 'agy'
      const env = {
        ...process.env,
        ...(agentDef.env ?? {}),
        PATH: buildAugmentedPath(agentDef.env?.PATH ?? process.env.PATH),
      }
      const args = ['-p', '/usage', '--output-format', 'json', '--print-timeout', PRINT_TIMEOUT_ARG]

      const { stdout, stderr } = await runExecFile(command, args, {
        env,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      })

      const parsed = parseAgyUsageJson(stdout) ?? parseAgyUsageText(stdout)
      if (!parsed || parsed.groups.length === 0) {
        const detail = String(stderr || stdout || '').trim().slice(0, 240)
        throw new Error(detail ? `agy /usage 输出无法解析: ${detail}` : 'agy /usage 未返回有效配额数据')
      }

      return {
        provider: 'agy',
        description: parsed.description,
        groups: parsed.groups,
      }
    },
  }
}
