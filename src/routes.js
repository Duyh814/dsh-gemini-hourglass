/**
 * [INPUT]: 依赖 src/sync-service.js 提供的 SyncService 实例与标准 Web Request/Response
 * [OUTPUT]: 导出 createRouteDefinitions，定义 /api/ntr-quota/{state,sync,settings,stream} 路由
 * [POS]: src/ 的 HTTP/SSE 传输适配层，供 index.js 注册到 ctx.connection.fetch
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}

async function readJsonBody(request) {
  try {
    const text = await request.text()
    if (!text.trim()) return {}
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function formatSseFrame(event) {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * 构建所有同源 HTTP 与 SSE 路由定义。
 * @param {ReturnType<import('./sync-service.js').createSyncService>} service
 */
export function createRouteDefinitions(service) {
  return [
    {
      path: '/api/ntr-quota/state',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse(service.getState()),
    },
    {
      path: '/api/ntr-quota/sync',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        const body = await readJsonBody(request)
        const force = body.force !== false
        const reason = typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim().slice(0, 32)
          : (force ? 'manual' : 'turn-end')
        const state = await service.sync({ force, reason })
        return jsonResponse(state)
      },
    },
    {
      path: '/api/ntr-quota/settings',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        const body = await readJsonBody(request)
        const state = service.updateSettings(body)
        return jsonResponse(state)
      },
    },
    {
      path: '/api/ntr-quota/stream',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async request => {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            let closed = false

            const send = payload => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(formatSseFrame(payload)))
              } catch {
                closed = true
              }
            }

            const unsubscribe = service.subscribe(send)
            const keepalive = setInterval(() => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(': keepalive\n\n'))
              } catch {
                closed = true
              }
            }, 25_000)
            keepalive.unref?.()

            const finish = () => {
              if (closed) return
              closed = true
              clearInterval(keepalive)
              unsubscribe()
              try {
                controller.close()
              } catch {
                // 流已关闭时忽略
              }
            }

            request.signal?.addEventListener('abort', finish, { once: true })
            send({ type: 'state', state: service.getState() })
          },
        })

        return new Response(stream, {
          status: 200,
          headers: SSE_HEADERS,
        })
      },
    },
  ]
}
