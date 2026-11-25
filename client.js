/**
 * [INPUT]: 依赖 DSH Shell ModuleLoader 提供的 react、ctx.slots 与同源接口 /api/ntr-quota/*
 * [OUTPUT]: 注册输入框底栏用量胶囊（conversation.composer.dock）、详情浮层（shell.overlay）与设置页看板（settings.section）
 * [POS]: dsh-ntr-quota Browser 端唯一入口，零外部构建依赖并完全复用宿主主题变量
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
window.__ModuleLoader__.load({
  id: 'dsh-ntr-quota',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useRef, useMemo } = React

    const STYLE_ID = 'dsh-ntr-quota-style'
    const PREFERS_ZH = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language)

    // ========================================================================
    // 文案与纯格式化工具（与 Host 端 src/format.js 语义同构）
    // ========================================================================

    function label(zh, en) {
      return PREFERS_ZH ? zh : en
    }

    function tokenize(text) {
      return String(text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    }

    function parseRouteModelId(modelId) {
      const raw = String(modelId ?? '').trim()
      if (!raw) return { agentId: null, modelSlug: '' }
      const at = raw.indexOf('@')
      if (at > 0) return { agentId: raw.slice(0, at), modelSlug: raw.slice(at + 1) }
      return { agentId: null, modelSlug: raw }
    }

    function matchQuotaGroup(groups, modelId) {
      if (!Array.isArray(groups) || groups.length === 0) return null
      const { modelSlug } = parseRouteModelId(modelId)
      const slug = modelSlug.toLowerCase()
      if (!slug) return groups.find(g => g.fiveHour || g.weekly) ?? groups[0]

      if (slug.includes('argon') || slug.includes('g1-pro')) {
        const argon = groups.find(g => String(g.name ?? '').toLowerCase().includes('argon'))
        if (argon) return argon
      }
      if (slug.includes('claude') || slug.includes('gpt') || slug.includes('sonnet') || slug.includes('opus')) {
        const tp = groups.find(g => {
          const hay = `${g.name ?? ''} ${g.description ?? ''}`.toLowerCase()
          return hay.includes('claude') || hay.includes('gpt')
        })
        if (tp) return tp
      }

      const modelTokens = new Set(tokenize(slug))
      let best = null
      let bestScore = 0
      for (const group of groups) {
        const hayTokens = new Set(tokenize(`${group.name ?? ''} ${group.description ?? ''}`))
        let score = 0
        for (const t of modelTokens) {
          if (hayTokens.has(t)) score += t.length > 2 ? 2 : 1
        }
        if (String(group.name ?? '').toLowerCase().includes('argon') && !slug.includes('argon')) {
          score -= 3
        }
        if (score > bestScore) {
          bestScore = score
          best = group
        }
      }
      return best ?? groups.find(g => g.fiveHour || g.weekly) ?? groups[0]
    }

    function formatCountdown(resetAtIso, nowMs = Date.now()) {
      if (!resetAtIso) return ''
      const targetMs = Date.parse(resetAtIso)
      if (!Number.isFinite(targetMs)) return ''
      const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000))
      if (diffSec < 60) return label('即将重置', 'resetting soon')

      const totalMin = Math.floor(diffSec / 60)
      const days = Math.floor(totalMin / (60 * 24))
      const hours = Math.floor((totalMin % (60 * 24)) / 60)
      const mins = totalMin % 60
      if (days > 0) {
        return PREFERS_ZH
          ? (hours > 0 ? `${days}天${hours}小时后重置` : `${days}天后重置`)
          : (hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`)
      }
      if (hours > 0) {
        return PREFERS_ZH
          ? (mins > 0 ? `${hours}小时${mins}分后重置` : `${hours}小时后重置`)
          : (mins > 0 ? `resets in ${hours}h ${mins}m` : `resets in ${hours}h`)
      }
      return PREFERS_ZH ? `${mins}分钟后重置` : `resets in ${mins}m`
    }

    function formatLocalTime(iso) {
      if (!iso) return '—'
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return '—'
      const pad = n => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function formatPercent(value) {
      if (!Number.isFinite(value)) return '—'
      const rounded = Math.round(value)
      return `${rounded}%`
    }

    function bucketValue(bucket, displayMode) {
      if (!bucket) return null
      return displayMode === 'used' ? bucket.usedPercent : bucket.remainingPercent
    }

    function toneForRemaining(remainingPercent) {
      if (!Number.isFinite(remainingPercent)) return 'neutral'
      if (remainingPercent <= 10) return 'danger'
      if (remainingPercent <= 30) return 'warn'
      return 'ok'
    }

    function worstTone(group) {
      const vals = [group?.fiveHour?.remainingPercent, group?.weekly?.remainingPercent].filter(Number.isFinite)
      if (vals.length === 0) return 'neutral'
      return toneForRemaining(Math.min(...vals))
    }

    // ========================================================================
    // 主题样式注入（完全复用 DSH CSS 变量）
    // ========================================================================

    function ensureStyle() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = [
        '.ntrq-pill { display:inline-flex; align-items:center; gap:6px; padding:1px 9px; border-radius:999px; border:1px solid transparent; background:transparent; cursor:pointer; color:var(--dsw-alias-label-tertiary,#8c95a4); font-family:inherit; font-size:var(--dsh-content-font-size-secondary,12px); font-variant-numeric:tabular-nums; line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px)); white-space:nowrap; flex:none; transition:background 140ms ease,color 140ms ease,border-color 140ms ease; }',
        '.ntrq-pill:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1)); border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.22)); color:var(--dsw-alias-label-primary,#1f2937); }',
        '.ntrq-dot { width:7px; height:7px; border-radius:50%; flex:none; }',
        '.ntrq-dot.is-ok { background:var(--dsw-alias-state-success-primary,#16a34a); }',
        '.ntrq-dot.is-warn { background:var(--dsw-alias-state-warn-primary,#d97706); }',
        '.ntrq-dot.is-danger { background:var(--dsw-alias-state-error-primary,#dc2626); }',
        '.ntrq-dot.is-neutral { background:var(--dsw-alias-label-tertiary,#9ca3af); }',
        '.ntrq-pill.is-syncing .ntrq-dot { animation:ntrq-pulse 1.1s ease-in-out infinite; }',
        '@keyframes ntrq-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.8)} }',
        '.ntrq-backdrop { position:fixed; inset:0; z-index:9990; background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.36)); display:flex; align-items:center; justify-content:center; padding:20px; }',
        '.ntrq-modal { width:min(560px,94vw); max-height:82vh; overflow-y:auto; background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#111827); border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24)); border-radius:14px; padding:18px 20px; box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.22)); }',
        '.ntrq-page { display:flex; flex-direction:column; gap:16px; max-width:780px; color:var(--dsw-alias-label-primary,inherit); }',
        '.ntrq-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }',
        '.ntrq-title { margin:0; font-size:16px; font-weight:600; color:var(--dsw-alias-label-primary,inherit); }',
        '.ntrq-sub { margin:4px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary,#6b7280); line-height:1.5; }',
        '.ntrq-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
        '.ntrq-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:500; border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26)); background:var(--dsw-alias-bg-layer-2,transparent); color:var(--dsw-alias-label-primary,inherit); cursor:pointer; }',
        '.ntrq-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }',
        '.ntrq-btn.is-primary { background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#2563eb)); color:var(--dsw-alias-label-primary-foreground,#fff); border-color:transparent; }',
        '.ntrq-btn:disabled { opacity:.55; cursor:not-allowed; }',
        '.ntrq-card { border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.22)); background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04)); border-radius:12px; padding:14px 16px; display:flex; flex-direction:column; gap:12px; }',
        '.ntrq-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }',
        '.ntrq-agent-name { font-size:14px; font-weight:600; }',
        '.ntrq-badge { font-size:11px; padding:2px 8px; border-radius:999px; background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); color:var(--dsw-alias-label-secondary,#6b7280); }',
        '.ntrq-badge.is-ok { background:var(--dsw-alias-state-success-tertiary,rgba(22,163,74,.14)); color:var(--dsw-alias-state-success-primary,#16a34a); }',
        '.ntrq-badge.is-err { background:var(--dsw-alias-state-error-tertiary,rgba(220,38,38,.14)); color:var(--dsw-alias-state-error-primary,#dc2626); }',
        '.ntrq-group { padding-top:10px; border-top:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.16)); display:flex; flex-direction:column; gap:8px; }',
        '.ntrq-group:first-of-type { padding-top:0; border-top:none; }',
        '.ntrq-group-name { font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; }',
        '.ntrq-group-desc { font-size:11px; color:var(--dsw-alias-label-tertiary,#8c95a4); }',
        '.ntrq-meter-row { display:flex; flex-direction:column; gap:4px; }',
        '.ntrq-meter-meta { display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:12px; font-variant-numeric:tabular-nums; }',
        '.ntrq-meter-label { color:var(--dsw-alias-label-secondary,#6b7280); }',
        '.ntrq-meter-val { font-weight:600; color:var(--dsw-alias-label-primary,inherit); }',
        '.ntrq-meter-reset { font-size:11px; color:var(--dsw-alias-label-tertiary,#8c95a4); margin-left:6px; font-weight:400; }',
        '.ntrq-track { height:6px; border-radius:999px; overflow:hidden; background:var(--dsw-alias-border-l3,rgba(127,127,127,.2)); }',
        '.ntrq-fill { height:100%; border-radius:999px; transition:width 240ms ease; }',
        '.ntrq-fill.is-ok { background:var(--dsw-alias-state-success-primary,#16a34a); }',
        '.ntrq-fill.is-warn { background:var(--dsw-alias-state-warn-primary,#d97706); }',
        '.ntrq-fill.is-danger { background:var(--dsw-alias-state-error-primary,#dc2626); }',
        '.ntrq-err { font-size:12px; padding:8px 10px; border-radius:8px; background:var(--dsw-alias-state-error-tertiary,rgba(220,38,38,.1)); color:var(--dsw-alias-state-error-primary,#dc2626); }',
        '.ntrq-setting-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-top:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.14)); font-size:13px; }',
        '.ntrq-setting-row:first-of-type { border-top:none; padding-top:0; }',
        '.ntrq-select { padding:5px 10px; border-radius:8px; font-size:12px; border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26)); background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,inherit); }',
        '.ntrq-mono { font-family:var(--ds-font-family-code,ui-monospace,monospace); font-size:11px; color:var(--dsw-alias-label-tertiary,#8c95a4); word-break:break-all; }',
      ].join('\n')
      document.head.appendChild(el)
    }

    // ========================================================================
    // 客户端状态仓库（同源 Fetch + SSE 实时推送）
    // ========================================================================

    function createClientStore() {
      let state = {
        syncing: false,
        syncedAt: null,
        durationMs: null,
        lastError: null,
        snapshotPath: '',
        defaultAgentId: null,
        configuredAgents: [],
        sessions: {},
        agents: [],
        settings: {
          pollIntervalMs: 300_000,
          syncOnTurnEnd: true,
          displayMode: 'remaining',
          dockVisibility: 'ntr-only',
        },
        popoverOpen: false,
        activeSessionId: '',
        clientError: null,
      }

      const listeners = new Set()
      let source = null
      let reconnectTimer = null
      let disposed = false

      function emit() {
        for (const fn of listeners) {
          try { fn(state) } catch {}
        }
      }

      function mergeServerState(next) {
        if (!next || typeof next !== 'object') return
        state = {
          ...state,
          ...next,
          clientError: null,
        }
        emit()
      }

      async function loadState() {
        try {
          const res = await fetch('/api/ntr-quota/state', { credentials: 'same-origin' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          mergeServerState(await res.json())
        } catch (err) {
          state = { ...state, clientError: err instanceof Error ? err.message : String(err) }
          emit()
        }
      }

      async function syncNow(options = {}) {
        const force = options.force !== false
        const reason = options.reason ?? (force ? 'manual' : 'turn-end')
        state = { ...state, syncing: true, clientError: null }
        emit()
        try {
          const res = await fetch('/api/ntr-quota/sync', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ force, reason }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          mergeServerState(await res.json())
        } catch (err) {
          state = {
            ...state,
            syncing: false,
            clientError: err instanceof Error ? err.message : String(err),
          }
          emit()
        }
      }

      async function updateSettings(patch) {
        try {
          const res = await fetch('/api/ntr-quota/settings', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          mergeServerState(await res.json())
        } catch (err) {
          state = { ...state, clientError: err instanceof Error ? err.message : String(err) }
          emit()
        }
      }

      function connectStream() {
        if (disposed || typeof EventSource === 'undefined') return
        try {
          source = new EventSource('/api/ntr-quota/stream')
          source.onmessage = evt => {
            try {
              const frame = JSON.parse(evt.data)
              if (frame?.state) mergeServerState(frame.state)
            } catch {}
          }
          source.onerror = () => {
            try { source?.close() } catch {}
            source = null
            if (!disposed && !reconnectTimer) {
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null
                connectStream()
              }, 5000)
            }
          }
        } catch {}
      }

      function openPopover(sessionId = '') {
        state = { ...state, popoverOpen: true, activeSessionId: String(sessionId ?? '') }
        emit()
      }

      function closePopover() {
        if (!state.popoverOpen) return
        state = { ...state, popoverOpen: false }
        emit()
      }

      function start() {
        void loadState()
        connectStream()
      }

      function dispose() {
        disposed = true
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = null
        try { source?.close() } catch {}
        source = null
        listeners.clear()
      }

      return {
        getState: () => state,
        subscribe: fn => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        loadState,
        syncNow,
        updateSettings,
        openPopover,
        closePopover,
        start,
        dispose,
      }
    }

    function useStore(store) {
      const [snap, setSnap] = useState(() => store.getState())
      useEffect(() => store.subscribe(setSnap), [store])
      return snap
    }

    function useNowTick(active) {
      const [nowMs, setNowMs] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        const id = setInterval(() => setNowMs(Date.now()), 30_000)
        return () => clearInterval(id)
      }, [active])
      return nowMs
    }

    function useNtrScopeAttribute() {
      const read = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ntr-acp')
      const [isNtr, setIsNtr] = useState(read)
      useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined
        const observer = new MutationObserver(() => setIsNtr(read()))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ntr-acp'] })
        setIsNtr(read())
        return () => observer.disconnect()
      }, [])
      return isNtr
    }

    // ========================================================================
    // 公共视图组件：进度条与分组卡片
    // ========================================================================

    function BucketBar({ title, bucket, displayMode, nowMs }) {
      if (!bucket) return null
      const val = bucketValue(bucket, displayMode)
      const tone = toneForRemaining(bucket.remainingPercent)
      const width = `${Math.max(0, Math.min(100, val ?? 0))}%`
      const modeText = displayMode === 'used'
        ? label(`已用 ${formatPercent(val)}`, `${formatPercent(val)} used`)
        : label(`剩余 ${formatPercent(val)}`, `${formatPercent(val)} left`)
      const countdown = formatCountdown(bucket.resetAt, nowMs)
      const resetHint = bucket.resetAt
        ? `${countdown}${countdown ? ' · ' : ''}${formatLocalTime(bucket.resetAt)}`
        : ''

      return h('div', { className: 'ntrq-meter-row' },
        h('div', { className: 'ntrq-meter-meta' },
          h('span', { className: 'ntrq-meter-label' }, title),
          h('span', { className: 'ntrq-meter-val' },
            modeText,
            resetHint ? h('span', { className: 'ntrq-meter-reset' }, resetHint) : null,
          ),
        ),
        h('div', { className: 'ntrq-track' },
          h('div', { className: `ntrq-fill is-${tone}`, style: { width } }),
        ),
      )
    }

    function AgentQuotaCards({ snap, nowMs }) {
      const displayMode = snap.settings?.displayMode ?? 'remaining'
      if (!Array.isArray(snap.agents) || snap.agents.length === 0) {
        return h('div', { className: 'ntrq-card' },
          h('div', { className: 'ntrq-sub' },
            snap.syncing
              ? label('正在从 NTR Agent 同步五小时与每周用量…', 'Syncing 5-hour and weekly quota from NTR agents…')
              : label('尚未获取到 NTR 用量数据，请确认 dsh-ntr 已配置 Agent 后点击「立即同步」。', 'No NTR quota data yet. Configure an agent in dsh-ntr and click Sync Now.'),
          ),
        )
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        snap.agents.map(agent =>
          h('div', { key: agent.agentId, className: 'ntrq-card' },
            h('div', { className: 'ntrq-card-head' },
              h('div', { className: 'ntrq-agent-name' }, `${agent.title || agent.agentId} (${agent.agentId})`),
              h('span', {
                className: `ntrq-badge ${agent.status === 'ok' ? 'is-ok' : agent.status === 'error' ? 'is-err' : ''}`,
              },
              agent.status === 'ok'
                ? label('已同步', 'Synced')
                : agent.status === 'unsupported'
                  ? label('暂不支持配额采集', 'Unsupported')
                  : agent.stale
                    ? label('同步失败（显示缓存）', 'Error (cached)')
                    : label('同步失败', 'Error'),
              ),
            ),
            agent.error ? h('div', { className: 'ntrq-err' }, agent.error) : null,
            agent.groups.length === 0 && agent.status === 'unsupported'
              ? h('div', { className: 'ntrq-sub' },
                label('当前仅支持 Antigravity (agy) 与 OpenAI Codex 的五小时/每周用量同步。', 'Currently supports Antigravity (agy) and OpenAI Codex 5-hour / weekly quotas.'),
              )
              : null,
            agent.groups.map(group =>
              h('div', { key: group.id, className: 'ntrq-group' },
                h('div', { className: 'ntrq-group-name' },
                  h('span', { className: `ntrq-dot is-${worstTone(group)}` }),
                  h('span', null, group.name),
                ),
                group.description ? h('div', { className: 'ntrq-group-desc' }, group.description) : null,
                h(BucketBar, {
                  title: label('五小时用量', '5-Hour Limit'),
                  bucket: group.fiveHour,
                  displayMode,
                  nowMs,
                }),
                h(BucketBar, {
                  title: label('每周用量', 'Weekly Limit'),
                  bucket: group.weekly,
                  displayMode,
                  nowMs,
                }),
                ...(Array.isArray(group.extraBuckets)
                  ? group.extraBuckets.map(extra =>
                    h(BucketBar, {
                      key: extra.id,
                      title: extra.label,
                      bucket: extra,
                      displayMode,
                      nowMs,
                    }))
                  : []),
              ),
            ),
          ),
        ),
      )
    }

    // ========================================================================
    // UI 入口 1：输入框底栏紧凑胶囊（conversation.composer.dock）
    // ========================================================================

    function selectDockTarget(snap, sessionId) {
      const binding = sessionId ? snap.sessions?.[sessionId] : null
      const preferredAgentId = binding?.agentId ?? snap.defaultAgentId
      const agent = snap.agents.find(a => a.agentId === preferredAgentId && a.groups?.length > 0)
        ?? snap.agents.find(a => a.groups?.length > 0)
      if (!agent) return null
      const group = matchQuotaGroup(agent.groups, binding?.modelId)
      if (!group) return null
      return { agent, group }
    }

    function QuotaDockPill({ store, sessionId, useSession }) {
      ensureStyle()
      const snap = useStore(store)
      const isNtrDom = useNtrScopeAttribute()
      const sid = String(sessionId ?? '')
      const isNtrSession = isNtrDom || Boolean(sid && snap.sessions?.[sid])

      // 监听对话轮次从 running -> idle，自动在冷却保护下刷新一次用量
      const running = typeof useSession === 'function' ? useSession(s => Boolean(s?.running)) : false
      const prevRunningRef = useRef(running)
      useEffect(() => {
        const wasRunning = prevRunningRef.current
        prevRunningRef.current = running
        if (wasRunning && !running && isNtrSession && snap.settings?.syncOnTurnEnd !== false) {
          void store.syncNow({ force: false, reason: 'turn-end' })
        }
      }, [running, isNtrSession, snap.settings?.syncOnTurnEnd, store])

      const visibility = snap.settings?.dockVisibility ?? 'ntr-only'
      if (visibility === 'hidden') return null
      if (visibility === 'ntr-only' && !isNtrSession) return null

      const target = useMemo(() => selectDockTarget(snap, sid), [snap, sid])
      const displayMode = snap.settings?.displayMode ?? 'remaining'

      if (!target) {
        if (!snap.syncing) return null
        return h('button', {
          type: 'button',
          className: 'ntrq-pill is-syncing',
          onClick: () => store.openPopover(sid),
          title: label('正在同步 NTR 五小时与每周用量', 'Syncing NTR 5-hour and weekly quota'),
        },
        h('span', { className: 'ntrq-dot is-neutral' }),
        h('span', null, label('同步用量…', 'Syncing…')),
        )
      }

      const { group } = target
      const fiveVal = bucketValue(group.fiveHour, displayMode)
      const weekVal = bucketValue(group.weekly, displayMode)
      const tone = worstTone(group)
      const modePrefix = displayMode === 'used' ? label('已用 ', 'Used ') : ''

      const parts = []
      if (fiveVal !== null) parts.push(`5h ${formatPercent(fiveVal)}`)
      if (weekVal !== null) parts.push(`${label('周', '7d')} ${formatPercent(weekVal)}`)
      if (parts.length === 0) return null

      const tooltipLines = [
        `${group.name} (${displayMode === 'used' ? label('已用比例', 'Used') : label('剩余额度', 'Remaining')})`,
        group.fiveHour ? `5h: ${formatPercent(fiveVal)} · ${formatCountdown(group.fiveHour.resetAt)}` : null,
        group.weekly ? `${label('每周', 'Weekly')}: ${formatPercent(weekVal)} · ${formatCountdown(group.weekly.resetAt)}` : null,
        label('点击查看全部模型分组与手动同步', 'Click to view all groups and sync'),
      ].filter(Boolean).join('\n')

      return h('button', {
        type: 'button',
        className: `ntrq-pill ${snap.syncing ? 'is-syncing' : ''}`,
        onClick: () => store.openPopover(sid),
        title: tooltipLines,
        'aria-label': tooltipLines,
      },
      h('span', { className: `ntrq-dot is-${tone}` }),
      h('span', null, `${modePrefix}${parts.join(' · ')}`),
      )
    }

    // ========================================================================
    // UI 入口 2：悬浮详情浮层（shell.overlay）
    // ========================================================================

    function QuotaPopover({ store }) {
      ensureStyle()
      const snap = useStore(store)
      const nowMs = useNowTick(snap.popoverOpen)

      useEffect(() => {
        if (!snap.popoverOpen || typeof window === 'undefined') return undefined
        const onKeyDown = e => { if (e.key === 'Escape') store.closePopover() }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [snap.popoverOpen, store])

      if (!snap.popoverOpen) return null
      const displayMode = snap.settings?.displayMode ?? 'remaining'

      return h('div', {
        className: 'ntrq-backdrop',
        onClick: e => { if (e.target === e.currentTarget) store.closePopover() },
      },
      h('div', { className: 'ntrq-modal', role: 'dialog', 'aria-label': label('NTR 用量详情', 'NTR Quota Details') },
        h('div', { className: 'ntrq-head', style: { marginBottom: '14px' } },
          h('div', null,
            h('h3', { className: 'ntrq-title' }, label('NTR 五小时与每周用量', 'NTR 5-Hour & Weekly Quota')),
            h('p', { className: 'ntrq-sub' },
              snap.syncedAt
                ? label(`上次同步：${formatLocalTime(snap.syncedAt)}`, `Last synced: ${formatLocalTime(snap.syncedAt)}`)
                : label('尚未完成同步', 'Not synced yet'),
            ),
          ),
          h('div', { className: 'ntrq-actions' },
            h('button', {
              type: 'button',
              className: 'ntrq-btn',
              onClick: () => store.updateSettings({ displayMode: displayMode === 'remaining' ? 'used' : 'remaining' }),
            }, displayMode === 'remaining' ? label('切换为已用', 'Show Used') : label('切换为剩余', 'Show Remaining')),
            h('button', {
              type: 'button',
              className: 'ntrq-btn is-primary',
              disabled: snap.syncing,
              onClick: () => store.syncNow({ force: true, reason: 'manual' }),
            }, snap.syncing ? label('同步中…', 'Syncing…') : label('立即同步', 'Sync Now')),
            h('button', {
              type: 'button',
              className: 'ntrq-btn',
              onClick: () => store.closePopover(),
            }, label('关闭', 'Close')),
          ),
        ),
        snap.clientError ? h('div', { className: 'ntrq-err', style: { marginBottom: '12px' } }, snap.clientError) : null,
        h(AgentQuotaCards, { snap, nowMs }),
      ),
      )
    }

    // ========================================================================
    // UI 入口 3：设置页完整看板（settings.section）
    // ========================================================================

    function QuotaSettingsSection({ store }) {
      ensureStyle()
      const snap = useStore(store)
      const nowMs = useNowTick(true)
      const settings = snap.settings ?? {}

      return h('div', { className: 'ntrq-page' },
        h('div', { className: 'ntrq-head' },
          h('div', null,
            h('h2', { className: 'ntrq-title' }, label('NTR 五小时与每周用量同步', 'NTR 5-Hour & Weekly Quota Sync')),
            h('p', { className: 'ntrq-sub' },
              label(
                '自动读取 NTR（dsh-ntr）已配置 Agent 的五小时滚动配额与每周配额，并在输入框底栏与本页实时展示。',
                'Automatically syncs 5-hour rolling and weekly quotas from configured dsh-ntr agents.',
              ),
            ),
          ),
          h('div', { className: 'ntrq-actions' },
            h('button', {
              type: 'button',
              className: 'ntrq-btn is-primary',
              disabled: snap.syncing,
              onClick: () => store.syncNow({ force: true, reason: 'manual' }),
            }, snap.syncing ? label('同步中…', 'Syncing…') : label('立即同步', 'Sync Now')),
          ),
        ),
        snap.clientError ? h('div', { className: 'ntrq-err' }, snap.clientError) : null,
        h(AgentQuotaCards, { snap, nowMs }),
        h('div', { className: 'ntrq-card' },
          h('div', { className: 'ntrq-agent-name' }, label('同步与展示偏好', 'Sync & Display Preferences')),
          h('div', { className: 'ntrq-setting-row' },
            h('span', null, label('百分比口径', 'Percentage mode')),
            h('select', {
              className: 'ntrq-select',
              value: settings.displayMode ?? 'remaining',
              onChange: e => store.updateSettings({ displayMode: e.target.value }),
            },
            h('option', { value: 'remaining' }, label('显示剩余额度（Remaining）', 'Remaining')),
            h('option', { value: 'used' }, label('显示已用比例（Used）', 'Used')),
            ),
          ),
          h('div', { className: 'ntrq-setting-row' },
            h('span', null, label('定时自动同步间隔', 'Auto-sync interval')),
            h('select', {
              className: 'ntrq-select',
              value: String(settings.pollIntervalMs ?? 300_000),
              onChange: e => store.updateSettings({ pollIntervalMs: Number(e.target.value) }),
            },
            h('option', { value: '60000' }, label('每 1 分钟', 'Every 1 min')),
            h('option', { value: '180000' }, label('每 3 分钟', 'Every 3 min')),
            h('option', { value: '300000' }, label('每 5 分钟（推荐）', 'Every 5 min')),
            h('option', { value: '900000' }, label('每 15 分钟', 'Every 15 min')),
            h('option', { value: '0' }, label('仅手动同步', 'Manual only')),
            ),
          ),
          h('div', { className: 'ntrq-setting-row' },
            h('span', null, label('输入框底栏胶囊显示范围', 'Composer dock pill')),
            h('select', {
              className: 'ntrq-select',
              value: settings.dockVisibility ?? 'ntr-only',
              onChange: e => store.updateSettings({ dockVisibility: e.target.value }),
            },
            h('option', { value: 'ntr-only' }, label('仅在 NTR 会话显示', 'NTR conversations only')),
            h('option', { value: 'always' }, label('所有会话均显示', 'All conversations')),
            h('option', { value: 'hidden' }, label('隐藏底栏胶囊', 'Hidden')),
            ),
          ),
          h('div', { className: 'ntrq-setting-row' },
            h('span', null, label('NTR 对话结束后自动刷新', 'Auto-sync after NTR turn')),
            h('input', {
              type: 'checkbox',
              checked: settings.syncOnTurnEnd !== false,
              onChange: e => store.updateSettings({ syncOnTurnEnd: Boolean(e.target.checked) }),
            }),
          ),
          snap.snapshotPath
            ? h('div', { className: 'ntrq-mono' },
              label(`本地同步快照：${snap.snapshotPath}`, `Local snapshot: ${snap.snapshotPath}`),
              snap.syncedAt ? ` · ${formatLocalTime(snap.syncedAt)}` : '',
            )
            : null,
        ),
      )
    }

    // ========================================================================
    // Cordis Browser 插件入口
    // ========================================================================

    function apply(ctx) {
      const store = createClientStore()
      ctx.effect(() => {
        store.start()
        return () => store.dispose()
      }, 'dsh-ntr-quota: client store')

      ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'ntr-quota-pill',
        order: 20,
        inject: sessionId => ({ store, sessionId: String(sessionId ?? '') }),
      }, QuotaDockPill)), 'dsh-ntr-quota: composer dock pill')

      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'ntr-quota-popover',
        order: 35,
        inject: () => ({ store }),
      }, QuotaPopover)), 'dsh-ntr-quota: detail popover')

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'ntr-quota',
        order: 125,
        label: () => label('NTR 用量', 'NTR Quota'),
        inject: () => ({ store }),
      }, QuotaSettingsSection)), 'dsh-ntr-quota: settings section')
    }

    exports.name = 'dsh-ntr-quota-client'
    exports.inject = ['slots']
    exports.apply = apply
    exports.__test = {
      matchQuotaGroup,
      formatCountdown,
      selectDockTarget,
      createClientStore,
      QuotaDockPill,
      QuotaPopover,
      QuotaSettingsSection,
    }
    return module.exports
  },
})
