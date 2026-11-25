/**
 * [INPUT]: 依赖 src/ntr-registry.js、src/store.js、src/providers/index.js
 * [OUTPUT]: 导出 createSyncService，提供单飞同步调度、定时轮询、冷却防抖、快照持久化与事件订阅
 * [POS]: src/ 的核心编排服务，连接 NTR 配置、配额采集器、持久化存储与 HTTP/SSE 接口
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { readNtrRegistry } from './ntr-registry.js'
import { createDefaultProviders, resolveProvider } from './providers/index.js'
import { createQuotaStore } from './store.js'

// ============================================================================
// 同步编排服务
// ============================================================================

/**
 * @param {{
 *   store?: ReturnType<typeof createQuotaStore>,
 *   readRegistry?: typeof readNtrRegistry,
 *   providers?: ReturnType<typeof createDefaultProviders>,
 *   now?: () => number,
 *   logger?: { info?: Function, warn?: Function, error?: Function }
 * }} [deps]
 */
export function createSyncService(deps = {}) {
  const store = deps.store ?? createQuotaStore()
  const readRegistry = deps.readRegistry ?? readNtrRegistry
  const providers = deps.providers ?? createDefaultProviders()
  const now = deps.now ?? (() => Date.now())
  const logger = deps.logger ?? {}

  /** @type {Set<(payload: object) => void>} */
  const listeners = new Set()
  /** @type {Promise<object> | null} */
  let inflight = null
  let lastSyncFinishedAt = 0
  let lastError = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null
  let disposed = false

  function buildState() {
    const registry = readRegistry()
    const cached = store.getSnapshot()
    const settings = store.getSettings()
    return {
      version: 1,
      syncing: inflight !== null,
      syncedAt: cached?.syncedAt ?? null,
      durationMs: cached?.durationMs ?? null,
      lastError,
      snapshotPath: store.snapshotPath,
      registryPath: registry.filePath,
      registryExists: registry.exists,
      defaultAgentId: registry.defaultAgentId,
      configuredAgents: registry.agents.map(a => ({ id: a.id, title: a.title, command: a.command })),
      sessions: registry.sessions,
      agents: Array.isArray(cached?.agents) ? cached.agents : [],
      settings,
    }
  }

  function broadcast(type = 'state') {
    const payload = { type, state: buildState() }
    for (const listener of listeners) {
      try {
        listener(payload)
      } catch {
        // 单个订阅者异常不得影响其余推送通道
      }
    }
  }

  function previousAgentOf(agentId) {
    const prev = store.getSnapshot()?.agents
    if (!Array.isArray(prev)) return null
    return prev.find(item => item.agentId === agentId) ?? null
  }

  async function runSyncOnce(reason) {
    const startedAt = now()
    const registry = readRegistry()
    const results = []

    await Promise.all(
      registry.agents.map(async agentDef => {
        const provider = resolveProvider(providers, agentDef)
        const prev = previousAgentOf(agentDef.id)
        if (!provider) {
          results.push({
            agentId: agentDef.id,
            title: agentDef.title,
            provider: null,
            status: 'unsupported',
            stale: false,
            syncedAt: new Date(now()).toISOString(),
            error: null,
            description: null,
            groups: [],
          })
          return
        }

        try {
          const fetched = await provider.fetchQuota(agentDef)
          results.push({
            agentId: agentDef.id,
            title: agentDef.title,
            provider: fetched.provider,
            status: 'ok',
            stale: false,
            syncedAt: new Date(now()).toISOString(),
            error: null,
            description: fetched.description ?? null,
            groups: fetched.groups,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn?.(`dsh-ntr-quota: sync failed for agent "${agentDef.id}": ${message}`)
          results.push({
            agentId: agentDef.id,
            title: agentDef.title,
            provider: provider.id,
            status: 'error',
            stale: Boolean(prev?.groups?.length),
            syncedAt: prev?.syncedAt ?? new Date(now()).toISOString(),
            error: message,
            description: prev?.description ?? null,
            groups: Array.isArray(prev?.groups) ? prev.groups : [],
          })
        }
      }),
    )

    // 按 NTR 注册表顺序排序，保证 UI 卡片位置稳定
    const order = new Map(registry.agents.map((a, idx) => [a.id, idx]))
    results.sort((a, b) => (order.get(a.agentId) ?? 999) - (order.get(b.agentId) ?? 999))

    const finishedAt = now()
    const snapshot = {
      version: 1,
      reason,
      syncedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - startedAt),
      defaultAgentId: registry.defaultAgentId,
      agents: results,
    }

    const firstErr = results.find(r => r.status === 'error')
    lastError = firstErr ? `${firstErr.agentId}: ${firstErr.error}` : null
    lastSyncFinishedAt = finishedAt
    store.saveSnapshot(snapshot)
    return buildState()
  }

  /**
   * 触发一次同步。并发调用共享同一个单飞 Promise；非强制自动同步受冷却时间保护。
   * @param {{ force?: boolean, reason?: string }} [options]
   */
  async function sync(options = {}) {
    if (disposed) return buildState()
    const force = options.force === true
    const reason = options.reason ?? (force ? 'manual' : 'auto')

    if (inflight) return inflight

    if (!force) {
      const gap = store.getSettings().minAutoSyncGapMs
      if (lastSyncFinishedAt > 0 && now() - lastSyncFinishedAt < gap) {
        return buildState()
      }
    }

    const task = (async () => {
      try {
        return await runSyncOnce(reason)
      } finally {
        inflight = null
        broadcast('state')
      }
    })()

    inflight = task
    broadcast('syncing')
    return task
  }

  function reschedule() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (disposed) return
    const intervalMs = store.getSettings().pollIntervalMs
    if (intervalMs > 0) {
      timer = setInterval(() => {
        void sync({ force: false, reason: 'poll' })
      }, intervalMs)
      timer.unref?.()
    }
  }

  function updateSettings(patch) {
    store.updateSettings(patch)
    reschedule()
    broadcast('settings')
    return buildState()
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function start() {
    if (disposed) return
    reschedule()
    // 启动后立即异步刷新一次，不阻塞 Cordis 插件激活
    queueMicrotask(() => {
      if (!disposed) void sync({ force: true, reason: 'boot' })
    })
  }

  function dispose() {
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    listeners.clear()
  }

  return {
    getState: buildState,
    sync,
    updateSettings,
    subscribe,
    start,
    dispose,
  }
}
