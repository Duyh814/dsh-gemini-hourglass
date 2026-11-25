/**
 * [INPUT]: 依赖 node:fs、node:os、node:path 进行原子 JSON 文件读写
 * [OUTPUT]: 导出 DEFAULT_SETTINGS、sanitizeSettings、createQuotaStore
 * [POS]: src/ 持久化层，管理 ~/.dsh/dsh-ntr-quota/settings.json 与 snapshot.json
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ============================================================================
// 默认设置与校验边界
// ============================================================================

export const DEFAULT_SETTINGS = Object.freeze({
  /** 自动同步间隔（毫秒）；0 表示仅手动同步。默认 5 分钟。 */
  pollIntervalMs: 5 * 60 * 1000,
  /** NTR 对话轮次结束后是否自动触发一次同步。 */
  syncOnTurnEnd: true,
  /** 百分比展示模式：'remaining'（剩余）或 'used'（已用）。 */
  displayMode: 'remaining',
  /** 输入框底栏胶囊可见性：'ntr-only' | 'always' | 'hidden'。 */
  dockVisibility: 'ntr-only',
  /** 自动同步最小冷却时间（毫秒），避免高频对话反复拉起子进程。 */
  minAutoSyncGapMs: 20 * 1000,
})

const ALLOWED_POLL_MS = new Set([0, 60_000, 180_000, 300_000, 900_000])
const ALLOWED_DISPLAY_MODE = new Set(['remaining', 'used'])
const ALLOWED_DOCK_VISIBILITY = new Set(['ntr-only', 'always', 'hidden'])

/**
 * 校验并合并部分设置更新。
 * @param {unknown} raw
 * @param {typeof DEFAULT_SETTINGS} [base]
 */
export function sanitizeSettings(raw, base = DEFAULT_SETTINGS) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pollCandidate = Number(src.pollIntervalMs)
  const pollIntervalMs = ALLOWED_POLL_MS.has(pollCandidate)
    ? pollCandidate
    : base.pollIntervalMs

  const syncOnTurnEnd = typeof src.syncOnTurnEnd === 'boolean'
    ? src.syncOnTurnEnd
    : base.syncOnTurnEnd

  const displayMode = ALLOWED_DISPLAY_MODE.has(src.displayMode)
    ? src.displayMode
    : base.displayMode

  const dockVisibility = ALLOWED_DOCK_VISIBILITY.has(src.dockVisibility)
    ? src.dockVisibility
    : base.dockVisibility

  const gapCandidate = Number(src.minAutoSyncGapMs)
  const minAutoSyncGapMs = Number.isFinite(gapCandidate) && gapCandidate >= 5_000 && gapCandidate <= 300_000
    ? Math.round(gapCandidate)
    : base.minAutoSyncGapMs

  return {
    pollIntervalMs,
    syncOnTurnEnd,
    displayMode,
    dockVisibility,
    minAutoSyncGapMs,
  }
}

export function defaultStateDir() {
  return path.join(os.homedir(), '.dsh', 'dsh-ntr-quota')
}

// ============================================================================
// 原子文件读写辅助
// ============================================================================

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = `${JSON.stringify(data, null, 2)}\n`
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
}

/**
 * 创建持久化存储实例，统一管理 settings.json 与 snapshot.json。
 * @param {string} [stateDir]
 */
export function createQuotaStore(stateDir = defaultStateDir()) {
  const settingsPath = path.join(stateDir, 'settings.json')
  const snapshotPath = path.join(stateDir, 'snapshot.json')

  let cachedSettings = sanitizeSettings(readJsonSafe(settingsPath), DEFAULT_SETTINGS)
  let cachedSnapshot = readJsonSafe(snapshotPath)

  return {
    stateDir,
    settingsPath,
    snapshotPath,

    getSettings() {
      return { ...cachedSettings }
    },

    updateSettings(patch) {
      cachedSettings = sanitizeSettings(patch, cachedSettings)
      try {
        writeJsonAtomic(settingsPath, cachedSettings)
      } catch {
        // 磁盘只读时保留内存状态，不崩溃
      }
      return { ...cachedSettings }
    },

    getSnapshot() {
      return cachedSnapshot
    },

    saveSnapshot(snapshot) {
      cachedSnapshot = snapshot
      try {
        writeJsonAtomic(snapshotPath, snapshot)
      } catch {
        // 磁盘写入失败时仍保留内存快照供 UI 展示
      }
      return cachedSnapshot
    },
  }
}
