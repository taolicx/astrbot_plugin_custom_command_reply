const bridge = window.AstrBotPluginPage;
const byId = (id) => document.getElementById(id);

const elements = {
  add: byId("add-button"),
  emptyAdd: byId("empty-add-button"),
  refresh: byId("refresh-button"),
  search: byId("search-input"),
  count: byId("rule-count"),
  list: byId("rule-list"),
  loading: byId("loading-state"),
  empty: byId("empty-state"),
  noResults: byId("no-results"),
  notice: byId("notice"),
  overview: byId("overview-panel"),
  editor: byId("editor-panel"),
  editorTitle: byId("editor-title"),
  closeEditor: byId("close-editor"),
  form: byId("rule-form"),
  command: byId("command-input"),
  reply: byId("reply-input"),
  replyCount: byId("reply-count"),
  enabled: byId("enabled-input"),
  formError: byId("form-error"),
  save: byId("save-button"),
  cancel: byId("cancel-button"),
  example: byId("example-command"),
  prefixNote: byId("prefix-note"),
};

const state = {
  rules: [],
  revision: "",
  prefix: "/",
  loading: true,
  loadError: false,
  busy: false,
  editIndex: null,
  confirmIndex: null,
  originalForm: null,
};

function notify(message, kind = "success") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`;
  elements.notice.hidden = !message;
  elements.notice.setAttribute("role", kind === "error" ? "alert" : "status");
}

function formSnapshot() {
  return {
    command: elements.command.value,
    reply: elements.reply.value,
    enabled: elements.enabled.checked,
  };
}

function hasUnsavedForm() {
  if (elements.editor.hidden || !state.originalForm) return false;
  const current = formSnapshot();
  return Object.keys(current).some((key) => current[key] !== state.originalForm[key]);
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = !message;
}

function updateBusy() {
  elements.add.disabled = state.busy || state.loading || state.loadError;
  elements.emptyAdd.disabled = state.busy || state.loading || state.loadError;
  elements.refresh.disabled = state.busy || state.loading;
  elements.save.disabled = state.busy;
  elements.save.textContent = state.busy ? "保存中…" : "保存指令";
  elements.cancel.disabled = state.busy;
  elements.closeEditor.disabled = state.busy;
}

function makeButton(label, className, onClick, accessibleLabel = label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.setAttribute("aria-label", accessibleLabel);
  button.disabled = state.busy;
  button.addEventListener("click", onClick);
  return button;
}

function renderList() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const matches = state.rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      `${rule.command ?? ""}\n${rule.reply ?? ""}`.toLocaleLowerCase().includes(query),
    );

  elements.count.textContent = state.loading ? "正在加载…" : `${state.rules.length} 条规则`;
  elements.loading.hidden = !state.loading;
  elements.empty.hidden = state.loading || state.loadError || state.rules.length > 0;
  elements.noResults.textContent = state.loadError
    ? "暂时无法读取规则，请点击刷新重试。"
    : "没有找到匹配的规则。试试其他关键词。";
  elements.noResults.hidden = state.loading ||
    (state.loadError ? state.rules.length > 0 : !query || matches.length > 0 || state.rules.length === 0);
  elements.list.hidden = state.loading || state.rules.length === 0;
  elements.list.replaceChildren();

  for (const { rule, index } of matches) {
    const item = document.createElement("li");
    item.className = `rule-item${rule.enabled === false ? " is-disabled" : ""}`;

    const main = document.createElement("div");
    main.className = "rule-main";
    const identity = document.createElement("div");
    identity.className = "rule-identity";
    const command = document.createElement("code");
    command.className = "command-name";
    command.textContent = `${state.prefix}${String(rule.command ?? "")}`;
    identity.append(command);

    const status = document.createElement("span");
    status.className = `state-chip${rule.enabled === false ? " off" : ""}`;
    status.textContent = rule.enabled === false ? "已停用" : "已启用";
    identity.append(status);

    const preview = document.createElement("p");
    preview.className = "rule-preview";
    preview.textContent = String(rule.reply ?? "");
    identity.append(preview);
    main.append(identity);

    const actions = document.createElement("div");
    actions.className = "rule-actions";
    actions.append(
      makeButton("编辑", "button-plain", () => openEditor(index), `编辑 ${rule.command}`),
      makeButton(
        rule.enabled === false ? "启用" : "停用",
        "button-plain",
        () => toggleRule(index),
        `${rule.enabled === false ? "启用" : "停用"} ${rule.command}`,
      ),
      makeButton("删除", "button-plain button-danger", () => beginDelete(index), `删除 ${rule.command}`),
    );
    main.append(actions);
    item.append(main);

    if (state.confirmIndex === index) {
      const confirmation = document.createElement("div");
      confirmation.className = "delete-confirm";
      const prompt = document.createElement("span");
      prompt.textContent = `确定删除“${rule.command}”？`;
      const cancel = makeButton("取消", "button-subtle", () => {
        state.confirmIndex = null;
        renderList();
      });
      const confirm = makeButton("确认删除", "button-confirm", () => deleteRule(index));
      confirmation.append(prompt, cancel, confirm);
      item.append(confirmation);
    }
    elements.list.append(item);
  }
}

function openEditor(index = null) {
  if (state.busy || state.loading) return;
  if (hasUnsavedForm()) {
    notify("当前内容尚未保存。请先保存或取消编辑。", "error");
    return;
  }
  state.editIndex = index;
  state.confirmIndex = null;
  const rule = index === null ? { command: "", reply: "", enabled: true } : state.rules[index];
  elements.editorTitle.textContent = index === null ? "新增指令" : "编辑指令";
  elements.command.value = String(rule.command ?? "");
  elements.reply.value = String(rule.reply ?? "");
  elements.enabled.checked = rule.enabled !== false;
  elements.replyCount.textContent = `${elements.reply.value.length} / 10000`;
  state.originalForm = formSnapshot();
  showFormError("");
  notify("");
  elements.overview.hidden = true;
  elements.editor.hidden = false;
  renderList();
  elements.command.focus();
  if (window.matchMedia("(max-width: 900px)").matches) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    elements.editor.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
  }
}

function closeEditor() {
  if (state.busy) return;
  state.editIndex = null;
  state.originalForm = null;
  showFormError("");
  elements.editor.hidden = true;
  elements.overview.hidden = false;
}

async function loadRules() {
  if (state.busy) return;
  state.loading = true;
  updateBusy();
  renderList();
  try {
    const data = await bridge.apiGet("rules");
    if (!data || !Array.isArray(data.rules) || typeof data.revision !== "string") {
      throw new Error("服务器返回的规则格式不正确。");
    }
    state.rules = data.rules;
    state.revision = data.revision;
    state.prefix = typeof data.prefix === "string" ? data.prefix : "/";
    state.loadError = false;
    elements.example.textContent = `${state.prefix}帮助`;
    elements.prefixNote.textContent = state.prefix
      ? `当前示例前缀为“${state.prefix}”。只匹配完整指令，实际前缀以会话设置为准。`
      : "当前未设置指令前缀，请先在 AstrBot 中配置唤醒前缀。";
    notify("");
  } catch (error) {
    state.loadError = true;
    notify(`读取规则失败：${error.message || error}`, "error");
  } finally {
    state.loading = false;
    updateBusy();
    renderList();
  }
}

async function persist(nextRules, successMessage) {
  if (state.busy) return false;
  state.busy = true;
  updateBusy();
  renderList();
  try {
    const data = await bridge.apiPost("rules", {
      rules: nextRules,
      revision: state.revision,
    });
    if (!data || !Array.isArray(data.rules) || typeof data.revision !== "string") {
      throw new Error("服务器返回的保存结果不正确。");
    }
    state.rules = data.rules;
    state.revision = data.revision;
    if (typeof data.prefix === "string") state.prefix = data.prefix;
    notify(successMessage);
    return true;
  } catch (error) {
    notify(`保存失败：${error.message || error}`, "error");
    return false;
  } finally {
    state.busy = false;
    updateBusy();
    renderList();
  }
}

function validateForm() {
  const command = elements.command.value.trim();
  const reply = elements.reply.value;
  if (!command) return "请输入指令名称。";
  if (command.length > 80 || /[\x00-\x1f]/.test(command)) return "指令名称不能超过 80 字，且不能换行。";
  if (command.startsWith("/") || (state.prefix && command.startsWith(state.prefix))) {
    return "指令名称不要包含前缀。";
  }
  if (state.rules.some((rule, index) => index !== state.editIndex && rule.command === command)) {
    return "已有同名指令，请换一个名称。";
  }
  if (!reply.trim()) return "请输入回复文字。";
  if (reply.length > 10000) return "回复文字不能超过 10000 字。";
  return "";
}

async function submitForm(event) {
  event.preventDefault();
  if (state.busy) return;
  const error = validateForm();
  showFormError(error);
  if (error) return;

  const nextRules = state.rules.map((rule) => ({ ...rule }));
  const rule = {
    command: elements.command.value.trim(),
    reply: elements.reply.value,
    enabled: elements.enabled.checked,
  };
  if (state.editIndex === null) nextRules.push(rule);
  else nextRules[state.editIndex] = rule;

  const saved = await persist(nextRules, state.editIndex === null ? "指令已新增。" : "指令已更新。");
  if (saved) closeEditor();
}

async function toggleRule(index) {
  if (state.busy) return;
  if (hasUnsavedForm()) {
    notify("当前内容尚未保存。请先保存或取消编辑。", "error");
    return;
  }
  const nextRules = state.rules.map((rule) => ({ ...rule }));
  const nextEnabled = nextRules[index].enabled === false;
  nextRules[index].enabled = nextEnabled;
  await persist(nextRules, nextEnabled ? "指令已启用。" : "指令已停用。");
}

function beginDelete(index) {
  if (state.busy) return;
  if (hasUnsavedForm()) {
    notify("当前内容尚未保存。请先保存或取消编辑。", "error");
    return;
  }
  state.confirmIndex = index;
  renderList();
  const confirm = elements.list.querySelector(".delete-confirm .button-confirm");
  confirm?.focus();
}

async function deleteRule(index) {
  if (state.busy) return;
  const nextRules = state.rules.filter((_, currentIndex) => currentIndex !== index);
  const saved = await persist(nextRules, "指令已删除。");
  if (saved) {
    state.confirmIndex = null;
    if (state.editIndex === index) closeEditor();
    else if (state.editIndex !== null && state.editIndex > index) state.editIndex -= 1;
    renderList();
  }
}

elements.add.addEventListener("click", () => openEditor());
elements.emptyAdd.addEventListener("click", () => openEditor());
elements.closeEditor.addEventListener("click", closeEditor);
elements.cancel.addEventListener("click", closeEditor);
elements.form.addEventListener("submit", submitForm);
elements.search.addEventListener("input", renderList);
elements.reply.addEventListener("input", () => {
  elements.replyCount.textContent = `${elements.reply.value.length} / 10000`;
});
elements.refresh.addEventListener("click", () => {
  if (hasUnsavedForm()) {
    notify("当前内容尚未保存。请先保存或取消编辑。", "error");
    return;
  }
  closeEditor();
  loadRules();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.editor.hidden) closeEditor();
});

async function start() {
  if (!bridge || typeof bridge.ready !== "function") {
    state.loading = false;
    state.loadError = true;
    updateBusy();
    renderList();
    notify("请从 AstrBot 的插件页面打开此管理界面。", "error");
    return;
  }
  try {
    await bridge.ready();
    await loadRules();
  } catch (error) {
    state.loading = false;
    state.loadError = true;
    updateBusy();
    renderList();
    notify(`页面初始化失败：${error.message || error}`, "error");
  }
}

start();
