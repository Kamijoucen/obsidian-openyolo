# OpenYOLO

[English](./README.md) | 中文

在 Obsidian 侧边栏与 AI 对话，帮你查阅、整理和修改笔记。

OpenYOLO 适用于 **Obsidian 桌面端**，需要先安装并配置 [opencode](https://opencode.ai)。

## 能做什么

- **围绕笔记提问**：自动附带当前笔记，也可以选择多篇笔记、外部文本文件或图片，支持粘贴图片。
- **阅读与修改笔记**：让 AI 总结内容、整理资料或修改笔记，查看执行过程和修改差异。遇到权限请求时，可直接允许或拒绝。
- **查看任务进度**。回复实时显示，思考过程可展开或折叠，待办清单会显示任务进度。
- **浏览子 Agent**。使用 OpenCode 2 时，点击任务工具卡片上的 **查看子会话**，可只读浏览实时输出、工具调用和历史。任务状态会在原卡片上更新。
- **后台任务运行时继续对话**。主会话当前一轮结束后，即使子 Agent 仍在运行，也可以继续提问。主会话主动发出的补充会标为 **后台补充**。
- **选择模型和模式**：搜索切换已配置的模型，调整支持的思考强度，选择计划或构建模式。
- **继续之前的对话**：打开时恢复最近一次会话，也可从历史列表切换。
- **分叉对话**。点击顶栏的分叉按钮，将当前会话的全部历史复制到新会话。此功能需要后端支持 ACP fork。
- **快速复用提问**：在输入框开头按 ↑、末尾按 ↓ 恢复历史文字。跨会话共享最近 **32 条**输入，本地保存，重启后仍可用；修改文字后重新从最新记录开始浏览。
- **把对话存成笔记**：随时导出为 Markdown 笔记，保存位置可设置，不覆盖已有笔记。
- **按自己的习惯使用**：输入 `/` 选择命令或技能；可在设置中启用和编辑笔记助手提示词，启用后写入库内的 `AGENTS.md`。

## 实现方案

OpenYOLO 提供 Obsidian 内的对话界面，**不包含 Agent 实现**。插件通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com) 连接本地的 [opencode](https://opencode.ai) 作为后端，由 opencode 负责模型调用、工具执行和会话管理。

```text
Obsidian / OpenYOLO ←→ ACP ←→ opencode ←→ AI 模型
```

## 开始使用

如需手动安装，从 [最新发布](https://github.com/Kamijoucen/obsidian-openyolo/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入笔记库的 `.obsidian/plugins/openyolo/` 目录，再到 **设置 → 第三方插件** 启用 OpenYOLO。

安装 [opencode](https://opencode.ai)，运行 `opencode auth login` 配置模型供应商，即可开始使用。

如果提示找不到 opencode，可以在插件设置中填写它的可执行文件路径。

## 访问权限

OpenYOLO 以笔记库为工作目录启动本地 opencode。该进程以你的操作系统账户权限运行，使用你在 opencode 中配置的工具权限和模型供应商，并接收你提交的提示词及随附内容。

OpenYOLO 使用 Node.js 查找可执行文件，并检查 ACP 文件请求是否位于库内，包括经过符号链接的路径。笔记选择器在本地搜索 Markdown 路径，并附上你选中的文件。向输入框粘贴图片时，插件会读取该图片。点击图表或公式的复制按钮时，插件会将对应的 Markdown 写入剪贴板。

## 关于

本项目源自 [obsidian-yolo](https://github.com/lapis0x0/obsidian-yolo)，现已独立开发，不保持上游兼容。

[MIT 许可证](./LICENSE)
