/**
 * [INPUT]: 依赖 node:test、node:assert/strict、node:fs、node:path、node:vm 与根目录 client.js
 * [OUTPUT]: 在无头沙箱中加载 client.js，验证 ModuleLoader 协议、插槽注册与核心纯函数
 * [POS]: test/ 的 Browser 半身无头冒烟测试
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = path.resolve(__dirname, '..', 'client.js')

describe('client.js headless smoke test', () => {
  it('正确遵循 window.__ModuleLoader__.load 协议并注册三个 DSH 插槽', () => {
    const code = fs.readFileSync(CLIENT_PATH, 'utf8')
    let registeredBundle = null

    const stubReact = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: init => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      useRef: v => ({ current: v }),
      useMemo: fn => fn(),
    }

    const sandbox = {
      window: {
        __ModuleLoader__: {
          load(bundle) {
            registeredBundle = bundle
          },
        },
      },
      navigator: { language: 'zh-CN' },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
      JSON,
      String,
      Number,
      Boolean,
      Array,
      Object,
      Set,
      Map,
      Error,
    }

    vm.runInNewContext(code, sandbox, { filename: 'client.js' })
    assert.ok(registeredBundle)
    assert.equal(registeredBundle.id, 'dsh-ntr-quota')

    const exportsObj = registeredBundle.factory(mod => {
      if (mod === 'react') return stubReact
      throw new Error(`unexpected require: ${mod}`)
    })

    assert.equal(exportsObj.name, 'dsh-ntr-quota-client')
    assert.deepEqual(Array.from(exportsObj.inject), ['slots'])
    assert.equal(typeof exportsObj.apply, 'function')

    const injectedSlots = []
    const disposers = []
    const ctx = {
      effect(fn) {
        const d = fn()
        if (typeof d === 'function') disposers.push(d)
      },
      slots: {
        inject(slotName, factory) {
          injectedSlots.push(slotName)
          return factory()
        },
        register(spec, component) {
          assert.ok(spec.id)
          assert.equal(typeof component, 'function')
          return () => {}
        },
      },
    }

    exportsObj.apply(ctx)
    assert.deepEqual(injectedSlots, [
      'conversation.composer.dock',
      'shell.overlay',
      'settings.section',
    ])

    // 验证纯视图筛选逻辑
    const target = exportsObj.__test.selectDockTarget({
      defaultAgentId: 'agy',
      sessions: { 's-1': { agentId: 'agy', modelId: 'agy@claude-opus-5-5' } },
      agents: [
        {
          agentId: 'agy',
          groups: [
            { id: 'gemini-models', name: 'Gemini Models', description: 'Gemini 4 Neon', fiveHour: { remainingPercent: 94 }, weekly: { remainingPercent: 98 } },
            { id: 'claude-gpt', name: 'Claude and GPT models', description: 'Claude Opus 5.5', fiveHour: { remainingPercent: 80 }, weekly: { remainingPercent: 90 } },
          ],
        },
      ],
    }, 's-1')
    assert.equal(target.group.id, 'claude-gpt')

    for (const dispose of disposers) dispose()
  })
})
