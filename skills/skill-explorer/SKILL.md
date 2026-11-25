---
name: skill-explorer
description: >-
  Open the interactive Skill Explorer UI panel in Antigravity to browse, search,
  edit, create, import (from ~/.agents/skills or ~/.dsh/skills), and invoke
  skills with one click. Use when the user asks to view installed skills, open
  the skill center/explorer, manage skills visually, or pick a skill to invoke.
---

# Skill Explorer

Use the `open_skill_explorer` tool from the `skill-explorer` plugin's MCP server to open the interactive Skill Explorer panel in the side pane.

## Usage

- Call `open_skill_explorer` with optional `query` (initial search filter) and optional `workspace_dir` (active workspace path so project-scoped `.agents/skills` are also scanned).
- Once open, the user can:
  - Search and filter skills by source (`Antigravity 全局`, `工作区`, `已安装插件`, `Antigravity 内置`, `外部可导入 (.agents / .dsh)`).
  - Click **调用 (Invoke)** to send a skill invocation message directly into the conversation, or **附加 (Attach)** to attach the skill's guidance to their next message.
  - Read, create, edit, toggle, or safely delete writable `SKILL.md` files.
  - Import skills from `~/.agents/skills` or `~/.dsh/skills` into `~/.gemini/config/skills` with one click.
