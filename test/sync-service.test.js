/**
 * [INPUT]: 依赖 node:test、node:assert/strict、node:fs、node:os、node:path 与 src/sync-service.js、src/store.js
 * [OUTPUT]: 验证单飞并发合并、自动同步冷却防抖、错误时缓存保底与原子持久化
 * [POS]: test/ 的同步编排服务单元测试
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createQuotaStore } from '../src/store.js'
import { createSyncService } from '../src/sync-service.js'

describe('sync service', () => {
  it('并发 sync 合并为单飞请求，自动同步遵守冷却时间，失败时保留上次有效缓存', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ntr-quota-sync-'))
    try {
      let currentTime = 1_700_000_000_000
      let callCount = 0
      let shouldFail = false

      const store = createQuotaStore(tmpDir)
      const service = createSyncService({
        store,
        now: () => currentTime,
        readRegistry: () => ({
          exists: true,
          filePath: '/mock/agents.json',
          defaultAgentId: 'agy',
          agents: [{ id: 'agy', title: 'Antigravity CLI', command: 'agy', args: [], env: {}, exposedModels: [] }],
          sessions: { 'sess-1': { agentId: 'agy', modelId: 'agy@gemini-4-neon' } },
        }),
        providers: [
          {
            id: 'agy',
            matches: a => a.id === 'agy',
            fetchQuota: async () => {
              callCount += 1
              await new Promise(r => setTimeout(r, 15))
              if (shouldFail) throw new Error('network timeout')
              return {
                provider: 'agy',
                description: 'ok',
                groups: [
                  {
                    id: 'gemini-models',
                    name: 'Gemini Models',
                    description: 'Gemini 4 Neon',
                    fiveHour: { id: '5h', label: '5h', window: '5h', remainingPercent: 90, usedPercent: 10, resetAt: null, description: null },
                    weekly: { id: 'w', label: 'weekly', window: 'weekly', remainingPercent: 95, usedPercent: 5, resetAt: null, description: null },
                    extraBuckets: [],
                  },
                ],
              }
            },
          },
        ],
      })

      const events = []
      const unsub = service.subscribe(evt => events.push(evt.type))

      // 1. 并发发起两次 sync，应只触发一次底层调用
      const [s1, s2] = await Promise.all([
        service.sync({ force: true, reason: 'manual' }),
        service.sync({ force: true, reason: 'manual' }),
      ])
      assert.equal(callCount, 1)
      assert.equal(s1.agents[0].groups[0].fiveHour.remainingPercent, 90)
      assert.equal(s2.agents[0].groups[0].weekly.remainingPercent, 95)
      assert.ok(events.includes('syncing'))
      assert.ok(events.includes('state'))

      // 验证快照已原子落盘
      assert.equal(fs.existsSync(store.snapshotPath), true)

      // 2. 冷却期内（5s < 20s）非强制同步应直接命中缓存，不拉起 CLI
      currentTime += 5_000
      await service.sync({ force: false, reason: 'turn-end' })
      assert.equal(callCount, 1)

      // 3. 强制手动同步不受冷却限制；若失败则保留上次 groups 并标记 stale=true
      shouldFail = true
      const afterErr = await service.sync({ force: true, reason: 'manual' })
      assert.equal(callCount, 2)
      assert.equal(afterErr.agents[0].status, 'error')
      assert.equal(afterErr.agents[0].stale, true)
      assert.equal(afterErr.agents[0].groups[0].fiveHour.remainingPercent, 90)
      assert.match(afterErr.lastError, /network timeout/)

      unsub()
      service.dispose()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
