# src/
> L2 | Parent: ../GEMINI.md

Member list
format.js: 数值规整、模型到配额分组匹配、重置倒计时格式化与桌面端 PATH 补全纯函数
ntr-registry.js: 只读解析 `~/.dsh/dsh-ntr/agents.json`，提取已配置 Agent 列表与会话模型绑定
store.js: 原子读写 `~/.dsh/dsh-ntr-quota/{settings,snapshot}.json`，提供配置校验与默认值
sync-service.js: 单飞同步编排器，管理并发去重、冷却防抖、定时轮询、故障降级与事件广播
routes.js: Web Fetch 路由与 SSE 推送流定义（`/api/ntr-quota/{state,sync,settings,stream}`）
providers/: 多 Agent 配额采集适配器目录（agy、codex）

[PROTOCOL]: Update this header on change, then check GEMINI.md
