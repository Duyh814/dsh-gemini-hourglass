/**
 * [INPUT]: 依赖 node:test、node:assert/strict、node:fs、node:os、node:path 与 src/providers/codex.js
 * [OUTPUT]: 验证 Codex rate_limits 窗口分类与本地会话 JSONL 扫描
 * [POS]: test/ 的 codex 适配器单元测试
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { createCodexProvider, isCodexAgent, parseCodexRateLimits } from '../src/providers/codex.js'

describe('codex provider', () => {
  it('准确区分五小时（300m）、每周（10080m）与月度（43200m）窗口', () => {
    const dual = parseCodexRateLimits({
      limit_name: 'Codex Plus',
      primary: { used_percent: 25, window_minutes: 300, resets_at: 1795400000 },
      secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1795900000 },
    })
    assert.equal(dual.groups[0].name, 'Codex Plus')
    assert.equal(dual.groups[0].fiveHour.remainingPercent, 75)
    assert.equal(dual.groups[0].fiveHour.usedPercent, 25)
    assert.equal(dual.groups[0].weekly.remainingPercent, 60)
    assert.equal(dual.groups[0].weekly.usedPercent, 40)

    const monthly = parseCodexRateLimits({
      primary: { used_percent: 47, window_minutes: 43200, resets_at: 1797409550 },
      secondary: null,
    })
    assert.equal(monthly.groups[0].fiveHour, null)
    assert.equal(monthly.groups[0].weekly, null)
    assert.equal(monthly.groups[0].extraBuckets.length, 1)
    assert.equal(monthly.groups[0].extraBuckets[0].remainingPercent, 53)
  })

  it('从临时会话目录读取最新 JSONL 的最后一条 rate_limits', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ntr-quota-codex-'))
    try {
      const subDir = path.join(tmpDir, '2026', '11')
      fs.mkdirSync(subDir, { recursive: true })
      const logPath = path.join(subDir, 'rollout.jsonl')
      fs.writeFileSync(
        logPath,
        [
          JSON.stringify({ timestamp: '2026-11-23T06:00:00Z', payload: { rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1795400000 } } } }),
          JSON.stringify({ timestamp: '2026-11-23T07:00:00Z', payload: { rate_limits: { primary: { used_percent: 32, window_minutes: 300, resets_at: 1795400000 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1795900000 } } } }),
        ].join('\n'),
        'utf8',
      )

      const provider = createCodexProvider({ sessionsDir: tmpDir })
      assert.equal(isCodexAgent({ id: 'codex', command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'] }), true)
      const result = await provider.fetchQuota({ id: 'codex', title: 'Codex', command: 'codex' })
      assert.equal(result.groups[0].fiveHour.remainingPercent, 68)
      assert.equal(result.groups[0].weekly.remainingPercent, 88)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
