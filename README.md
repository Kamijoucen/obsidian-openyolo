# OpenYOLO

English | [中文](./README.zh-CN.md)

OpenYOLO is an AI note assistant plugin for Obsidian (desktop only). The plugin itself contains no agent or model implementation — instead, it connects to [opencode](https://opencode.ai) as its backend via the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), and provides a chat interface in the sidebar. Model access, tool execution, session history and memory are all maintained natively by opencode.

## Features

- **Chat**: streaming output, collapsible reasoning, tool-call cards (read/write/edit/terminal/search, with diff preview for edits), and a structured todo panel above the composer
- **Subagents**: completed task results stay in their original tool cards and are collapsed by default; expand a card to inspect the inline output
- **Context awareness**: can automatically attach the currently open note (configurable); attach multiple vault notes via the attachment panel, or add external text files / images (paste supported)
- **Permission approvals**: tool permission requests are always shown as cards (allow once / always allow / reject)
- **Mode switching**: plan (a restricted planning mode where file editing and command execution depend on your opencode permission configuration) / build, mapped to opencode session modes
- **Model & effort selection**: searchable list of all models configured in opencode; selections are persisted and restored across restarts (falls back to the first model if the saved one disappears)
- **Slash commands**: type `/` to invoke opencode commands / skills
- **History**: automatically restores the most recent session; browse all persisted sessions
- **Conversation export**: manually export the current conversation as a plain Markdown note under a configurable folder (default `YOLO/<YYYY-MM-DD>/<title>.md`). Exports contain no private session metadata, never overwrite existing notes, and use ordinary numeric suffixes for duplicate names
- **Note-assistant prompt**: can maintain a managed block in the vault-root `AGENTS.md` to guide opencode toward note-centric work; this opt-in feature is disabled by default and its prompt is editable in settings

## How it works

```
Obsidian plugin (ACP client)  ──stdio / JSON-RPC──▶  opencode acp (subprocess)
```

- Spawns `opencode acp` as a subprocess and communicates via the official `@agentclientprotocol/sdk`
- Sessions are persisted by opencode; the plugin replays history via `session/list` + `session/load`
- Attachments are sent as ACP `resource_link` blocks and read natively by opencode
- File access (`fs/read_text_file` / `fs/write_text_file`) is implemented through the vault adapter. It validates lexical and real paths, rejects symlinks that escape the vault, and revalidates parent directories before writes. This is still not a complete sandbox: opencode runs as a trusted local subprocess.
- `AGENTS.md` management is opt-in. When enabled, the plugin atomically updates only its marked block and preserves content outside that block.
- Permission requests (`session/request_permission`) are routed to in-plugin approval cards
- Conversation export is intentionally one-way: ACP/opencode owns session persistence and restoration, while OpenYOLO only writes readable Markdown snapshots without maintaining a separate session-to-note mapping
- The UI is a React-rendered ItemView; `session/update` notifications are mapped to immutable state for streaming rendering

## Prerequisites

1. Install opencode: `curl -fsSL https://opencode.ai/install | bash`
2. Configure a model provider: `opencode auth login`
3. Desktop only (requires Node subprocess capability)

## Installation

Copy `manifest.json`, `main.js` and `styles.css` into `.obsidian/plugins/openyolo/` of your vault, then enable OpenYOLO in "Settings → Community plugins".

## Development

```bash
npm install
npm run dev        # watch build
npm run build      # production build
npm run type:check && npm run lint:check && npm test   # quality gates
```

## Disclaimer

This plugin was forked from [obsidian-yolo](https://github.com/lapis0x0/obsidian-yolo) and is now developed fully independently: it neither syncs upstream features nor maintains compatibility.

## License

[MIT](./LICENSE)
