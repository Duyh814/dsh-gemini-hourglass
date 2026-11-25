# providers/
> L2 | Parent: ../GEMINI.md

Member list
index.js: 配额适配器注册表，按 Agent 特征分发至对应采集器，支持依赖注入扩展
agy.js: Antigravity CLI 适配器，调用 `agy -p "/usage" --output-format json` 零 Token 采集并兼容纯文本兜底解析
codex.js: OpenAI Codex 适配器，只读扫描 `~/.codex/sessions` 最新 JSONL 中的 `rate_limits` 快照并归一化五小时与每周窗口

[PROTOCOL]: Update this header on change, then check GEMINI.md
