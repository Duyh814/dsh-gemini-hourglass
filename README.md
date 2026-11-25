# Gemini 沙漏 (`dsh-gemini-hourglass`)

> 包名：`dsh-ntr-quota` · 让 NTR 中的五小时与每周配额如沙漏般清晰可见

**DeepSeek Harness（DSH）插件**：自动同步并实时展示 **NTR（`dsh-ntr`）** 中 ACP Agent 的 **五小时用量（5-Hour Limit）** 与 **每周用量（Weekly Limit）** 及精确重置倒计时。

## 核心能力

- **零 Token 真实同步**：
  - **Antigravity CLI（`agy`）**：通过官方命令 `agy -p "/usage" --output-format json` 零 Token 采集各模型分组（`Gemini Models`、`Claude and GPT models`、`Gemini 4 Argon`）的五小时与每周配额及重置时间，并内置纯文本解析兜底与 macOS 桌面端 `PATH` 补全。
  - **OpenAI Codex（`codex`）**：若 NTR 配置了 Codex，自动只读读取 `~/.codex/sessions` 最新会话的 `rate_limits` 快照。
- **三处原生主题融合界面**：
  1. **输入框底栏胶囊（`conversation.composer.dock`）**：紧邻 NTR 上下文占比环展示当前对话模型对应的 `5h XX% · 周 XX%`，支持状态颜色预警，对话轮次结束后自动在冷却保护内刷新。
  2. **详情浮层（`shell.overlay`）**：点击底栏胶囊弹出全部 Agent 与模型分组的双进度条、重置倒计时与「立即同步」按钮。
  3. **设置页看板（`settings.section` → `NTR 用量`）**：完整用量总览、剩余/已用口径切换、定时刷新间隔配置与底栏展示策略。
- **本地原子快照持久化**：每次同步结果原子写入 `~/.dsh/dsh-ntr-quota/snapshot.json`，方便外部状态栏或脚本直接消费，启动瞬间即可回显缓存。
- **零外部运行时依赖**：纯 Node ESM Host + DSH ModuleLoader React Browser 半身，开箱即用，无需额外编译。

## 安装到 DeepSeek Harness 桌面端

> 提示：请在**没有正在执行的 NTR 对话轮次**时运行安装命令，避免触发热重载中断当前对话。

```bash
git clone https://github.com/Duyh814/dsh-gemini-hourglass.git
cd dsh-gemini-hourglass
npm run install:desktop
```

如需卸载：

```bash
npm run uninstall:desktop
```

## 同源 HTTP / SSE 接口

所有路由挂载于 DSH `ctx.connection.fetch` 信任边界内：

| 路径 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/api/ntr-quota/state` | `GET` | 返回当前缓存快照、NTR 会话模型绑定与同步偏好设置 |
| `/api/ntr-quota/sync` | `POST` | 立即触发单飞同步（支持 `{ force, reason }`，并发自动合并） |
| `/api/ntr-quota/settings` | `POST` | 更新同步间隔、百分比口径、底栏可见性与轮次结束自动刷新 |
| `/api/ntr-quota/stream` | `GET` | SSE 实时事件流，同步状态变更时主动推送前端刷新 |

## 运行测试

```bash
npm test
```
