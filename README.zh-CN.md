# OpenYOLO

[English](./README.md) | 中文

在 Obsidian 侧边栏与 AI 对话，帮你查阅、整理和修改笔记。

OpenYOLO 适用于 **Obsidian 桌面端**，需要先安装并配置 [opencode](https://opencode.ai)。

## 能做什么

- **围绕笔记提问**：自动附带当前笔记，也可以选择多篇笔记、外部文本文件或图片，支持粘贴图片。
- **阅读与修改笔记**：让 AI 总结内容、整理资料或修改笔记，查看执行过程和修改差异。遇到权限请求时，可直接允许或拒绝。
- **查看任务进度**：回复实时显示，思考过程可展开或折叠；待办清单显示任务进度，子任务结果可就地查看。
- **选择模型和模式**：搜索切换已配置的模型，调整支持的思考强度，选择计划或构建模式。
- **继续之前的对话**：打开时恢复最近一次会话，也可从历史列表切换。
- **快速复用提问**：在输入框开头按 ↑、末尾按 ↓ 恢复历史文字。跨会话共享最近 **32 条**输入，本地保存，重启后仍可用；修改文字后重新从最新记录开始浏览。
- **把对话存成笔记**：随时导出为 Markdown 笔记，保存位置可设置，不覆盖已有笔记。
- **按自己的习惯使用**：输入 `/` 选择命令或技能；可在设置中启用和编辑笔记助手提示词，启用后写入库内的 `AGENTS.md`。

## 实现方案

OpenYOLO 提供 Obsidian 内的对话界面，**不包含 Agent 实现**。插件通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com) 连接本地的 [opencode](https://opencode.ai) 作为后端，由 opencode 负责模型调用、工具执行和会话管理。

```text
Obsidian / OpenYOLO ←→ ACP ←→ opencode ←→ AI 模型
```

## 开始使用

安装 [opencode](https://opencode.ai)，运行 `opencode auth login` 配置模型供应商，即可开始使用。

如果提示找不到 opencode，可以在插件设置中填写它的可执行文件路径。

## 关于

本项目源自 [obsidian-yolo](https://github.com/lapis0x0/obsidian-yolo)，现已独立开发，不保持上游兼容。

[MIT 许可证](./LICENSE)
