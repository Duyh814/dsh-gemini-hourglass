/**
 * [INPUT]: 依赖 node:test、node:assert/strict 与 src/providers/agy.js
 * [OUTPUT]: 验证 Antigravity CLI 配额 JSON/文本解析、Agent 识别与子进程调用契约
 * [POS]: test/ 的 agy 适配器单元测试
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAgyProvider, isAgyAgent, parseAgyUsageJson, parseAgyUsageText } from '../src/providers/agy.js'

const SAMPLE_AGY_JSON = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  response: 'Gemini Models\tWeekly Limit Remaining\t98%\t2026-11-30T07:44:29Z\n',
  duration_seconds: 0,
  num_turns: 0,
  usage: { total_tokens: 0 },
  command: {
    name: 'usage',
    data: {
      description: 'Within each group, models share a weekly limit and a 5-hour limit.',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.9799809455871582,
              reset_time: '2026-11-30T07:44:29Z',
            },
            {
              id: 'gemini-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              remaining_fraction: 0.944441556930542,
              reset_time: '2026-11-23T12:44:29Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
          buckets: [
            { id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-30T07:51:28Z' },
            { id: '3p-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0.85, reset_time: '2026-11-23T12:51:28Z' },
          ],
        },
        {
          name: 'Gemini 4 Argon',
          description: 'For paid Pro plans, Argon quota is separate.',
          buckets: [
            { id: 'gemini-argon-wtu-weekly', name: 'Gemini 4 Argon Weekly Limit', window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-30T07:51:28Z' },
          ],
        },
      ],
    },
  },
})

describe('agy provider', () => {
  it('解析官方 --output-format json 的五小时与每周配额分组', () => {
    const result = parseAgyUsageJson(`some startup notice\n${SAMPLE_AGY_JSON}\n`)
    assert.ok(result)
    assert.equal(result.groups.length, 3)

    const gemini = result.groups[0]
    assert.equal(gemini.name, 'Gemini Models')
    assert.equal(gemini.fiveHour.remainingPercent, 94.4)
    assert.equal(gemini.fiveHour.usedPercent, 5.6)
    assert.equal(gemini.fiveHour.resetAt, '2026-11-23T12:44:29.000Z')
    assert.equal(gemini.weekly.remainingPercent, 98)
    assert.equal(gemini.weekly.usedPercent, 2)

    const claude = result.groups[1]
    assert.equal(claude.fiveHour.remainingPercent, 85)
    assert.equal(claude.fiveHour.usedPercent, 15)

    const argon = result.groups[2]
    assert.equal(argon.fiveHour, null)
    assert.equal(argon.weekly.remainingPercent, 100)
  })

  it('兜底解析纯文本表格与 TSV 输出', () => {
    const text = [
      'Quota:',
      'Gemini Models          Weekly Limit Remaining       99%   2026-11-30T07:44:29Z',
      'Gemini Models          Five Hour Limit Remaining    96%   2026-11-23T12:44:29Z',
      'Claude and GPT models\tFive Hour Limit Remaining\t80%\t2026-11-23T12:51:28Z',
    ].join('\n')

    const result = parseAgyUsageText(text)
    assert.ok(result)
    assert.equal(result.groups.length, 2)
    assert.equal(result.groups[0].fiveHour.remainingPercent, 96)
    assert.equal(result.groups[0].weekly.remainingPercent, 99)
    assert.equal(result.groups[1].fiveHour.usedPercent, 20)
  })

  it('正确识别 Antigravity Agent 定义并传递 PATH 补全参数', async () => {
    assert.equal(isAgyAgent({ id: 'agy', command: 'agy' }), true)
    assert.equal(isAgyAgent({ id: 'custom', command: '/Users/me/.local/bin/agy' }), true)
    assert.equal(isAgyAgent({ id: 'codex', command: 'npx' }), false)

    let captured = null
    const provider = createAgyProvider({
      execFile: async (cmd, args, opts) => {
        captured = { cmd, args, opts }
        return { stdout: SAMPLE_AGY_JSON, stderr: '' }
      },
    })

    const quota = await provider.fetchQuota({ id: 'agy', title: 'Antigravity CLI', command: 'agy', env: {} })
    assert.equal(captured.cmd, 'agy')
    assert.deepEqual(captured.args, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '25s'])
    assert.ok(captured.opts.env.PATH.includes('/opt/homebrew/bin'))
    assert.equal(quota.provider, 'agy')
    assert.equal(quota.groups.length, 3)
  })
})
