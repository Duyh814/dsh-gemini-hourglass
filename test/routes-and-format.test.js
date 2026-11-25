/**
 * [INPUT]: 依赖 node:test、node:assert/strict、node:fs、node:os、node:path 与 src/{format,ntr-registry,routes,store,sync-service}.js
 * [OUTPUT]: 验证模型分组匹配、倒计时格式化、NTR 注册表解析与全部 HTTP/SSE 路由行为
 * [POS]: test/ 的纯工具与路由契约单元测试
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { formatCountdown, matchQuotaGroup } from '../src/format.js'
import { readNtrRegistry } from '../src/ntr-registry.js'
import { createRouteDefinitions } from '../src/routes.js'
import { createQuotaStore } from '../src/store.js'
import { createSyncService } from '../src/sync-service.js'

const GROUPS = [
  {
    id: 'gemini-models',
    name: 'Gemini Models',
    description: 'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash',
    fiveHour: { remainingPercent: 94 },
    weekly: { remainingPercent: 98 },
  },
  {
    id: 'claude-and-gpt-models',
    name: 'Claude and GPT models',
    description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
    fiveHour: { remainingPercent: 100 },
    weekly: { remainingPercent: 100 },
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    description: 'For paid Pro plans, Argon quota is separate.',
    fiveHour: null,
    weekly: { remainingPercent: 100 },
  },
]

describe('format & registry & routes', () => {
  it('将不同 NTR 模型精准映射到对应的配额分组', () => {
    assert.equal(matchQuotaGroup(GROUPS, 'agy@gemini-4-neon').id, 'gemini-models')
    assert.equal(matchQuotaGroup(GROUPS, 'agy@gemini-4-hydrogen').id, 'gemini-models')
    assert.equal(matchQuotaGroup(GROUPS, 'agy@gemini-4-argon').id, 'gemini-4-argon')
    assert.equal(matchQuotaGroup(GROUPS, 'agy@gemini-pro-orchestrator-g1-pro').id, 'gemini-4-argon')
    assert.equal(matchQuotaGroup(GROUPS, 'agy@claude-opus-5-5').id, 'claude-and-gpt-models')
    assert.equal(matchQuotaGroup(GROUPS, 'agy@gpt-oss-120b-medium').id, 'claude-and-gpt-models')
  })

  it('按天/小时/分钟格式化重置倒计时', () => {
    const base = Date.parse('2026-11-23T08:00:00Z')
    assert.equal(formatCountdown('2026-11-23T12:45:00Z', { nowMs: base, zh: true }), '4小时45分后重置')
    assert.equal(formatCountdown('2026-11-30T07:00:00Z', { nowMs: base, zh: true }), '6天23小时后重置')
    assert.equal(formatCountdown('2026-11-23T08:00:30Z', { nowMs: base, zh: true }), '即将重置')
  })

  it('正确解析 dsh-ntr agents.json 中的 agents 与会话绑定', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ntr-quota-reg-'))
    try {
      const regFile = path.join(tmpDir, 'agents.json')
      fs.writeFileSync(regFile, JSON.stringify({
        version: 2,
        defaultAgentId: 'agy',
        agents: [{ id: 'agy', title: 'Antigravity CLI', command: 'agy', args: ['acp'] }],
        conversations: { 's-1': { agentId: 'agy', modelId: 'agy@gemini-4-neon' } },
        chatSessions: [{ dshSessionId: 's-2', agentId: 'agy', modelId: 'agy@claude-opus-5-5' }],
      }))
      const reg = readNtrRegistry(regFile)
      assert.equal(reg.exists, true)
      assert.equal(reg.defaultAgentId, 'agy')
      assert.equal(reg.agents.length, 1)
      assert.equal(reg.sessions['s-1'].modelId, 'agy@gemini-4-neon')
      assert.equal(reg.sessions['s-2'].modelId, 'agy@claude-opus-5-5')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('HTTP /state /sync /settings /stream 路由契约完整可用', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ntr-quota-http-'))
    try {
      const store = createQuotaStore(tmpDir)
      const service = createSyncService({
        store,
        readRegistry: () => ({
          exists: true,
          filePath: '/mock/agents.json',
          defaultAgentId: 'agy',
          agents: [],
          sessions: {},
        }),
        providers: [],
      })
      const routes = new Map(createRouteDefinitions(service).map(r => [r.path, r]))

      const stateRes = await routes.get('/api/ntr-quota/state').fetch(new Request('http://localhost/api/ntr-quota/state'))
      assert.equal(stateRes.status, 200)
      const stateBody = await stateRes.json()
      assert.equal(stateBody.settings.pollIntervalMs, 300_000)

      const settingsRes = await routes.get('/api/ntr-quota/settings').fetch(new Request('http://localhost/api/ntr-quota/settings', {
        method: 'POST',
        body: JSON.stringify({ displayMode: 'used', pollIntervalMs: 60_000 }),
      }))
      const updated = await settingsRes.json()
      assert.equal(updated.settings.displayMode, 'used')
      assert.equal(updated.settings.pollIntervalMs, 60_000)

      const controller = new AbortController()
      const sseRes = await routes.get('/api/ntr-quota/stream').fetch(new Request('http://localhost/api/ntr-quota/stream', {
        signal: controller.signal,
      }))
      assert.equal(sseRes.headers.get('content-type'), 'text/event-stream; charset=utf-8')
      const reader = sseRes.body.getReader()
      const firstChunk = await reader.read()
      const decoded = new TextDecoder().decode(firstChunk.value)
      assert.match(decoded, /^data: \{"type":"state"/)
      controller.abort()
      await reader.cancel()
      service.dispose()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
