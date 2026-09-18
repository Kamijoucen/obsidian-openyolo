# OpenYOLO

English | [中文](./README.zh-CN.md)

Chat with AI in the Obsidian sidebar to explore, organize, and edit your notes.

OpenYOLO works on **Obsidian desktop** and requires [opencode](https://opencode.ai) to be installed and configured.

## What you can do

- **Ask about your notes**: automatically include the current note, or attach multiple notes, external text files, and images. Pasting images is supported.
- **Read and edit notes**: ask AI to summarize content, organize information, or update notes. See its actions and file changes, and allow or reject permission requests when they appear.
- **Follow task progress**: read replies as they arrive, expand or collapse reasoning, track a todo list, and inspect subtask results within the conversation.
- **Choose your model and mode**: search your configured models, adjust supported reasoning levels, and switch between plan and build modes.
- **Pick up where you left off**: reopen your latest conversation automatically or switch to an earlier one from the history list.
- **Reuse previous prompts**: press ↑ at the start of the input or ↓ at the end to recall text. The latest **32 inputs** are shared across sessions and saved locally across restarts. Editing the text resets browsing to the newest entry.
- **Save conversations as notes**: export a conversation to Markdown in a folder of your choice, without overwriting existing notes.
- **Make it your own**: type `/` to select commands or skills. Optionally enable and edit the note-assistant instructions in settings; enabling them writes a section to your vault's `AGENTS.md`.

## How it works

OpenYOLO provides the chat interface inside Obsidian and **does not include an agent implementation**. It connects to a local [opencode](https://opencode.ai) backend through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). opencode handles model calls, tool execution, and session management.

```text
Obsidian / OpenYOLO ←→ ACP ←→ opencode ←→ AI model
```

## Get started

Install [opencode](https://opencode.ai) and run `opencode auth login` to configure a model provider. You're ready to start chatting.

If OpenYOLO cannot find opencode, set its executable path in the plugin settings.

## About

Originally forked from [obsidian-yolo](https://github.com/lapis0x0/obsidian-yolo). OpenYOLO is now developed independently and does not maintain upstream compatibility.

[MIT License](./LICENSE)
