/**
 * [INPUT]: 依赖 @deepseek-ai/cordis 宿主上下文（connection / webServer）与 src/sync-service.js、src/routes.js
 * [OUTPUT]: 导出具名插件元数据 name、inject 与生命周期入口 apply
 * [POS]: dsh-ntr-quota Host 端唯一入口，将配额同步路由挂载至 DSH connection 信任边界内并随 fiber 启停
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { createRouteDefinitions } from './src/routes.js'
import { createSyncService } from './src/sync-service.js'

// ============================================================================
// Cordis 插件元数据（仅具名导出，避免默认导出遮蔽 Loader 元数据）
// ============================================================================

export const name = 'dsh-ntr-quota'
export const inject = ['webServer', 'connection']

/**
 * 激活 Host 端配额同步服务与 HTTP/SSE 路由。
 * @param {any} ctx
 */
export function apply(ctx) {
  const logger = ctx.logger ?? console
  const service = createSyncService({ logger })
  const routes = createRouteDefinitions(service)

  for (const route of routes) {
    ctx.effect(
      () => ctx.connection.fetch.register(route),
      `dsh-ntr-quota: route ${route.path}`,
    )
  }

  ctx.effect(() => {
    service.start()
    return () => {
      service.dispose()
    }
  }, 'dsh-ntr-quota: background sync scheduler')

  logger.info?.('dsh-ntr-quota: mounted at /api/ntr-quota/*')
}
