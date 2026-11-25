from __future__ import annotations

import os
import re
import shutil
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import yaml
from mcp.server.mcpserver import MCPServer
from mcp.types import CallToolResult, TextContent

PLUGIN_ROOT = Path(__file__).resolve().parent
APP_HTML_PATH = Path(os.environ.get("SKILL_EXPLORER_APP_HTML", str(PLUGIN_ROOT / "ui" / "app.html")))
APP_URI = "ui://skill-explorer/app.html"

HOME = Path.home()
GLOBAL_SKILLS_DIR = HOME / ".gemini" / "config" / "skills"
GLOBAL_PLUGINS_DIR = HOME / ".gemini" / "config" / "plugins"
BUILTIN_SKILLS_DIR = HOME / ".gemini" / "antigravity" / "builtin" / "skills"
SHARED_AGENTS_DIR = HOME / ".agents" / "skills"
DSH_SKILLS_DIR = HOME / ".dsh" / "skills"
GEMINI_CLI_SKILLS_DIR = HOME / ".gemini" / "skills"

WORKSPACE_SKILL_SUBDIRS = (
    Path(".agents") / "skills",
    Path(".agent") / "skills",
    Path("_agents") / "skills",
    Path("_agent") / "skills",
)

SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

mcp = MCPServer("skill-explorer")


def _path_to_file_uri(p: Path) -> str:
    resolved = p.resolve()
    posix = resolved.as_posix()
    if not posix.startswith("/"):
        posix = "/" + posix
    return "file://" + quote(posix, safe="/:")


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        return {}, normalized
    end_idx = normalized.find("\n---", 4)
    if end_idx == -1:
        return {}, normalized
    fm_raw = normalized[4:end_idx]
    rest = normalized[end_idx + 4 :]
    if rest.startswith("\n"):
        rest = rest[1:]
    try:
        data = yaml.safe_load(fm_raw)
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    return data, rest


def _dump_skill_md(frontmatter: dict[str, Any], body: str) -> str:
    fm_yaml = yaml.safe_dump(
        frontmatter,
        allow_unicode=True,
        sort_keys=False,
        width=100,
    ).strip()
    body_clean = body.replace("\r\n", "\n").lstrip("\n")
    return f"---\n{fm_yaml}\n---\n\n{body_clean}\n"


def _scan_dir_for_skills(
    root: Path,
    *,
    group: str,
    group_label: str,
    source_label: str,
    writable: bool,
    plugin_name: str | None = None,
    global_names: set[str] | None = None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not root.exists() or not root.is_dir():
        return items
    try:
        entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return items

    for entry in entries:
        if entry.name.startswith("."):
            continue
        if not entry.is_dir():
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.is_file():
            continue
        try:
            raw = skill_md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm, _ = _split_frontmatter(raw)
        name = str(fm.get("name") or entry.name).strip()
        description = str(fm.get("description") or "").strip()
        disabled = bool(fm.get("disable-model-invocation", False))
        is_link = entry.is_symlink() or skill_md.is_symlink()
        # On Windows, junctions aren't always flagged by is_symlink() on older checks
        try:
            is_link = is_link or os.path.isjunction(entry)  # type: ignore[attr-defined]
        except AttributeError:
            pass

        extra_files: list[str] = []
        for sub in ("scripts", "references", "examples", "resources", "docs"):
            sub_dir = entry / sub
            if sub_dir.is_dir():
                try:
                    for f in sorted(sub_dir.rglob("*")):
                        if f.is_file():
                            extra_files.append(f.relative_to(entry).as_posix())
                except OSError:
                    pass

        imported = False
        if global_names is not None:
            imported = (entry.name.lower() in global_names) or (name.lower() in global_names)

        items.append(
            {
                "id": f"{group}:{str(skill_md.resolve())}",
                "name": name,
                "folderName": entry.name,
                "description": description,
                "group": group,
                "groupLabel": group_label,
                "sourceLabel": source_label,
                "pluginName": plugin_name,
                "skillPath": str(skill_md.resolve()),
                "skillDir": str(entry.resolve()),
                "fileUri": _path_to_file_uri(skill_md),
                "writable": writable and not is_link,
                "isLink": is_link,
                "disabled": disabled,
                "importedToGlobal": imported,
                "extraFilesCount": len(extra_files),
                "hasReferences": any(f.startswith("references/") or f.startswith("docs/") for f in extra_files),
                "hasScripts": any(f.startswith("scripts/") for f in extra_files),
            }
        )
    return items


def _collect_all_skills(workspace_dir: str = "") -> dict[str, Any]:
    skills: list[dict[str, Any]] = []
    roots_info: list[dict[str, Any]] = []

    # 1. Global Antigravity skills
    global_items = _scan_dir_for_skills(
        GLOBAL_SKILLS_DIR,
        group="global",
        group_label="Antigravity 全局",
        source_label="~/.gemini/config/skills",
        writable=True,
    )
    global_names = {s["folderName"].lower() for s in global_items} | {s["name"].lower() for s in global_items}
    skills.extend(global_items)
    roots_info.append(
        {
            "group": "global",
            "label": "Antigravity 全局",
            "path": str(GLOBAL_SKILLS_DIR),
            "exists": GLOBAL_SKILLS_DIR.exists(),
            "writable": True,
            "count": len(global_items),
        }
    )

    # 2. Workspace skills (if workspace_dir given)
    ws_count = 0
    ws_resolved = ""
    if workspace_dir:
        ws_path = Path(workspace_dir).expanduser()
        if ws_path.is_dir():
            ws_resolved = str(ws_path.resolve())
            for rel in WORKSPACE_SKILL_SUBDIRS:
                cand = ws_path / rel
                ws_items = _scan_dir_for_skills(
                    cand,
                    group="workspace",
                    group_label="当前工作区",
                    source_label=str(rel.as_posix()),
                    writable=True,
                )
                ws_count += len(ws_items)
                skills.extend(ws_items)
    roots_info.append(
        {
            "group": "workspace",
            "label": "当前工作区",
            "path": ws_resolved,
            "exists": bool(ws_resolved),
            "writable": bool(ws_resolved),
            "count": ws_count,
        }
    )

    # 3. Installed plugin skills
    plugin_count = 0
    if GLOBAL_PLUGINS_DIR.is_dir():
        for pdir in sorted(GLOBAL_PLUGINS_DIR.iterdir(), key=lambda p: p.name.lower()):
            if not pdir.is_dir():
                continue
            pskills = pdir / "skills"
            p_items = _scan_dir_for_skills(
                pskills,
                group="plugin",
                group_label="已安装插件",
                source_label=f"plugin:{pdir.name}",
                writable=False,
                plugin_name=pdir.name,
            )
            plugin_count += len(p_items)
            skills.extend(p_items)
    roots_info.append(
        {
            "group": "plugin",
            "label": "已安装插件",
            "path": str(GLOBAL_PLUGINS_DIR),
            "exists": GLOBAL_PLUGINS_DIR.exists(),
            "writable": False,
            "count": plugin_count,
        }
    )

    # 4. External / shared skills (~/.agents/skills, ~/.dsh/skills, ~/.gemini/skills)
    external_seen_dirs: set[str] = set()
    external_count = 0
    for ext_root, ext_label in (
        (SHARED_AGENTS_DIR, "~/.agents/skills"),
        (DSH_SKILLS_DIR, "~/.dsh/skills"),
        (GEMINI_CLI_SKILLS_DIR, "~/.gemini/skills"),
    ):
        ext_items = _scan_dir_for_skills(
            ext_root,
            group="external",
            group_label="外部可导入 (.agents / .dsh)",
            source_label=ext_label,
            writable=False,
            global_names=global_names,
        )
        for item in ext_items:
            key = item["skillDir"].lower()
            if key in external_seen_dirs:
                continue
            external_seen_dirs.add(key)
            skills.append(item)
            external_count += 1
    roots_info.append(
        {
            "group": "external",
            "label": "外部可导入 (.agents / .dsh)",
            "path": f"{SHARED_AGENTS_DIR}; {DSH_SKILLS_DIR}",
            "exists": SHARED_AGENTS_DIR.exists() or DSH_SKILLS_DIR.exists(),
            "writable": False,
            "count": external_count,
        }
    )

    # 5. Built-in Antigravity skills
    builtin_items = _scan_dir_for_skills(
        BUILTIN_SKILLS_DIR,
        group="builtin",
        group_label="Antigravity 内置",
        source_label="builtin/skills",
        writable=False,
    )
    skills.extend(builtin_items)
    roots_info.append(
        {
            "group": "builtin",
            "label": "Antigravity 内置",
            "path": str(BUILTIN_SKILLS_DIR),
            "exists": BUILTIN_SKILLS_DIR.exists(),
            "writable": False,
            "count": len(builtin_items),
        }
    )

    return {
        "skills": skills,
        "roots": roots_info,
        "workspaceDir": ws_resolved,
        "globalSkillsDir": str(GLOBAL_SKILLS_DIR),
        "total": len(skills),
    }


def _is_under_any(target: Path, roots: list[Path]) -> bool:
    try:
        resolved = target.resolve()
    except OSError:
        return False
    for root in roots:
        try:
            r = root.resolve()
            resolved.relative_to(r)
            return True
        except Exception:
            continue
    return False


def _allowed_read_roots(workspace_dir: str = "") -> list[Path]:
    roots = [
        GLOBAL_SKILLS_DIR,
        GLOBAL_PLUGINS_DIR,
        BUILTIN_SKILLS_DIR,
        SHARED_AGENTS_DIR,
        DSH_SKILLS_DIR,
        GEMINI_CLI_SKILLS_DIR,
    ]
    if workspace_dir:
        ws = Path(workspace_dir).expanduser()
        for rel in WORKSPACE_SKILL_SUBDIRS:
            roots.append(ws / rel)
    return roots


def _allowed_write_roots(workspace_dir: str = "") -> list[Path]:
    roots = [GLOBAL_SKILLS_DIR]
    if workspace_dir:
        ws = Path(workspace_dir).expanduser()
        for rel in WORKSPACE_SKILL_SUBDIRS:
            roots.append(ws / rel)
    return roots


PANE_META = {
    "ui": {"resourceUri": APP_URI},
    "com.google.antigravity/ui": {
        "entrypoints": [
            {"type": "aux_pane", "title": "Skill Explorer"},
            {"type": "global", "title": "Skill Explorer"},
        ]
    },
}

APP_ONLY_META = {"ui": {"visibility": ["app"]}}


@mcp.resource(
    APP_URI,
    name="Skill Explorer UI",
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"prefersBorder": False}},
)
def skill_explorer_html() -> str:
    if not APP_HTML_PATH.is_file():
        return "<!doctype html><html><body><p>Skill Explorer UI bundle missing.</p></body></html>"
    return APP_HTML_PATH.read_text(encoding="utf-8")


@mcp.tool(
    name="open_skill_explorer",
    title="Skill Explorer",
    description=(
        "Open the interactive Antigravity Skill Explorer UI to browse, search, "
        "edit, import, and one-click invoke installed skills."
    ),
    meta=PANE_META,
)
def open_skill_explorer(query: str = "", workspace_dir: str = "") -> CallToolResult:
    catalog = _collect_all_skills(workspace_dir=workspace_dir)
    catalog["initialQuery"] = query or ""
    active_count = sum(1 for s in catalog["skills"] if s["group"] in ("global", "workspace", "plugin", "builtin"))
    ext_count = sum(1 for s in catalog["skills"] if s["group"] == "external" and not s["importedToGlobal"])
    summary = (
        f"Opened Skill Explorer: {active_count} active Antigravity skills "
        f"({ext_count} external skills available to import)."
    )
    return CallToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content=catalog,
    )


@mcp.tool(name="app_list_skills", meta=APP_ONLY_META)
def app_list_skills(workspace_dir: str = "") -> CallToolResult:
    catalog = _collect_all_skills(workspace_dir=workspace_dir)
    return CallToolResult(
        content=[TextContent(type="text", text=f"Loaded {catalog['total']} skills.")],
        structured_content=catalog,
    )


@mcp.tool(name="app_read_skill", meta=APP_ONLY_META)
def app_read_skill(skill_path: str, workspace_dir: str = "") -> CallToolResult:
    target = Path(skill_path)
    if target.name != "SKILL.md" or not target.is_file():
        return CallToolResult(
            content=[TextContent(type="text", text="SKILL.md not found.")],
            structured_content={"ok": False, "error": "SKILL.md 不存在"},
            is_error=True,
        )
    if not _is_under_any(target, _allowed_read_roots(workspace_dir)):
        return CallToolResult(
            content=[TextContent(type="text", text="Path outside allowed skill roots.")],
            structured_content={"ok": False, "error": "路径不在允许的 Skill 扫描范围内"},
            is_error=True,
        )
    raw = target.read_text(encoding="utf-8", errors="replace")
    fm, body = _split_frontmatter(raw)
    skill_dir = target.parent
    extra_files: list[str] = []
    for f in sorted(skill_dir.rglob("*")):
        if f.is_file() and f != target:
            extra_files.append(f.relative_to(skill_dir).as_posix())
    writable = _is_under_any(target, _allowed_write_roots(workspace_dir)) and not (
        skill_dir.is_symlink() or target.is_symlink()
    )
    payload = {
        "ok": True,
        "skillPath": str(target.resolve()),
        "skillDir": str(skill_dir.resolve()),
        "fileUri": _path_to_file_uri(target),
        "name": str(fm.get("name") or skill_dir.name),
        "description": str(fm.get("description") or ""),
        "disabled": bool(fm.get("disable-model-invocation", False)),
        "metadata": fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {},
        "body": body,
        "raw": raw,
        "writable": writable,
        "extraFiles": extra_files[:80],
    }
    return CallToolResult(
        content=[TextContent(type="text", text=f"Read {payload['name']}")],
        structured_content=payload,
    )


@mcp.tool(name="app_save_skill", meta=APP_ONLY_META)
def app_save_skill(
    skill_path: str,
    description: str,
    body: str,
    disable_model_invocation: bool = False,
    workspace_dir: str = "",
) -> CallToolResult:
    target = Path(skill_path)
    if target.name != "SKILL.md" or not target.is_file():
        return CallToolResult(
            content=[TextContent(type="text", text="SKILL.md not found.")],
            structured_content={"ok": False, "error": "SKILL.md 不存在"},
            is_error=True,
        )
    if not _is_under_any(target, _allowed_write_roots(workspace_dir)):
        return CallToolResult(
            content=[TextContent(type="text", text="Read-only skill.")],
            structured_content={"ok": False, "error": "只读 Skill（内置/插件/外部）不可直接修改"},
            is_error=True,
        )
    if len(body.encode("utf-8")) > 128 * 1024:
        return CallToolResult(
            content=[TextContent(type="text", text="Content too large.")],
            structured_content={"ok": False, "error": "SKILL.md 内容不能超过 128KB"},
            is_error=True,
        )
    raw = target.read_text(encoding="utf-8", errors="replace")
    fm, _ = _split_frontmatter(raw)
    fm["name"] = str(fm.get("name") or target.parent.name).strip()
    fm["description"] = description.strip()
    if disable_model_invocation:
        fm["disable-model-invocation"] = True
    else:
        fm.pop("disable-model-invocation", None)

    new_content = _dump_skill_md(fm, body)
    with target.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(new_content)
    return CallToolResult(
        content=[TextContent(type="text", text=f"Saved {fm['name']}")],
        structured_content={"ok": True, "skillPath": str(target.resolve()), "name": fm["name"]},
    )


@mcp.tool(name="app_toggle_skill", meta=APP_ONLY_META)
def app_toggle_skill(skill_path: str, disabled: bool, workspace_dir: str = "") -> CallToolResult:
    target = Path(skill_path)
    if target.name != "SKILL.md" or not target.is_file():
        return CallToolResult(
            content=[TextContent(type="text", text="SKILL.md not found.")],
            structured_content={"ok": False, "error": "SKILL.md 不存在"},
            is_error=True,
        )
    if not _is_under_any(target, _allowed_write_roots(workspace_dir)):
        return CallToolResult(
            content=[TextContent(type="text", text="Read-only skill.")],
            structured_content={"ok": False, "error": "只读 Skill 无法修改 frontmatter"},
            is_error=True,
        )
    raw = target.read_text(encoding="utf-8", errors="replace")
    fm, body = _split_frontmatter(raw)
    fm["name"] = str(fm.get("name") or target.parent.name).strip()
    if disabled:
        fm["disable-model-invocation"] = True
    else:
        fm.pop("disable-model-invocation", None)
    with target.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(_dump_skill_md(fm, body))
    return CallToolResult(
        content=[TextContent(type="text", text=f"Updated {fm['name']} disabled={disabled}")],
        structured_content={"ok": True, "disabled": disabled},
    )


@mcp.tool(name="app_create_skill", meta=APP_ONLY_META)
def app_create_skill(
    name: str,
    description: str,
    body: str,
    scope: str = "global",
    workspace_dir: str = "",
) -> CallToolResult:
    clean_name = name.strip().lower()
    if not SKILL_NAME_RE.match(clean_name):
        return CallToolResult(
            content=[TextContent(type="text", text="Invalid skill name.")],
            structured_content={"ok": False, "error": "名称须为小写字母/数字/连字符（如 my-skill）"},
            is_error=True,
        )
    if not description.strip():
        return CallToolResult(
            content=[TextContent(type="text", text="Description required.")],
            structured_content={"ok": False, "error": "请填写 Skill 描述（description）"},
            is_error=True,
        )
    if scope == "workspace":
        if not workspace_dir or not Path(workspace_dir).is_dir():
            return CallToolResult(
                content=[TextContent(type="text", text="Workspace directory not set.")],
                structured_content={"ok": False, "error": "请先填写有效的工作区路径再创建工作区 Skill"},
                is_error=True,
            )
        root = Path(workspace_dir).resolve() / ".agents" / "skills"
    else:
        root = GLOBAL_SKILLS_DIR

    skill_dir = root / clean_name
    if skill_dir.exists():
        return CallToolResult(
            content=[TextContent(type="text", text="Skill already exists.")],
            structured_content={"ok": False, "error": f"目录已存在：{skill_dir}"},
            is_error=True,
        )
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_md = skill_dir / "SKILL.md"
    fm = {"name": clean_name, "description": description.strip()}
    content = _dump_skill_md(fm, body or f"# {clean_name}\n\n在此编写该 Skill 的执行步骤与注意事项。")
    with skill_md.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
    return CallToolResult(
        content=[TextContent(type="text", text=f"Created {clean_name}")],
        structured_content={"ok": True, "skillPath": str(skill_md.resolve()), "name": clean_name},
    )


@mcp.tool(name="app_delete_skill", meta=APP_ONLY_META)
def app_delete_skill(skill_path: str, workspace_dir: str = "") -> CallToolResult:
    target = Path(skill_path)
    if target.name != "SKILL.md" or not target.is_file():
        return CallToolResult(
            content=[TextContent(type="text", text="SKILL.md not found.")],
            structured_content={"ok": False, "error": "SKILL.md 不存在"},
            is_error=True,
        )
    if not _is_under_any(target, _allowed_write_roots(workspace_dir)):
        return CallToolResult(
            content=[TextContent(type="text", text="Read-only skill.")],
            structured_content={"ok": False, "error": "只读 Skill 不可删除"},
            is_error=True,
        )
    skill_dir = target.parent
    trash_root = skill_dir.parent / ".trash"
    trash_root.mkdir(parents=True, exist_ok=True)
    dest = trash_root / f"{skill_dir.name}-{int(time.time())}"
    shutil.move(str(skill_dir), str(dest))
    return CallToolResult(
        content=[TextContent(type="text", text=f"Moved {skill_dir.name} to trash")],
        structured_content={"ok": True, "trashPath": str(dest)},
    )


@mcp.tool(name="app_import_skill", meta=APP_ONLY_META)
def app_import_skill(source_dir: str) -> CallToolResult:
    src = Path(source_dir)
    if not src.is_dir() or not (src / "SKILL.md").is_file():
        return CallToolResult(
            content=[TextContent(type="text", text="Source skill directory invalid.")],
            structured_content={"ok": False, "error": "源目录中未找到 SKILL.md"},
            is_error=True,
        )
    if not _is_under_any(src, [SHARED_AGENTS_DIR, DSH_SKILLS_DIR, GEMINI_CLI_SKILLS_DIR]):
        return CallToolResult(
            content=[TextContent(type="text", text="Source outside external skill roots.")],
            structured_content={"ok": False, "error": "仅允许从 ~/.agents/skills、~/.dsh/skills 或 ~/.gemini/skills 导入"},
            is_error=True,
        )
    GLOBAL_SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    dest = GLOBAL_SKILLS_DIR / src.name
    if dest.exists():
        return CallToolResult(
            content=[TextContent(type="text", text="Already exists in global skills.")],
            structured_content={"ok": False, "error": f"Antigravity 全局目录已存在同名 Skill：{src.name}"},
            is_error=True,
        )
    shutil.copytree(src, dest, symlinks=False)
    dest_skill_md = dest / "SKILL.md"
    if dest_skill_md.is_file():
        raw = dest_skill_md.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
        with dest_skill_md.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(raw)
    return CallToolResult(
        content=[TextContent(type="text", text=f"Imported {src.name} to Antigravity global skills")],
        structured_content={"ok": True, "skillPath": str((dest / "SKILL.md").resolve()), "name": src.name},
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
