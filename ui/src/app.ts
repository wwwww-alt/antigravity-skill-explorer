import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

interface SkillSummary {
  id: string;
  name: string;
  folderName: string;
  description: string;
  group: 'global' | 'workspace' | 'plugin' | 'external' | 'builtin';
  groupLabel: string;
  sourceLabel: string;
  pluginName: string | null;
  skillPath: string;
  skillDir: string;
  fileUri: string;
  writable: boolean;
  isLink: boolean;
  disabled: boolean;
  importedToGlobal: boolean;
  extraFilesCount: number;
  hasReferences: boolean;
  hasScripts: boolean;
}

interface RootInfo {
  group: string;
  label: string;
  path: string;
  exists: boolean;
  writable: boolean;
  count: number;
}

interface CatalogPayload {
  skills: SkillSummary[];
  roots: RootInfo[];
  workspaceDir: string;
  globalSkillsDir: string;
  total: number;
  initialQuery?: string;
}

interface SkillDetail {
  ok: boolean;
  skillPath: string;
  skillDir: string;
  fileUri: string;
  name: string;
  description: string;
  disabled: boolean;
  metadata: Record<string, unknown>;
  body: string;
  raw: string;
  writable: boolean;
  extraFiles: string[];
  error?: string;
}

const GROUP_ORDER: Array<SkillSummary['group']> = [
  'global',
  'workspace',
  'plugin',
  'external',
  'builtin',
];

const state = {
  skills: [] as SkillSummary[],
  roots: [] as RootInfo[],
  workspaceDir: '',
  globalSkillsDir: '',
  query: '',
  activeFilter: 'all' as 'all' | SkillSummary['group'],
  collapsedGroups: new Set<string>(['builtin']),
  selectedId: null as string | null,
  detail: null as SkillDetail | null,
  loadingList: true,
  loadingDetail: false,
  mode: 'view' as 'view' | 'edit' | 'create',
  invokePrompt: '',
  canMessage: false,
  canUpdateContext: false,
  canCallTools: true,
  attachedSkillName: '' as string,
  toast: '' as string,
  toastTimer: 0 as number,
  busyAction: false,
  showWorkspaceBar: false,
};

const app = new App({ name: 'Skill Explorer', version: '1.0.0' }, {});

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg: string) {
  state.toast = msg;
  const el = document.getElementById('toast');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    state.toast = '';
    const t = document.getElementById('toast');
    if (t) t.classList.remove('show');
  }, 2600);
}

function getSelectedSummary(): SkillSummary | undefined {
  return state.skills.find((s) => s.id === state.selectedId);
}

function getFilteredSkills(): SkillSummary[] {
  const q = state.query.trim().toLowerCase();
  return state.skills
    .filter((s) => {
      if (state.activeFilter !== 'all' && s.group !== state.activeFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.sourceLabel.toLowerCase().includes(q) ||
        (s.pluginName || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (q) {
        const aName = a.name.toLowerCase().includes(q) ? 0 : 1;
        const bName = b.name.toLowerCase().includes(q) ? 0 : 1;
        if (aName !== bName) return aName - bName;
      }
      return a.name.localeCompare(b.name);
    });
}

function applyCatalog(payload: CatalogPayload | undefined) {
  if (!payload || !Array.isArray(payload.skills)) return;
  state.skills = payload.skills;
  state.roots = payload.roots || [];
  state.workspaceDir = payload.workspaceDir || state.workspaceDir;
  state.globalSkillsDir = payload.globalSkillsDir || state.globalSkillsDir;
  if (typeof payload.initialQuery === 'string' && payload.initialQuery && !state.query) {
    state.query = payload.initialQuery;
  }
  state.loadingList = false;
  if (state.selectedId && !state.skills.some((s) => s.id === state.selectedId)) {
    state.selectedId = null;
    state.detail = null;
  }
  render();
}

async function refreshList(workspaceDirOverride?: string) {
  if (!state.canCallTools) return;
  state.loadingList = true;
  render();
  try {
    const ws = workspaceDirOverride !== undefined ? workspaceDirOverride : state.workspaceDir;
    const res = await app.callServerTool({
      name: 'app_list_skills',
      arguments: { workspace_dir: ws },
    });
    applyCatalog(res.structuredContent as unknown as CatalogPayload);
  } catch (err: any) {
    state.loadingList = false;
    showToast(`刷新失败：${err?.message || err}`);
    render();
  }
}

async function selectSkill(skill: SkillSummary) {
  state.selectedId = skill.id;
  state.mode = 'view';
  state.invokePrompt = '';
  state.loadingDetail = true;
  state.detail = null;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_read_skill',
      arguments: {
        skill_path: skill.skillPath,
        workspace_dir: state.workspaceDir,
      },
    });
    const detail = res.structuredContent as unknown as SkillDetail;
    if (detail && detail.ok) {
      state.detail = detail;
    } else {
      showToast(detail?.error || '读取 SKILL.md 失败');
    }
  } catch (err: any) {
    showToast(`读取失败：${err?.message || err}`);
  } finally {
    state.loadingDetail = false;
    render();
  }
}

async function invokeSkill(skill: SkillSummary, customTask = '') {
  const taskText = customTask.trim();
  const promptText = taskText
    ? `请使用 ${skill.name} skill 帮我完成以下任务：\n${taskText}`
    : `请激活并使用 ${skill.name} skill（路径：${skill.skillPath}），简要说明它能做什么并询问我需要处理的具体任务。`;

  if (state.canMessage) {
    try {
      await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: promptText }],
      });
      showToast(`已向当前对话发送 ${skill.name} 调用指令`);
      return;
    } catch (err: any) {
      showToast(`发送失败，改为复制：${err?.message || ''}`);
    }
  }

  try {
    await navigator.clipboard.writeText(promptText);
    showToast(`已复制 ${skill.name} 调用指令到剪贴板`);
  } catch {
    showToast(`请手动复制：请使用 ${skill.name} skill`);
  }
}

async function attachSkillContext(skill: SkillSummary) {
  if (!state.canUpdateContext) {
    showToast('当前视图不支持附加到消息（请在侧栏面板中使用）');
    return;
  }
  try {
    const res = await app.callServerTool({
      name: 'app_read_skill',
      arguments: {
        skill_path: skill.skillPath,
        workspace_dir: state.workspaceDir,
      },
    });
    const detail = res.structuredContent as unknown as SkillDetail;
    const contextText =
      detail && detail.ok
        ? `User selected skill "${detail.name}" (${detail.skillPath}) from Skill Explorer. Follow its instructions for the next user message:\n\n${detail.raw.slice(0, 12000)}`
        : `User selected skill "${skill.name}" (${skill.skillPath}) from Skill Explorer. Read its SKILL.md and use it for the next user message.`;
    await app.updateModelContext({
      content: [{ type: 'text', text: contextText }],
    });
    state.attachedSkillName = skill.name;
    showToast(`已将 ${skill.name} 附加到你的下一条消息`);
    render();
  } catch (err: any) {
    showToast(`附加失败：${err?.message || err}`);
  }
}

async function clearAttachedContext() {
  if (!state.canUpdateContext) return;
  try {
    await app.updateModelContext({ content: [] });
    state.attachedSkillName = '';
    showToast('已取消附加 Skill 上下文');
    render();
  } catch {
    // ignore
  }
}

async function openInAntigravityFileView(fileUri: string) {
  try {
    const res = await app.request(
      {
        method: 'com.google.antigravity/toggle-aux-pane',
        params: { tabType: 'fileView', uri: fileUri },
      },
      z.object({ isError: z.boolean().optional() }).passthrough(),
    );
    if (res?.isError) {
      showToast('当前视图不支持打开侧栏文件标签');
    }
  } catch {
    showToast('当前视图不支持直接打开文件标签');
  }
}

async function importExternalSkill(skill: SkillSummary) {
  if (state.busyAction) return;
  state.busyAction = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_import_skill',
      arguments: { source_dir: skill.skillDir },
    });
    const out = res.structuredContent as { ok?: boolean; error?: string; name?: string };
    if (out?.ok) {
      showToast(`已导入 ${out.name} 到 Antigravity 全局 Skills（下轮生效）`);
      await refreshList();
    } else {
      showToast(out?.error || '导入失败');
    }
  } catch (err: any) {
    showToast(`导入失败：${err?.message || err}`);
  } finally {
    state.busyAction = false;
    render();
  }
}

async function toggleSkillDisabled(skill: SkillSummary) {
  if (!skill.writable || state.busyAction) return;
  state.busyAction = true;
  try {
    const res = await app.callServerTool({
      name: 'app_toggle_skill',
      arguments: {
        skill_path: skill.skillPath,
        disabled: !skill.disabled,
        workspace_dir: state.workspaceDir,
      },
    });
    const out = res.structuredContent as { ok?: boolean; error?: string; disabled?: boolean };
    if (out?.ok) {
      showToast(out.disabled ? `已停用 ${skill.name} 的自动调用` : `已启用 ${skill.name}`);
      await refreshList();
      if (state.selectedId === skill.id) {
        const updated = state.skills.find((s) => s.id === skill.id);
        if (updated) await selectSkill(updated);
      }
    } else {
      showToast(out?.error || '切换失败');
    }
  } catch (err: any) {
    showToast(`切换失败：${err?.message || err}`);
  } finally {
    state.busyAction = false;
    render();
  }
}

async function saveEditedSkill() {
  if (!state.detail || state.busyAction) return;
  const descEl = document.getElementById('edit-desc') as HTMLTextAreaElement | null;
  const bodyEl = document.getElementById('edit-body') as HTMLTextAreaElement | null;
  const disEl = document.getElementById('edit-disabled') as HTMLInputElement | null;
  if (!descEl || !bodyEl) return;

  state.busyAction = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_save_skill',
      arguments: {
        skill_path: state.detail.skillPath,
        description: descEl.value,
        body: bodyEl.value,
        disable_model_invocation: Boolean(disEl?.checked),
        workspace_dir: state.workspaceDir,
      },
    });
    const out = res.structuredContent as { ok?: boolean; error?: string };
    if (out?.ok) {
      showToast('SKILL.md 已保存');
      state.mode = 'view';
      await refreshList();
      const updated = getSelectedSummary();
      if (updated) await selectSkill(updated);
    } else {
      showToast(out?.error || '保存失败');
    }
  } catch (err: any) {
    showToast(`保存失败：${err?.message || err}`);
  } finally {
    state.busyAction = false;
    render();
  }
}

async function createNewSkill() {
  if (state.busyAction) return;
  const nameEl = document.getElementById('create-name') as HTMLInputElement | null;
  const scopeEl = document.getElementById('create-scope') as HTMLSelectElement | null;
  const descEl = document.getElementById('create-desc') as HTMLTextAreaElement | null;
  const bodyEl = document.getElementById('create-body') as HTMLTextAreaElement | null;
  if (!nameEl || !descEl || !bodyEl) return;

  state.busyAction = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_create_skill',
      arguments: {
        name: nameEl.value,
        scope: scopeEl?.value || 'global',
        description: descEl.value,
        body: bodyEl.value,
        workspace_dir: state.workspaceDir,
      },
    });
    const out = res.structuredContent as { ok?: boolean; error?: string; name?: string; skillPath?: string };
    if (out?.ok) {
      showToast(`已创建 Skill：${out.name}`);
      state.mode = 'view';
      await refreshList();
      const created = state.skills.find((s) => s.skillPath === out.skillPath);
      if (created) await selectSkill(created);
    } else {
      showToast(out?.error || '创建失败');
    }
  } catch (err: any) {
    showToast(`创建失败：${err?.message || err}`);
  } finally {
    state.busyAction = false;
    render();
  }
}

async function deleteSelectedSkill() {
  const summary = getSelectedSummary();
  if (!summary || !summary.writable || state.busyAction) return;
  state.busyAction = true;
  render();
  try {
    const res = await app.callServerTool({
      name: 'app_delete_skill',
      arguments: {
        skill_path: summary.skillPath,
        workspace_dir: state.workspaceDir,
      },
    });
    const out = res.structuredContent as { ok?: boolean; error?: string };
    if (out?.ok) {
      showToast(`已将 ${summary.name} 移入 .trash 回收站`);
      state.selectedId = null;
      state.detail = null;
      state.mode = 'view';
      await refreshList();
    } else {
      showToast(out?.error || '删除失败');
    }
  } catch (err: any) {
    showToast(`删除失败：${err?.message || err}`);
  } finally {
    state.busyAction = false;
    render();
  }
}

function badgeClass(group: SkillSummary['group']): string {
  switch (group) {
    case 'global':
      return 'badge-global';
    case 'workspace':
      return 'badge-workspace';
    case 'plugin':
      return 'badge-plugin';
    case 'external':
      return 'badge-external';
    default:
      return 'badge-builtin';
  }
}

function renderListPane(): string {
  const filtered = getFilteredSkills();
  const counts: Record<string, number> = { all: state.skills.length };
  for (const g of GROUP_ORDER) {
    counts[g] = state.skills.filter((s) => s.group === g).length;
  }

  const filterButtons: Array<{ key: 'all' | SkillSummary['group']; label: string }> = [
    { key: 'all', label: `全部 ${counts.all}` },
    { key: 'global', label: `全局 ${counts.global}` },
    ...(counts.workspace > 0 ? [{ key: 'workspace' as const, label: `工作区 ${counts.workspace}` }] : []),
    { key: 'plugin', label: `插件 ${counts.plugin}` },
    { key: 'external', label: `外部可导入 ${counts.external}` },
    { key: 'builtin', label: `内置 ${counts.builtin}` },
  ];

  const groupedHtml = GROUP_ORDER.map((group) => {
    const rows = filtered.filter((s) => s.group === group);
    if (rows.length === 0) return '';
    const isCollapsed = !state.query && state.activeFilter === 'all' && state.collapsedGroups.has(group);
    const label = rows[0].groupLabel;

    return `
      <section class="group-section">
        <button class="group-header" data-action="toggle-group" data-group="${group}">
          <span class="chevron">${isCollapsed ? '▸' : '▾'}</span>
          <span class="group-title">${esc(label)}</span>
          <span class="group-count">${rows.length}</span>
        </button>
        ${
          isCollapsed
            ? ''
            : `<div class="skill-list">
                ${rows
                  .map((s) => {
                    const selected = s.id === state.selectedId ? 'selected' : '';
                    const isExternalNew = s.group === 'external' && !s.importedToGlobal;
                    return `
                      <div class="skill-card ${selected} ${s.disabled ? 'is-disabled' : ''}" data-action="select" data-id="${esc(s.id)}">
                        <div class="card-top">
                          <div class="card-title-wrap">
                            <span class="skill-name">${esc(s.name)}</span>
                            <span class="badge ${badgeClass(s.group)}">${esc(s.sourceLabel)}</span>
                            ${s.isLink ? '<span class="badge badge-muted">链接</span>' : ''}
                            ${s.disabled ? '<span class="badge badge-warn">已停用</span>' : ''}
                            ${s.group === 'external' && s.importedToGlobal ? '<span class="badge badge-ok">已在全局</span>' : ''}
                          </div>
                          <div class="card-actions" data-stop="1">
                            ${
                              isExternalNew
                                ? `<button class="btn btn-xs btn-secondary" data-action="import" data-id="${esc(s.id)}" title="导入到 ~/.gemini/config/skills">⬇ 导入</button>`
                                : ''
                            }
                            ${
                              state.canUpdateContext
                                ? `<button class="btn btn-xs btn-ghost" data-action="attach" data-id="${esc(s.id)}" title="附加到下条消息">📎</button>`
                                : ''
                            }
                            <button class="btn btn-xs btn-primary" data-action="quick-invoke" data-id="${esc(s.id)}" title="${state.canMessage ? '在当前对话调用此 Skill' : '复制调用指令'}">▶ 调用</button>
                          </div>
                        </div>
                        <p class="card-desc">${esc(s.description || '暂无描述')}</p>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </section>
    `;
  }).join('');

  return `
    <div class="pane-list">
      <div class="toolbar">
        <div class="search-row">
          <input id="search-input" class="search-input" type="search" placeholder="搜索 Skill 名称、描述或来源… (Esc 清空)" value="${esc(state.query)}" />
          <button class="btn btn-sm btn-ghost" data-action="toggle-ws" title="设置工作区目录以扫描项目 Skill">📁</button>
          <button class="btn btn-sm btn-ghost" data-action="refresh" title="重新扫描">↻</button>
          <button class="btn btn-sm btn-primary" data-action="open-create">+ 新建</button>
        </div>
        ${
          state.showWorkspaceBar
            ? `<div class="ws-row">
                <input id="ws-input" class="ws-input" type="text" placeholder="工作区绝对路径（例如 D:\\3）" value="${esc(state.workspaceDir)}" />
                <button class="btn btn-xs btn-secondary" data-action="apply-ws">扫描工作区</button>
              </div>`
            : ''
        }
        <div class="filter-chips">
          ${filterButtons
            .map(
              (f) =>
                `<button class="chip ${state.activeFilter === f.key ? 'active' : ''}" data-action="filter" data-filter="${f.key}">${esc(f.label)}</button>`,
            )
            .join('')}
        </div>
        ${
          state.attachedSkillName
            ? `<div class="attached-banner">
                <span>📎 已附加 <strong>${esc(state.attachedSkillName)}</strong> 到下条消息</span>
                <button class="btn btn-xs btn-ghost" data-action="clear-attach">取消</button>
              </div>`
            : ''
        }
      </div>
      <div class="list-scroll">
        ${
          state.loadingList
            ? '<div class="empty-state">正在扫描本地 Skills…</div>'
            : filtered.length === 0
              ? '<div class="empty-state">没有匹配的 Skill，试试清空搜索词或切换来源筛选。</div>'
              : groupedHtml
        }
      </div>
    </div>
  `;
}

function renderDetailPane(): string {
  if (state.mode === 'create') {
    return `
      <div class="pane-detail active">
        <div class="detail-header">
          <button class="btn btn-xs btn-ghost mobile-back" data-action="close-detail">← 返回</button>
          <h2>新建 Skill</h2>
          <button class="btn btn-xs btn-ghost" data-action="cancel-mode">取消</button>
        </div>
        <div class="detail-scroll form-wrap">
          <label class="field">
            <span>名称（小写英文 + 连字符，如 <code>my-workflow</code>）</span>
            <input id="create-name" class="input" type="text" placeholder="my-skill" />
          </label>
          <label class="field">
            <span>保存位置</span>
            <select id="create-scope" class="input">
              <option value="global">Antigravity 全局 (~/.gemini/config/skills)</option>
              <option value="workspace" ${state.workspaceDir ? '' : 'disabled'}>当前工作区 (.agents/skills)${state.workspaceDir ? '' : ' — 请先点击 📁 设置工作区'}</option>
            </select>
          </label>
          <label class="field">
            <span>描述（description — Agent 依靠它判断何时自动触发）</span>
            <textarea id="create-desc" class="textarea" rows="3" placeholder="说明这个 Skill 的用途与触发时机…"></textarea>
          </label>
          <label class="field">
            <span>正文指令（Markdown）</span>
            <textarea id="create-body" class="textarea code" rows="12" placeholder="# My Skill\n\n## 步骤\n1. ..."></textarea>
          </label>
          <div class="form-actions">
            <button class="btn btn-primary" data-action="submit-create" ${state.busyAction ? 'disabled' : ''}>创建 SKILL.md</button>
            <button class="btn btn-ghost" data-action="cancel-mode">取消</button>
          </div>
        </div>
      </div>
    `;
  }

  const summary = getSelectedSummary();
  if (!summary) {
    return `
      <div class="pane-detail">
        <div class="empty-detail">
          <div class="empty-icon">✦</div>
          <h3>选择一个 Skill 查看详情或调用</h3>
          <p>点击任意卡片上的 <strong>▶ 调用</strong> 可${state.canMessage ? '直接向当前对话发送调用指令' : '复制调用指令'}；也可以点击 <strong>+ 新建</strong> 创建自定义 Skill，或把 <code>~/.agents/skills</code>、<code>~/.dsh/skills</code> 的 Skill 一键导入到 Antigravity。</p>
        </div>
      </div>
    `;
  }

  if (state.loadingDetail || !state.detail) {
    return `
      <div class="pane-detail active">
        <div class="detail-header">
          <button class="btn btn-xs btn-ghost mobile-back" data-action="close-detail">← 返回</button>
          <h2>${esc(summary.name)}</h2>
        </div>
        <div class="empty-state">正在读取 SKILL.md…</div>
      </div>
    `;
  }

  const d = state.detail;

  if (state.mode === 'edit') {
    return `
      <div class="pane-detail active">
        <div class="detail-header">
          <button class="btn btn-xs btn-ghost mobile-back" data-action="close-detail">← 返回</button>
          <h2>编辑：${esc(d.name)}</h2>
          <button class="btn btn-xs btn-ghost" data-action="cancel-mode">取消</button>
        </div>
        <div class="detail-scroll form-wrap">
          <label class="field">
            <span>描述（description）</span>
            <textarea id="edit-desc" class="textarea" rows="4">${esc(d.description)}</textarea>
          </label>
          <label class="checkbox-row">
            <input id="edit-disabled" type="checkbox" ${d.disabled ? 'checked' : ''} />
            <span>停用模型自动调用（写入 <code>disable-model-invocation: true</code>）</span>
          </label>
          <label class="field">
            <span>正文（SKILL.md）</span>
            <textarea id="edit-body" class="textarea code" rows="16">${esc(d.body)}</textarea>
          </label>
          <div class="form-actions">
            <button class="btn btn-primary" data-action="submit-edit" ${state.busyAction ? 'disabled' : ''}>保存修改</button>
            <button class="btn btn-ghost" data-action="cancel-mode">取消</button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="pane-detail active">
      <div class="detail-header">
        <button class="btn btn-xs btn-ghost mobile-back" data-action="close-detail">← 返回</button>
        <div class="detail-title-group">
          <h2>${esc(d.name)}</h2>
          <span class="badge ${badgeClass(summary.group)}">${esc(summary.sourceLabel)}</span>
          ${d.writable ? '<span class="badge badge-ok">可编辑</span>' : '<span class="badge badge-muted">只读</span>'}
        </div>
        <div class="detail-header-actions">
          <button class="btn btn-xs btn-ghost" data-action="open-file" title="在 Antigravity 侧栏打开 SKILL.md">打开源文件</button>
          ${
            d.writable
              ? `
                <button class="btn btn-xs btn-ghost" data-action="toggle-disable">${d.disabled ? '启用' : '停用'}</button>
                <button class="btn btn-xs btn-secondary" data-action="start-edit">编辑</button>
                <button class="btn btn-xs btn-danger" data-action="delete-skill">删除</button>
              `
              : summary.group === 'external' && !summary.importedToGlobal
                ? `<button class="btn btn-xs btn-secondary" data-action="import-selected">⬇ 导入到 Antigravity</button>`
                : ''
          }
        </div>
      </div>

      <div class="detail-scroll">
        <div class="invoke-box">
          <div class="invoke-box-title">⚡ 快捷调用 ${esc(d.name)}</div>
          <div class="invoke-row">
            <input id="invoke-input" class="input" type="text" placeholder="可选：输入要交给此 Skill 处理的具体任务（留空则直接激活并查看用法）…" value="${esc(state.invokePrompt)}" />
            <button class="btn btn-primary" data-action="invoke-with-prompt">${state.canMessage ? '▶ 发送调用' : '📋 复制指令'}</button>
            ${
              state.canUpdateContext
                ? `<button class="btn btn-secondary" data-action="attach-selected" title="把 SKILL.md 作为上下文附加到下一条消息">📎 附加</button>`
                : ''
            }
          </div>
        </div>

        <div class="meta-card">
          <div class="meta-label">描述</div>
          <div class="meta-desc">${esc(d.description || '无描述')}</div>
          <div class="meta-path" title="${esc(d.skillPath)}"><code>${esc(d.skillPath)}</code></div>
          ${
            d.extraFiles.length > 0
              ? `<div class="extra-files">
                  <span class="meta-label">附属文件 (${d.extraFiles.length})</span>
                  <div class="file-tags">${d.extraFiles.slice(0, 12).map((f) => `<span class="file-tag">${esc(f)}</span>`).join('')}${d.extraFiles.length > 12 ? `<span class="file-tag">+${d.extraFiles.length - 12}</span>` : ''}</div>
                </div>`
              : ''
          }
        </div>

        <div class="body-card">
          <div class="meta-label">SKILL.md 指令内容</div>
          <pre class="md-pre">${esc(d.body.trim())}</pre>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;

  const activeEl = document.activeElement as HTMLInputElement | null;
  const focusId = activeEl?.id || '';
  const selStart = activeEl && 'selectionStart' in activeEl ? activeEl.selectionStart : null;
  const selEnd = activeEl && 'selectionEnd' in activeEl ? activeEl.selectionEnd : null;

  const hasDetailOpen = Boolean(state.selectedId || state.mode === 'create');
  root.className = `shell ${hasDetailOpen ? 'detail-open' : ''}`;
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-dot"></span>
        <h1>Skill Explorer</h1>
        <span class="brand-sub">${state.skills.length} 个 Skill</span>
      </div>
      <div class="cap-hint">
        ${
          state.canMessage
            ? '<span class="cap-pill ok">● 已连接对话（支持一键调用）</span>'
            : '<span class="cap-pill">全页模式（支持复制指令 / 管理）</span>'
        }
      </div>
    </header>
    <main class="workspace">
      ${renderListPane()}
      ${renderDetailPane()}
    </main>
    <div id="toast" class="toast ${state.toast ? 'show' : ''}">${esc(state.toast)}</div>
  `;

  if (focusId) {
    const next = document.getElementById(focusId) as HTMLInputElement | null;
    if (next) {
      next.focus();
      if (selStart !== null && selEnd !== null && typeof next.setSelectionRange === 'function') {
        try {
          next.setSelectionRange(selStart, selEnd);
        } catch {
          // ignore
        }
      }
    }
  }
}

document.addEventListener('input', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'search-input') {
    state.query = (target as HTMLInputElement).value;
    render();
  } else if (target.id === 'invoke-input') {
    state.invokePrompt = (target as HTMLInputElement).value;
  }
});

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (e.key === 'Escape' && target.id === 'search-input') {
    state.query = '';
    render();
  } else if (e.key === 'Enter' && target.id === 'invoke-input') {
    const s = getSelectedSummary();
    if (s) void invokeSkill(s, state.invokePrompt);
  } else if (e.key === 'Enter' && target.id === 'ws-input') {
    const ws = (target as HTMLInputElement).value.trim();
    void refreshList(ws);
  }
});

document.addEventListener('click', (e) => {
  const rawTarget = e.target as HTMLElement;
  const actionEl = rawTarget.closest('[data-action]') as HTMLElement | null;
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;

  if (actionEl.closest('[data-stop="1"]') && action !== 'select') {
    e.stopPropagation();
  }

  switch (action) {
    case 'toggle-group': {
      const g = actionEl.dataset.group;
      if (g) {
        if (state.collapsedGroups.has(g)) state.collapsedGroups.delete(g);
        else state.collapsedGroups.add(g);
        render();
      }
      break;
    }
    case 'filter': {
      const f = (actionEl.dataset.filter || 'all') as 'all' | SkillSummary['group'];
      state.activeFilter = f;
      render();
      break;
    }
    case 'refresh':
      void refreshList();
      break;
    case 'toggle-ws':
      state.showWorkspaceBar = !state.showWorkspaceBar;
      render();
      break;
    case 'apply-ws': {
      const wsInput = document.getElementById('ws-input') as HTMLInputElement | null;
      void refreshList(wsInput?.value.trim() || '');
      break;
    }
    case 'select': {
      const skill = state.skills.find((s) => s.id === id);
      if (skill) void selectSkill(skill);
      break;
    }
    case 'quick-invoke': {
      const skill = state.skills.find((s) => s.id === id);
      if (skill) void invokeSkill(skill);
      break;
    }
    case 'attach': {
      const skill = state.skills.find((s) => s.id === id);
      if (skill) void attachSkillContext(skill);
      break;
    }
    case 'attach-selected': {
      const skill = getSelectedSummary();
      if (skill) void attachSkillContext(skill);
      break;
    }
    case 'clear-attach':
      void clearAttachedContext();
      break;
    case 'import': {
      const skill = state.skills.find((s) => s.id === id);
      if (skill) void importExternalSkill(skill);
      break;
    }
    case 'import-selected': {
      const skill = getSelectedSummary();
      if (skill) void importExternalSkill(skill);
      break;
    }
    case 'invoke-with-prompt': {
      const skill = getSelectedSummary();
      if (skill) void invokeSkill(skill, state.invokePrompt);
      break;
    }
    case 'open-file': {
      if (state.detail?.fileUri) void openInAntigravityFileView(state.detail.fileUri);
      break;
    }
    case 'open-create':
      state.mode = 'create';
      render();
      break;
    case 'start-edit':
      state.mode = 'edit';
      render();
      break;
    case 'cancel-mode':
      state.mode = 'view';
      render();
      break;
    case 'close-detail':
      state.selectedId = null;
      state.detail = null;
      state.mode = 'view';
      render();
      break;
    case 'submit-edit':
      void saveEditedSkill();
      break;
    case 'submit-create':
      void createNewSkill();
      break;
    case 'toggle-disable': {
      const skill = getSelectedSummary();
      if (skill) void toggleSkillDisabled(skill);
      break;
    }
    case 'delete-skill':
      void deleteSelectedSkill();
      break;
  }
});

// Register MCP App handlers BEFORE connect()
app.ontoolinput = ({ arguments: args }) => {
  if (args && typeof args === 'object') {
    const q = (args as Record<string, unknown>).query;
    const ws = (args as Record<string, unknown>).workspace_dir;
    if (typeof q === 'string') state.query = q;
    if (typeof ws === 'string') state.workspaceDir = ws;
  }
  state.loadingList = true;
  render();
};

app.ontoolresult = (result) => {
  applyCatalog(result.structuredContent as unknown as CatalogPayload);
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

async function init() {
  render();
  try {
    await app.connect();
    const ctx = app.getHostContext();
    if (ctx?.theme) applyDocumentTheme(ctx.theme);
    if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);

    const caps = app.getHostCapabilities() as Record<string, unknown> | undefined;
    state.canMessage = Boolean(caps?.message);
    state.canUpdateContext = Boolean(caps?.updateModelContext);
    state.canCallTools = caps?.serverTools !== false;
    render();

    // Fallback fetch if toolresult hasn't arrived yet
    window.setTimeout(() => {
      if (state.loadingList && state.skills.length === 0) {
        void refreshList();
      }
    }, 350);
  } catch (err: any) {
    state.loadingList = false;
    showToast(`MCP App 连接失败：${err?.message || err}`);
    render();
  }
}

void init();
