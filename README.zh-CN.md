# OpenYOLO

[English](./README.md) | 中文

OpenYOLO 是一个 Obsidian 桌面端的 AI 笔记助手插件。插件本身不实现任何 Agent / 模型逻辑，而是通过 [Agent Client Protocol](https://agentclientprotocol.com)(ACP)接入 [opencode](https://opencode.ai) 作为后端,在侧边栏提供对话界面。模型接入、工具执行、会话历史与记忆全部由 opencode 原生维护。

## 功能

- **对话**:流式输出、推理过程折叠、工具调用卡片(读写/编辑/终端/搜索,编辑带 diff 预览)、输入框上方的结构化待办面板
- **子 Agent**:任务结果保留在原工具调用卡片中并默认折叠,需要时可就地展开查看输出
- **上下文感知**:可配置是否自动附带当前打开的笔记;可通过附件面板多选库内笔记,或添加外部文本文件/图片(支持粘贴)
- **权限审批**:工具权限请求始终以卡片呈现(允许一次/总是允许/拒绝)
- **模式切换**:计划(受限规划模式,编辑文件与执行命令行为由你的 opencode 权限配置决定)/ 构建,映射 opencode session mode
- **模型与思考强度**:列出 opencode 已配置的全部模型并可搜索切换,选择结果持久化,重启后自动恢复(已下架的模型回退到列表第一项)
- **斜杠命令**:输入 `/` 唤起 opencode commands / skills
- **历史会话**:自动恢复最近一次会话,历史列表随时切换
- **对话导出**:手动将当前对话导出为普通 Markdown 笔记,按可配置文件夹组织(默认 `YOLO/<YYYY-MM-DD>/<标题>.md`)。导出内容不包含私有会话元数据、不覆盖已有笔记,重名时使用普通数字后缀
- **笔记助手提示词**:可在库根目录 `AGENTS.md` 中维护一段托管区块,引导 opencode 面向笔记场景工作;该功能默认关闭,需在设置中主动开启,提示词可编辑

## 实现方案

```
Obsidian 插件 (ACP Client)  ──stdio / JSON-RPC──▶  opencode acp (子进程)
```

- 以子进程方式启动 `opencode acp`,使用官方 SDK `@agentclientprotocol/sdk` 通信
- 会话由 opencode 持久化,插件通过 `session/list` + `session/load` 回放历史
- 附件以 ACP `resource_link` 发送,由 opencode 原生读取文件
- 文件读写能力(`fs/read_text_file` / `fs/write_text_file`)经 Obsidian vault adapter 实现,同时校验词法路径和真实路径,拒绝越出库根目录的符号链接,并在写入前重新验证父目录。这仍不是完整安全沙箱:opencode 作为受信任的本地子进程运行。
- `AGENTS.md` 托管为主动开启功能。开启后,插件以原子方式仅更新自身标记区块,保留区块外的原有内容。
- 权限请求(`session/request_permission`)路由到插件内审批卡片
- 对话导出是单向能力:会话持久化与恢复完全交给 ACP/opencode,OpenYOLO 只写入可阅读的 Markdown 快照,不额外维护会话与笔记的映射
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
