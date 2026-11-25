# Antigravity Skill Explorer

专为 **Google Antigravity** 构建的可视化 Skill 浏览器与一键调用中心插件（基于 MCP App / SEP-1865）。

## 功能特性

- **双入口原生集成**：支持从 Antigravity **右侧辅助栏 `+` 菜单**（侧栏模式）和 **左侧全局导航栏**（全页双栏模式）打开，也可在对话里直接说“打开 Skill Explorer”。
- **按来源分类浏览**：自动扫描并分类展示：
  - Antigravity 全局 Skills（`~/.gemini/config/skills`）
  - 当前工作区 Skills（`.agents/skills`、`.agent/skills` 等，支持指定工作区路径）
  - 已安装插件 Skills（`~/.gemini/config/plugins/*/skills`）
  - 外部可导入 Skills（`~/.agents/skills`、`~/.dsh/skills`、`~/.gemini/skills`）
  - Antigravity 内置 Skills（默认折叠）
- **一键调用与上下文附加**：
  - 点击 **▶ 调用** 可输入具体任务并直接通过 `sendMessage` 向当前对话发送调用指令（全页模式自动降级为复制指令）。
  - 点击 **📎 附加** 可将 `SKILL.md` 作为上下文附加到下一条消息。
- **在线管理与跨工具导入**：
  - 支持对全局/工作区 Skill 在线新建、编辑 `SKILL.md`、启停 `disable-model-invocation`、安全移入 `.trash` 回收站，以及在侧栏打开源文件。
  - 支持将 `~/.agents/skills` 或 `~/.dsh/skills` 中的 Skill 一键导入到 Antigravity 全局目录。
- **零前端构建依赖**：仓库已内置打包好的单文件 [ui/app.html](ui/app.html)，安装时只需要 Python 3.10+（或 `uv`）。

## 一键安装

### Windows (PowerShell)

```powershell
git clone https://github.com/wwwww-alt/antigravity-skill-explorer.git
cd antigravity-skill-explorer
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```bash
git clone https://github.com/wwwww-alt/antigravity-skill-explorer.git
cd antigravity-skill-explorer
chmod +x ./install.sh && ./install.sh
```

安装脚本会自动：
1. 将插件复制到 `~/.gemini/config/plugins/skill-explorer/`；
2. 创建独立 Python 虚拟环境 `.venv` 并安装 `requirements.txt`（`mcp>=2.0.0`、`pyyaml>=6.0`）；
3. 生成使用本机绝对路径的 `mcp_config.json`。

安装完成后 Antigravity 会自动发现插件（无需重启；若未立即生效可在 Customizations 页面刷新一下 MCP Server）。

## 重新构建前端 UI（开发用）

仅在修改 `ui/src/app.ts` 时需要：

```bash
cd ui
pnpm install   # 或 npm install
pnpm run build # 生成单文件 ui/app.html
```

## 目录结构

```text
antigravity-skill-explorer/
├── plugin.json                    # Antigravity 插件清单
├── mcp_config.json.example        # MCP 服务配置示例（安装脚本自动生成 mcp_config.json）
├── server.py                      # Python MCP App 服务端
├── requirements.txt               # Python 依赖
├── assets/logo.svg                # 插件图标
├── skills/skill-explorer/SKILL.md # 配套触发 Skill
├── ui/
│   ├── app.html                   # 预编译单文件 HTML（含 @modelcontextprotocol/ext-apps）
│   ├── src/app.ts                 # UI 源码
│   ├── build.mjs                  # esbuild 打包脚本
│   └── package.json
├── install.ps1                    # Windows 一键安装脚本
└── install.sh                     # macOS / Linux 一键安装脚本
```
