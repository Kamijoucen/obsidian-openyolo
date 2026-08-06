# OpenYOLO

[English](./README.md) | 中文

OpenYOLO 是一个 Obsidian 桌面端的 AI 笔记助手插件。插件本身不实现任何 Agent / 模型逻辑，而是通过 [Agent Client Protocol](https://agentclientprotocol.com)(ACP)接入 [opencode](https://opencode.ai) 作为后端,在侧边栏提供对话界面。模型接入、工具执行、会话历史与记忆全部由 opencode 原生维护。

## 功能

- **对话**:流式输出、推理过程折叠、工具调用卡片(读写/编辑/终端/搜索,编辑带 diff 预览)、计划面板
- **上下文感知**:自动附带当前打开的笔记;可通过附件面板多选库内笔记,或添加外部文本文件/图片(支持粘贴)
- **权限审批**:工具权限请求以卡片呈现(允许一次/总是允许/拒绝),可开启 YOLO 模式自动批准
- **模式切换**:计划(受限规划模式,编辑文件与执行命令行为由你的 opencode 权限配置决定)/ 构建,映射 opencode session mode
- **模型与思考强度**:列出 opencode 已配置的全部模型并可搜索切换,选择结果持久化,重启后自动恢复(已下架的模型回退到列表第一项)
- **斜杠命令**:输入 `/` 唤起 opencode commands / skills
- **历史会话**:自动恢复最近一次会话,历史列表随时切换
- **笔记助手提示词**:在库根目录 `AGENTS.md` 中维护一段托管区块,引导 opencode 面向笔记场景工作,可在设置中编辑或关闭

## 实现方案

```
Obsidian 插件 (ACP Client)  ──stdio / JSON-RPC──▶  opencode acp (子进程)
```

- 以子进程方式启动 `opencode acp`,使用官方 SDK `@agentclientprotocol/sdk` 通信
- 会话由 opencode 持久化,插件通过 `session/list` + `session/load` 回放历史
- 附件以 ACP `resource_link` 发送,由 opencode 原生读取文件
- 文件读写能力(`fs/read_text_file` / `fs/write_text_file`)经 Obsidian vault adapter 实现,并拒绝词法路径不在库根目录内的请求。这是路径边界而非安全沙箱:opencode 作为受信任的本地子进程运行,库内符号链接仍可能解析到库外。
- 权限请求(`session/request_permission`)路由到插件内审批卡片
- 前端为 React 渲染的 ItemView,`session/update` 经不可变状态映射驱动流式渲染

## 前置条件

1. 安装 opencode:`curl -fsSL https://opencode.ai/install | bash`
2. 配置模型供应商:`opencode auth login`
3. 仅限桌面端(需 Node 子进程能力)

## 安装

将 `manifest.json`、`main.js`、`styles.css` 放入库的 `.obsidian/plugins/openyolo/`,然后在「设置 → 第三方插件」中启用。

## 本地开发

```bash
npm install
npm run dev        # 监听构建
npm run build      # 生产构建
npm run type:check && npm run lint:check && npm test   # 质量检查
```

## 声明

本插件 fork 自 [obsidian-yolo](https://github.com/lapis0x0/obsidian-yolo),现已完全独立开发:不同步上游功能,也不保持兼容。

## 许可证

[MIT](./LICENSE)
