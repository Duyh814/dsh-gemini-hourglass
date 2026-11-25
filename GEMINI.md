# dsh-ntr-quota - DeepSeek Harness NTR 五小时与每周用量同步插件

Node.js >= 22 (ESM) + Cordis (`@deepseek-ai/cordis`) + React 19 (DSH Shell ModuleLoader) + Zero Runtime Dependencies

<directory>
src/ - Host 端核心逻辑（NTR 注册表读取、持久化存储、单飞同步调度、HTTP/SSE 路由、格式化工具）(1 subdirectory: providers/)
src/providers/ - 多 Agent 用量采集适配器（agy Antigravity CLI、codex 本地会话速率限制）
scripts/ - 本地桌面端 Profile 一键安装与卸载脚本
test/ - 基于 node:test 的单元测试与客户端无头冒烟测试
</directory>

<config>
package.json - DSH 插件包清单与 bundle/client 注入声明
cordis.patch.yml - Cordis 插件挂载补丁（声明 Host 与 Browser 双向入口）
index.js - Host 端 Cordis 插件入口（挂载 /api/ntr-quota/* 与后台同步调度）
client.js - Browser 端 ModuleLoader 入口（输入框底栏用量胶囊、悬浮详情面板、设置页看板）
</config>
