(() => {
  'use strict';

  // ---------- State ----------
  // Chats live on the server now (/api/sessions/*, scoped to the logged-in
  // account); localStorage is only used for settings/theme and as the
  // one-time migration source for chats created before that switch.
  const MIGRATION_SOURCE_KEY = 'ollama-chat:chats';
  const MIGRATION_DONE_KEY = 'ollama-chat:chats:migrated';
  const SETTINGS_KEY = 'ollama-chat:settings';
  const THEME_KEY = 'ollama-chat:theme';

  let chats = []; // session summaries from GET /api/sessions
  let activeChatId = null;
  let activeSession = null; // the open chat's full session (with messages)
  let settings = loadSettings();
  let models = [];
  let abortController = null;
  let sidebarCollapsed = false;
  let pullController = null;
  let pendingAttachments = []; // [{ name, content, size }] staged for the next message
  let currentTheme = 'light';

  // ---------- Icons ----------
  // Small inline-SVG icon set (one stroke weight, one style) used anywhere
  // this file builds DOM nodes directly, so dynamically-created UI never
  // falls back to emoji glyphs. See style.css `svg.icon` for sizing.
  const ICONS = {
    brand:
      '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>',
    user:
      '<svg class="icon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    close:
      '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning:
      '<svg class="icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>',
  };

  // ---------- Attachments ----------
  // Constants and the pure helpers below live in chat-helpers.js (loaded
  // before this script) so the test suite can exercise them without a DOM.
  const {
    ATTACHMENT_MAX_COUNT,
    formatBytes,
    attachmentError,
    buildOllamaMessages,
    estimateChatTokens,
    formatTokens,
    normalizeSettings,
    chatToMarkdown,
    chatToJson,
    exportFilename,
  } = window.ChatHelpers;

  // ---------- Elements ----------
  const el = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    chatList: document.getElementById('chatList'),
    newChatBtn: document.getElementById('newChatBtn'),
    searchInput: document.getElementById('searchInput'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    settingsBtn: document.getElementById('settingsBtn'),
    usernameLabel: document.getElementById('usernameLabel'),
    logoutBtn: document.getElementById('logoutBtn'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeToggleIcon: document.getElementById('themeToggleIcon'),
    themeToggleLabel: document.getElementById('themeToggleLabel'),
    themeToggleBtnTopbar: document.getElementById('themeToggleBtnTopbar'),
    themeToggleIconTopbar: document.getElementById('themeToggleIconTopbar'),
    modelSelect: document.getElementById('modelSelect'),
    refreshModelsBtn: document.getElementById('refreshModelsBtn'),
    chatTitle: document.getElementById('chatTitle'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    exportBtn: document.getElementById('exportBtn'),
    exportMenu: document.getElementById('exportMenu'),
    exportMarkdownBtn: document.getElementById('exportMarkdownBtn'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    messages: document.getElementById('messages'),
    emptyState: document.getElementById('emptyState'),
    emptyModelHint: document.getElementById('emptyModelHint'),
    composer: document.getElementById('composer'),
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    ollamaHostDisplay: document.getElementById('ollamaHostDisplay'),
    systemPrompt: document.getElementById('systemPrompt'),
    temperature: document.getElementById('temperature'),
    tempValue: document.getElementById('tempValue'),
    topP: document.getElementById('topP'),
    topPValue: document.getElementById('topPValue'),
    numCtx: document.getElementById('numCtx'),
    useMemory: document.getElementById('useMemory'),
    deleteAllBtn: document.getElementById('deleteAllBtn'),
    installedModelsList: document.getElementById('installedModelsList'),
    pullModelInput: document.getElementById('pullModelInput'),
    pullModelBtn: document.getElementById('pullModelBtn'),
    pullProgress: document.getElementById('pullProgress'),
    pullProgressFill: document.getElementById('pullProgressFill'),
    pullProgressText: document.getElementById('pullProgressText'),
    fileInput: document.getElementById('fileInput'),
    attachBtn: document.getElementById('attachBtn'),
    pendingAttachments: document.getElementById('pendingAttachments'),
    contextMeter: document.getElementById('contextMeter'),
    contextMeterFill: document.getElementById('contextMeterFill'),
    contextMeterText: document.getElementById('contextMeterText'),
    compactionNote: document.getElementById('compactionNote'),
    migrationBanner: document.getElementById('migrationBanner'),
    migrationText: document.getElementById('migrationText'),
    migrationImportBtn: document.getElementById('migrationImportBtn'),
    migrationDismissBtn: document.getElementById('migrationDismissBtn'),
  };

  // ---------- Persistence (server sessions) ----------
  async function apiRequest(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function refreshChatList() {
    const data = await apiRequest('/api/sessions');
    chats = data.sessions || [];
  }

  function fetchSession(id) {
    return apiRequest(`/api/sessions/${encodeURIComponent(id)}`);
  }

  function patchSession(id, body) {
    return apiRequest(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // Keeps the in-memory summary list ordered like the server's
  // listSessions() (newest-updated first) after a successful write.
  function bumpSummary(id, patch) {
    const summary = chats.find((c) => c.id === id);
    if (summary) {
      Object.assign(summary, patch, { updatedAt: new Date().toISOString() });
      chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : null);
    } catch {
      return normalizeSettings(null);
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ---------- Theme ----------
  function loadTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // localStorage unavailable (privacy mode etc.) — fall through to
      // the matchMedia default below.
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const sunIcon = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    const moonIcon = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
    const icon = theme === 'dark' ? sunIcon : moonIcon;
    if (el.themeToggleIcon) el.themeToggleIcon.innerHTML = icon;
    if (el.themeToggleIconTopbar) el.themeToggleIconTopbar.innerHTML = icon;
    if (el.themeToggleLabel) el.themeToggleLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    if (el.themeToggleBtn) el.themeToggleBtn.setAttribute('aria-pressed', String(theme === 'dark'));
    if (el.themeToggleBtnTopbar) {
      el.themeToggleBtnTopbar.setAttribute('aria-pressed', String(theme === 'dark'));
      el.themeToggleBtnTopbar.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }
  }

  function setTheme(theme) {
    currentTheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  }

  function toggleTheme() {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  // ---------- Migration from pre-session localStorage chats ----------
  // Chats used to live in localStorage under MIGRATION_SOURCE_KEY. On the
  // first load after the server-session switch, if the account has no
  // server-side sessions but legacy chats exist in this browser, offer a
  // one-time import. Dismissing without importing leaves the localStorage
  // data untouched, so the prompt simply returns on the next load.

  function loadLegacyLocalChats() {
    try {
      const raw = localStorage.getItem(MIGRATION_SOURCE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function hasMigratedLegacyChats() {
    try {
      return localStorage.getItem(MIGRATION_DONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  async function maybeOfferMigration() {
    if (hasMigratedLegacyChats() || chats.length) return;
    const legacy = loadLegacyLocalChats();
    if (!legacy.length) return;
    el.migrationText.textContent =
      `${legacy.length} chat${legacy.length === 1 ? '' : 's'} from this browser predate server storage. ` +
      'Import them into your account? Nothing is deleted either way.';
    el.migrationBanner.classList.remove('hidden');
  }

  async function importLegacyChats() {
    const legacy = loadLegacyLocalChats();
    el.migrationImportBtn.disabled = true;
    el.migrationImportBtn.textContent = 'Importing…';
    let imported = 0;
    try {
      for (const chat of legacy) {
        const title = typeof chat.title === 'string' && chat.title.trim()
          ? chat.title.trim().slice(0, 200)
          : undefined;
        const session = await apiRequest('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(title ? { title } : {}),
        });
        const messages = Array.isArray(chat.messages)
          ? chat.messages.filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string')
          : [];
        if (messages.length) {
          await patchSession(session.id, { appendMessages: messages });
        }
        imported += 1;
      }
      try {
        localStorage.setItem(MIGRATION_DONE_KEY, '1');
      } catch {
        // Flag couldn't be persisted (quota/private mode) — the banner may
        // re-offer next load; imported chats on the server are the source
        // of truth from here on, so that only wastes a prompt, not data.
      }
      el.migrationBanner.classList.add('hidden');
      await refreshChatList();
      if (chats.length) {
        await selectChat(chats[0].id);
      } else {
        renderChatList();
        renderMessages();
        updateTitle();
      }
    } catch (err) {
      el.migrationImportBtn.disabled = false;
      el.migrationImportBtn.textContent = 'Import';
      showError(`Import failed after ${imported} of ${legacy.length} chats: ${err.message}`);
    }
  }

  el.migrationImportBtn.addEventListener('click', importLegacyChats);
  el.migrationDismissBtn.addEventListener('click', () => {
    // Deliberately does not set MIGRATION_DONE_KEY: skipping now re-offers
    // on the next load, and the localStorage chats are left untouched.
    el.migrationBanner.classList.add('hidden');
  });

  // ---------- Chat helpers ----------
  async function createChat() {
    try {
      const session = await apiRequest('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      chats.unshift({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
      activeChatId = session.id;
      activeSession = session;
      renderChatList();
      renderMessages();
      updateTitle();
      return session;
    } catch (err) {
      showError(err.message);
      return null;
    }
  }

  async function deleteChat(id, evt) {
    if (evt) evt.stopPropagation();
    try {
      await apiRequest(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      showError(err.message);
      return;
    }
    chats = chats.filter((c) => c.id !== id);
    if (activeChatId === id) {
      if (chats.length) {
        await selectChat(chats[0].id);
      } else {
        activeChatId = null;
        activeSession = null;
        renderChatList();
        renderMessages();
        updateTitle();
      }
    } else {
      renderChatList();
    }
  }

  async function selectChat(id) {
    try {
      const session = await fetchSession(id);
      activeChatId = id;
      activeSession = session;
      renderChatList();
      renderMessages();
      updateTitle();
      const preferred = preferredModelFor(session);
      if (preferred && models.some((m) => m.name === preferred)) {
        el.modelSelect.value = preferred;
      }
    } catch (err) {
      showError(err.message);
    }
  }

  // The model used for a chat isn't a server-side session field — it lives
  // on the assistant messages that carried it. Derive from the most recent
  // one, falling back to the last-used global model.
  function preferredModelFor(session) {
    if (session && Array.isArray(session.messages)) {
      for (let i = session.messages.length - 1; i >= 0; i -= 1) {
        if (session.messages[i].model) return session.messages[i].model;
      }
    }
    return settings.lastModel || '';
  }

  async function updateTitleFromFirstMessage(chat, text) {
    if (chat.title !== 'New chat') return;
    const title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
    try {
      await patchSession(chat.id, { title });
      chat.title = title;
      bumpSummary(chat.id, { title });
      renderChatList();
      updateTitle();
    } catch (err) {
      showError(err.message);
    }
  }

  function updateTitle() {
    el.chatTitle.textContent = activeSession ? activeSession.title : 'New chat';
  }

  // ---------- Rendering ----------
  function renderChatList() {
    el.chatList.innerHTML = '';
    if (!chats.length) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:var(--text-faint);font-size:12.5px;padding:10px;';
      hint.textContent = 'No chats yet.';
      el.chatList.appendChild(hint);
      return;
    }
    for (const chat of chats) {
      const item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
      item.onclick = () => selectChat(chat.id);

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = chat.title;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.innerHTML = ICONS.close;
      del.title = 'Delete chat';
      del.setAttribute('aria-label', `Delete chat "${chat.title}"`);
      del.onclick = (e) => deleteChat(chat.id, e);

      item.appendChild(title);
      item.appendChild(del);
      el.chatList.appendChild(item);
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Minimal, dependency-free markdown: fenced code blocks, inline code,
  // bold/italic, and paragraph breaks.
  function renderMarkdown(text) {
    const blocks = [];
    let working = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = blocks.length;
      blocks.push({ lang, code });
      return `\u0000CODE${idx}\u0000`;
    });

    working = escapeHtml(working);

    working = working
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

    const paragraphs = working.split(/\n{2,}/).map((p) => {
      // NUL (\u0000) is used as a placeholder for code blocks after HTML
      // escaping — it can never appear in the escaped text itself.
      // eslint-disable-next-line no-control-regex
      if (/^\u0000CODE\d+\u0000$/.test(p.trim())) return p.trim();
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    });
    working = paragraphs.join('\n');

    // eslint-disable-next-line no-control-regex -- see note above.
    working = working.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => {
      const { lang, code } = blocks[Number(idx)];
      const escaped = escapeHtml(code).replace(/\n$/, '');
      return `<div class="pre-wrap"><pre><code data-lang="${escapeHtml(lang)}">${escaped}</code></pre><button class="copy-btn" type="button">Copy</button></div>`;
    });

    return working;
  }

  function renderMessages() {
    el.messages.innerHTML = '';
    const chat = activeSession;

    if (!chat || !chat.messages.length) {
      el.messages.appendChild(el.emptyState);
      el.emptyState.classList.remove('hidden');
      refreshEmptyHint();
      updateContextMeter();
      return;
    }

    el.emptyState.classList.add('hidden');

    chat.messages.forEach((msg, index) => {
      el.messages.appendChild(buildMessageRow(msg, index));
    });
    updateContextMeter();
    scrollToBottom();
  }

  function refreshEmptyHint() {
    if (models.length) {
      el.emptyModelHint.textContent = `${models.length} model${models.length === 1 ? '' : 's'} available locally.`;
    } else {
      el.emptyModelHint.textContent = 'No local models found — pull one with "ollama pull <model>".';
    }
  }

  function buildMessageRow(msg, index) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (msg.role === 'user' ? 'user' : 'assistant');

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = msg.role === 'user' ? ICONS.user : ICONS.brand;
    avatar.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'msg-body';

    const role = document.createElement('div');
    role.className = 'msg-role';
    role.textContent = msg.role === 'user' ? 'You' : (msg.model || 'Assistant');

    const content = document.createElement('div');
    content.className = 'msg-content';
    if (msg.role === 'assistant' && !msg.content) {
      content.innerHTML = '<span class="typing-dots" role="status" aria-label="Assistant is typing"><span></span><span></span><span></span></span>';
    } else {
      content.innerHTML = renderMarkdown(msg.content || '');
    }

    body.appendChild(role);
    body.appendChild(content);

    if (msg.attachments && msg.attachments.length) {
      const attachmentsRow = document.createElement('div');
      attachmentsRow.className = 'msg-attachments';
      for (const att of msg.attachments) {
        attachmentsRow.appendChild(buildAttachmentChip(att, { removable: false }));
      }
      body.appendChild(attachmentsRow);
    }

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    if (msg.role === 'assistant' && msg.content) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = () => navigator.clipboard.writeText(msg.content);
      actions.appendChild(copyBtn);
    }

    // Regenerate is offered on the last assistant turn only: the history is
    // linear (no branching — see PLAN.md C1), so regenerating anything
    // earlier would silently discard every turn after it.
    const isLastMessage = activeSession && index === activeSession.messages.length - 1;
    if (msg.role === 'assistant' && msg.content && isLastMessage) {
      const regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.textContent = 'Regenerate';
      regenBtn.onclick = () => regenerateMessage(index);
      actions.appendChild(regenBtn);
    }

    if (msg.role === 'user') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => startEditingMessage(index, row);
      actions.appendChild(editBtn);
    }

    if (actions.childElementCount) body.appendChild(actions);

    row.appendChild(avatar);
    row.appendChild(body);
    return row;
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  // ---------- Regenerate / edit (linear history) ----------
  // Both actions truncate the history at a point and re-stream from there,
  // persisting the truncation as a full `messages` replace. There is no
  // branching: everything after the edited/regenerated turn is discarded,
  // which is what PLAN.md C1 scopes.

  async function replaceMessages(chat, messages) {
    try {
      const updated = await patchSession(chat.id, { messages });
      chat.messages = updated.messages;
      bumpSummary(chat.id, {});
      return true;
    } catch (err) {
      showError(`Couldn't update this chat: ${err.message}`);
      return false;
    }
  }

  async function regenerateMessage(index) {
    if (abortController) return;
    const chat = activeSession;
    if (!chat) return;
    // Reuse the model that produced the reply, so regenerating doesn't
    // silently switch models when the picker has moved on since.
    const model = chat.messages[index].model || el.modelSelect.value;
    if (!model) {
      showError('Select a model first. If none are listed, pull one with "ollama pull <model>".');
      return;
    }
    if (!(await replaceMessages(chat, chat.messages.slice(0, index)))) return;
    renderChatList();
    renderMessages();
    await streamAssistantReply(chat, model);
  }

  function startEditingMessage(index, row) {
    if (abortController) return;
    const chat = activeSession;
    if (!chat) return;
    const msg = chat.messages[index];
    const contentEl = row.querySelector('.msg-content');
    const actionsEl = row.querySelector('.msg-actions');
    if (!contentEl || row.querySelector('.msg-edit')) return;

    const editor = document.createElement('div');
    editor.className = 'msg-edit';

    const textarea = document.createElement('textarea');
    textarea.rows = Math.min(12, (msg.content.match(/\n/g) || []).length + 2);
    textarea.value = msg.content;
    textarea.setAttribute('aria-label', 'Edit your message');

    const editActions = document.createElement('div');
    editActions.className = 'msg-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save & resend';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => renderMessages();

    saveBtn.onclick = () => submitEditedMessage(index, textarea.value);

    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);
    editor.appendChild(textarea);
    editor.appendChild(editActions);

    contentEl.classList.add('hidden');
    if (actionsEl) actionsEl.classList.add('hidden');
    contentEl.after(editor);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  async function submitEditedMessage(index, text) {
    const chat = activeSession;
    if (!chat) return;
    const trimmed = text.trim();
    if (!trimmed) {
      showError('An edited message cannot be empty.');
      return;
    }
    const model = el.modelSelect.value || preferredModelFor(chat);
    if (!model) {
      showError('Select a model first. If none are listed, pull one with "ollama pull <model>".');
      return;
    }
    // Attachments stay with the message they were sent on — an edit changes
    // the text, not the files that were attached to it.
    const edited = { ...chat.messages[index], content: trimmed };
    const kept = [...chat.messages.slice(0, index), edited];
    if (!(await replaceMessages(chat, kept))) return;
    renderChatList();
    renderMessages();
    await streamAssistantReply(chat, model);
  }

  el.messages.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy-btn')) {
      const code = e.target.previousElementSibling?.querySelector('code');
      if (code) {
        navigator.clipboard.writeText(code.textContent);
        e.target.textContent = 'Copied!';
        setTimeout(() => (e.target.textContent = 'Copy'), 1200);
      }
    }
  });

  // ---------- Models ----------
  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load models');

      models = data.models || [];
      el.modelSelect.innerHTML = '';

      if (!models.length) {
        const opt = document.createElement('option');
        opt.textContent = 'No models installed';
        opt.disabled = true;
        opt.selected = true;
        el.modelSelect.appendChild(opt);
      } else {
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.textContent = m.name;
          el.modelSelect.appendChild(opt);
        }
        const preferred = preferredModelFor(activeSession) || settings.lastModel;
        if (preferred && models.some((m) => m.name === preferred)) {
          el.modelSelect.value = preferred;
        }
      }
      setStatus(true);
    } catch (err) {
      setStatus(false, err.message);
    }
    refreshEmptyHint();
    renderInstalledModels();
  }

  function setStatus(ok, message) {
    el.statusDot.className = 'status-dot ' + (ok ? 'ok' : 'bad');
    el.statusText.textContent = ok ? 'Ollama connected' : (message || 'Ollama unreachable');
  }

  // ---------- Current user ----------
  async function loadCurrentUser() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (!data || !data.user) {
        window.location.replace('/login.html');
        return;
      }
      if (el.usernameLabel) el.usernameLabel.textContent = data.user.username;
    } catch {
      // If we can't reach the server at all, let the rest of init() surface
      // that via the Ollama status indicator instead of bouncing to login.
    }
  }

  // formatBytes lives in chat-helpers.js (shared with the tests).

  // ---------- Model management (settings) ----------
  function renderInstalledModels() {
    if (!el.installedModelsList) return;
    el.installedModelsList.innerHTML = '';
    if (!models.length) {
      const empty = document.createElement('div');
      empty.className = 'model-manage-empty';
      empty.textContent = 'No models installed yet.';
      el.installedModelsList.appendChild(empty);
      return;
    }
    for (const m of models) {
      const item = document.createElement('div');
      item.className = 'model-manage-item';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.name;

      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatBytes(m.size);

      const del = document.createElement('button');
      del.className = 'del-model';
      del.type = 'button';
      del.textContent = 'Delete';
      del.title = `Delete ${m.name}`;
      del.setAttribute('aria-label', `Delete ${m.name}`);
      del.onclick = () => deleteModel(m.name);

      item.appendChild(name);
      item.appendChild(size);
      item.appendChild(del);
      el.installedModelsList.appendChild(item);
    }
  }

  async function deleteModel(name) {
    if (!confirm(`Delete model "${name}"? This removes it from disk.`)) return;
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to delete "${name}".`);
      await loadModels();
    } catch (err) {
      alert(err.message);
    }
  }

  async function pullModel() {
    const name = el.pullModelInput.value.trim();
    if (!name) return;

    el.pullModelBtn.disabled = true;
    el.pullProgress.classList.remove('hidden');
    el.pullProgressFill.style.width = '0%';
    el.pullProgressText.textContent = `Starting pull of "${name}"…`;

    pullController = new AbortController();

    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: pullController.signal,
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to pull "${name}".`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let json;
          try {
            json = JSON.parse(line);
          } catch {
            continue;
          }
          if (json.error) throw new Error(json.error);
          if (json.total && json.completed != null) {
            const pct = Math.round((json.completed / json.total) * 100);
            el.pullProgressFill.style.width = pct + '%';
            el.pullProgressText.textContent = `${json.status || 'Pulling'} — ${pct}%`;
          } else if (json.status) {
            el.pullProgressText.textContent = json.status;
          }
        }
      }

      el.pullProgressFill.style.width = '100%';
      el.pullProgressText.textContent = `Done — "${name}" is ready.`;
      el.pullModelInput.value = '';
      await loadModels();
    } catch (err) {
      if (err.name === 'AbortError') {
        el.pullProgressText.textContent = 'Pull cancelled.';
      } else {
        el.pullProgressText.textContent = `Error: ${err.message}`;
      }
    } finally {
      el.pullModelBtn.disabled = false;
      pullController = null;
      setTimeout(() => el.pullProgress.classList.add('hidden'), 2500);
    }
  }

  el.pullModelBtn?.addEventListener('click', pullModel);
  el.pullModelInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pullModel();
    }
  });

  // ---------- File attachments ----------
  // getExtension lives in chat-helpers.js, folded into attachmentError.

  function buildAttachmentChip(att, { removable }) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = att.name;
    name.title = att.name;

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = formatBytes(att.size);

    chip.appendChild(name);
    chip.appendChild(size);

    if (removable) {
      const remove = document.createElement('span');
      remove.className = 'remove';
      remove.innerHTML = ICONS.close;
      remove.title = 'Remove attachment';
      remove.setAttribute('role', 'button');
      remove.setAttribute('tabindex', '0');
      remove.setAttribute('aria-label', `Remove attachment "${att.name}"`);
      remove.onclick = () => removePendingAttachment(att);
      remove.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          removePendingAttachment(att);
        }
      };
      chip.appendChild(remove);
    }

    return chip;
  }

  function renderPendingAttachments() {
    el.pendingAttachments.innerHTML = '';
    for (const att of pendingAttachments) {
      el.pendingAttachments.appendChild(buildAttachmentChip(att, { removable: true }));
    }
  }

  function removePendingAttachment(att) {
    pendingAttachments = pendingAttachments.filter((a) => a !== att);
    renderPendingAttachments();
  }

  async function handleFileSelect(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const attachmentProblem = attachmentError(file.name, file.size, pendingAttachments.length);
      if (attachmentProblem) {
        showError(attachmentProblem);
        // The per-message count is the one condition that makes every
        // remaining file unacceptable too; type/size failures only skip
        // their own file.
        if (pendingAttachments.length >= ATTACHMENT_MAX_COUNT) break;
        continue;
      }
      try {
        const content = await file.text();
        pendingAttachments.push({ name: file.name, content, size: file.size });
      } catch (err) {
        showError(`Failed to read "${file.name}": ${err.message}`);
      }
    }
    renderPendingAttachments();
  }

  el.attachBtn?.addEventListener('click', () => el.fileInput.click());
  el.fileInput?.addEventListener('change', () => {
    handleFileSelect(el.fileInput.files);
    el.fileInput.value = '';
  });

  // ---------- Sending messages ----------
  function autoResizeTextarea() {
    el.promptInput.style.height = 'auto';
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + 'px';
  }

  el.promptInput.addEventListener('input', autoResizeTextarea);
  el.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });

  el.composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el.promptInput.value.trim();
    if (!text) return;

    const model = el.modelSelect.value;
    if (!model) {
      showError('Select a model first. If none are listed, pull one with "ollama pull <model>".');
      return;
    }

    let chat = activeSession;
    if (!chat) {
      chat = await createChat();
      if (!chat) return;
    }
    settings.lastModel = model;
    saveSettings();

    await updateTitleFromFirstMessage(chat, text);
    const userMsg = { role: 'user', content: text };
    if (pendingAttachments.length) {
      userMsg.attachments = pendingAttachments.map((a) => ({ name: a.name, content: a.content, size: a.size }));
    }

    // Persist the user message before streaming. If the write fails, the
    // message still goes out — chat stays usable, it just won't survive a
    // reload until a later successful write.
    try {
      const updated = await patchSession(chat.id, { appendMessages: [userMsg] });
      chat.messages = updated.messages;
      bumpSummary(chat.id, {});
    } catch (err) {
      showError(`Couldn't save this message: ${err.message}`);
      chat.messages.push(userMsg);
    }
    pendingAttachments = [];
    renderPendingAttachments();
    renderChatList();
    renderMessages();
    updateTitle();

    el.promptInput.value = '';
    autoResizeTextarea();

    await streamAssistantReply(chat, model);
  });

  async function streamAssistantReply(chat, model) {
    const ollamaMessages = buildOllamaMessages(settings.systemPrompt, chat.messages);

    const assistantMsg = { role: 'assistant', content: '', model };
    chat.messages.push(assistantMsg);
    renderMessages();
    markLastRowStreaming(true);
    setSending(true);

    abortController = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          options: {
            temperature: settings.temperature,
            top_p: settings.topP,
            num_ctx: settings.numCtx,
          },
          useMemory: settings.useMemory === true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      // Set by /api/chat when compactMessages() actually folded older
      // turns into a summary for this request.
      if (res.headers.get('X-Compacted') === 'true') {
        compactedChats.add(chat.id);
        updateContextMeter();
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let json;
          try {
            json = JSON.parse(line);
          } catch {
            continue;
          }
          if (json.error) throw new Error(json.error);
          if (json.message && typeof json.message.content === 'string') {
            assistantMsg.content += json.message.content;
            queueLastMessageContent(assistantMsg.content);
          }
          if (json.done) {
            // stream finished
          }
        }
      }

      // The throttled renderer may still be holding the last chunk or two.
      flushLastMessageContent();
      await persistAssistantMessage(chat, assistantMsg);
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content += assistantMsg.content ? '\n\n_[stopped]_' : '_[stopped]_';
        pendingRenderText = null;
        updateLastMessageContent(assistantMsg.content);
        await persistAssistantMessage(chat, assistantMsg);
      } else {
        showError(err.message);
        pendingRenderText = null;
        if (!assistantMsg.content) {
          chat.messages.pop();
          renderMessages();
        } else {
          flushLastMessageContent();
          await persistAssistantMessage(chat, assistantMsg);
        }
      }
    } finally {
      flushLastMessageContent();
      setSending(false);
      markLastRowStreaming(false);
      abortController = null;
      renderChatList();
    }
  }

  async function persistAssistantMessage(chat, assistantMsg) {
    try {
      const updated = await patchSession(chat.id, { appendMessages: [assistantMsg] });
      chat.messages = updated.messages;
      bumpSummary(chat.id, {});
    } catch (err) {
      showError(`Couldn't save the reply: ${err.message}`);
    }
  }

  function updateLastMessageContent(text) {
    const rows = el.messages.querySelectorAll('.msg-row');
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return;
    const contentEl = lastRow.querySelector('.msg-content');
    if (contentEl) contentEl.innerHTML = renderMarkdown(text);
    scrollToBottom();
  }

  // Ollama emits one ndjson chunk per token, and renderMarkdown() re-parses
  // the whole accumulated reply each time it runs — so rendering on every
  // chunk is O(n²) in reply length and visibly janks on long answers.
  // Coalesce those writes onto a trailing timer instead: at most one DOM
  // write per RENDER_INTERVAL_MS, always with the latest text, and always
  // flushed before the stream's final state is persisted or re-rendered.
  const RENDER_INTERVAL_MS = 60;
  let pendingRenderText = null;
  let renderTimer = null;
  let lastRenderAt = 0;

  function queueLastMessageContent(text) {
    pendingRenderText = text;
    if (renderTimer !== null) return;
    const wait = Math.max(0, RENDER_INTERVAL_MS - (Date.now() - lastRenderAt));
    renderTimer = setTimeout(() => {
      renderTimer = null;
      flushLastMessageContent();
    }, wait);
  }

  function flushLastMessageContent() {
    if (renderTimer !== null) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (pendingRenderText === null) return;
    const text = pendingRenderText;
    pendingRenderText = null;
    lastRenderAt = Date.now();
    updateLastMessageContent(text);
  }

  function markLastRowStreaming(on) {
    const rows = el.messages.querySelectorAll('.msg-row');
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return;
    lastRow.classList.toggle('streaming', on);
  }

  function setSending(isSending) {
    el.sendBtn.classList.toggle('hidden', isSending);
    el.stopBtn.classList.toggle('hidden', !isSending);
    el.promptInput.disabled = isSending;
  }

  el.stopBtn.addEventListener('click', () => {
    if (abortController) abortController.abort();
  });

  function showError(message) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.setAttribute('role', 'alert');
    const icon = document.createElement('span');
    icon.className = 'error-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ICONS.warning;
    const text = document.createElement('span');
    text.textContent = message;
    banner.appendChild(icon);
    banner.appendChild(text);
    el.messages.appendChild(banner);
    scrollToBottom();
  }

  // ---------- Context window meter ----------
  // Mirrors compaction.js's CHARS_PER_TOKEN heuristic — the constant itself
  // lives in chat-helpers.js, which the context meter shares with the test
  // suite.

  // Chats whose last /api/chat response came back with X-Compacted: true.
  // Not persisted: compaction is a property of a request, not of the saved
  // history, so the note is scoped to this browsing session.
  const compactedChats = new Set();

  function updateContextMeter() {
    if (!el.contextMeter) return;
    const chat = activeSession;
    if (!chat || !chat.messages.length) {
      el.contextMeter.classList.add('hidden');
      return;
    }
    const tokens = estimateChatTokens(settings.systemPrompt, chat.messages);
    const limit = settings.numCtx || 4096;
    const ratio = Math.min(1, tokens / limit);
    el.contextMeter.classList.remove('hidden');
    el.contextMeterFill.style.width = `${Math.round(ratio * 100)}%`;
    el.contextMeter.classList.toggle('near-limit', ratio >= 0.8);
    el.contextMeterText.textContent = `~${formatTokens(tokens)} / ${formatTokens(limit)} tokens`;
    el.contextMeter.title =
      `Rough estimate (about 4 characters per token) of this chat against the ${limit}-token context window.`;
    el.compactionNote.classList.toggle('hidden', !compactedChats.has(chat.id));
  }

  // ---------- Export ----------
  // Frontend-only, no dependency: build the text in memory and hand it to
  // the browser as a Blob download. Markdown reuses the same
  // "[Attached file: ...]" fenced-block shape buildOllamaMessages() sends
  // to the model, so an exported chat reads the way the model saw it. The
  // pure text builders (chatToMarkdown / chatToJson / exportFilename) live
  // in chat-helpers.js, shared with the tests; downloadBlob below is the
  // only DOM-coupled piece.

  function downloadBlob(filename, mimeType, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download in some browsers; a
    // turn of the event loop is enough for the click to have been taken.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setExportMenuOpen(open) {
    if (!el.exportMenu) return;
    el.exportMenu.classList.toggle('hidden', !open);
    el.exportBtn.setAttribute('aria-expanded', String(open));
  }

  function exportActiveChat(format) {
    setExportMenuOpen(false);
    const chat = activeSession;
    if (!chat || !chat.messages.length) {
      showError('Nothing to export yet — this chat has no messages.');
      return;
    }
    if (format === 'json') {
      downloadBlob(exportFilename(chat, 'json'), 'application/json', chatToJson(chat));
    } else {
      downloadBlob(exportFilename(chat, 'md'), 'text/markdown', chatToMarkdown(chat));
    }
  }

  el.exportBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setExportMenuOpen(el.exportMenu.classList.contains('hidden'));
  });
  el.exportMarkdownBtn?.addEventListener('click', () => exportActiveChat('markdown'));
  el.exportJsonBtn?.addEventListener('click', () => exportActiveChat('json'));
  document.addEventListener('click', (e) => {
    if (!el.exportMenu || el.exportMenu.classList.contains('hidden')) return;
    if (!e.target.closest('.export-menu')) setExportMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setExportMenuOpen(false);
  });

  // ---------- Sidebar / chats ----------
  el.newChatBtn.addEventListener('click', createChat);

  // ---------- Sidebar search ----------
  // Debounced server-side search over the user's sessions (titles and
  // message contents). An empty query restores the normal full list.
  let searchTimer = null;
  el.searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = el.searchInput.value.trim();
      if (!q) {
        try {
          await refreshChatList();
        } catch (err) {
          showError(err.message);
        }
        renderChatList();
        return;
      }
      try {
        const data = await apiRequest(`/api/sessions/search?q=${encodeURIComponent(q)}`);
        chats = data.sessions || [];
        renderChatList();
      } catch (err) {
        showError(err.message);
      }
    }, 250);
  });

  el.clearChatBtn.addEventListener('click', async () => {
    const chat = activeSession;
    if (!chat) return;
    try {
      await patchSession(chat.id, { messages: [], title: 'New chat' });
      chat.messages = [];
      chat.title = 'New chat';
      bumpSummary(chat.id, { title: 'New chat' });
      renderChatList();
      renderMessages();
      updateTitle();
    } catch (err) {
      showError(err.message);
    }
  });

  // Below this width the sidebar CSS switches from a permanent column to a
  // full-height overlay (see the 560px breakpoint in style.css) — the two
  // must agree on what "narrow" means.
  const MOBILE_OVERLAY_QUERY = '(max-width: 560px)';
  const isMobileOverlay = () =>
    window.matchMedia && window.matchMedia(MOBILE_OVERLAY_QUERY).matches;

  function setSidebarCollapsed(collapsed) {
    sidebarCollapsed = collapsed;
    el.app.classList.toggle('sidebar-collapsed', collapsed);
    el.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  el.sidebarToggle.addEventListener('click', () => {
    setSidebarCollapsed(!sidebarCollapsed);
  });

  // On an overlay-width screen the open sidebar covers the chat entirely,
  // so tapping anywhere in the main content area behind it should dismiss
  // it, same as tapping outside any other overlay.
  document.querySelector('.main')?.addEventListener('click', () => {
    if (!sidebarCollapsed && isMobileOverlay()) setSidebarCollapsed(true);
  });

  el.refreshModelsBtn.addEventListener('click', loadModels);

  // ---------- Settings modal ----------
  function openSettings() {
    el.ollamaHostDisplay.value = 'Configured via server (default http://127.0.0.1:11434)';
    el.systemPrompt.value = settings.systemPrompt || '';
    el.temperature.value = settings.temperature;
    el.tempValue.textContent = settings.temperature;
    el.topP.value = settings.topP;
    el.topPValue.textContent = settings.topP;
    el.numCtx.value = settings.numCtx;
    el.useMemory.checked = settings.useMemory === true;
    el.settingsOverlay.classList.remove('hidden');
    el.closeSettingsBtn.focus();
  }

  function closeSettings() {
    settings.systemPrompt = el.systemPrompt.value;
    settings.temperature = Number(el.temperature.value);
    settings.topP = Number(el.topP.value);
    settings.numCtx = Number(el.numCtx.value) || 4096;
    settings.useMemory = el.useMemory.checked;
    saveSettings();
    // numCtx is the meter's denominator, so it can change here.
    updateContextMeter();
    el.settingsOverlay.classList.add('hidden');
    el.settingsBtn.focus();
  }

  el.themeToggleBtn?.addEventListener('click', toggleTheme);
  el.themeToggleBtnTopbar?.addEventListener('click', toggleTheme);

  el.settingsBtn.addEventListener('click', openSettings);
  el.logoutBtn?.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort: even if the logout request fails, the cookie is
      // replaced by the redirect below on the login page.
    }
    window.location.replace('/login.html');
  });
  el.closeSettingsBtn.addEventListener('click', closeSettings);
  el.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === el.settingsOverlay) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.settingsOverlay.classList.contains('hidden')) {
      closeSettings();
    }
  });
  el.temperature.addEventListener('input', () => (el.tempValue.textContent = el.temperature.value));
  el.topP.addEventListener('input', () => (el.topPValue.textContent = el.topP.value));
  el.deleteAllBtn.addEventListener('click', async () => {
    if (!confirm('Delete all chats? This cannot be undone.')) return;
    const ids = chats.map((c) => c.id);
    let failed = 0;
    for (const id of ids) {
      try {
        await apiRequest(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch {
        failed += 1;
      }
    }
    if (failed) showError(`Deleted ${ids.length - failed} of ${ids.length} chats.`);
    try {
      await refreshChatList();
    } catch (err) {
      showError(err.message);
    }
    activeChatId = null;
    activeSession = null;
    renderChatList();
    renderMessages();
    updateTitle();
    closeSettings();
  });

  // ---------- Init ----------
  async function init() {
    currentTheme = loadTheme();
    applyTheme(currentTheme);
    // Start collapsed on phone-width screens — there the sidebar is a full
    // overlay (see MOBILE_OVERLAY_QUERY), and opening on top of the chat by
    // default would hide the one thing the user came here for.
    if (isMobileOverlay()) setSidebarCollapsed(true);
    await loadCurrentUser();
    try {
      await refreshChatList();
      if (chats.length) await selectChat(chats[0].id);
    } catch (err) {
      showError(`Couldn't load your chats: ${err.message}`);
      renderChatList();
      renderMessages();
      updateTitle();
    }
    await maybeOfferMigration();
    await loadModels();
    renderChatList();
    renderMessages();
    updateTitle();
    autoResizeTextarea();
    setInterval(async () => {
      try {
        const r = await fetch('/api/health');
        const d = await r.json();
        setStatus(d.ok, d.error);
      } catch {
        setStatus(false, 'Ollama unreachable');
      }
    }, 15000);
  }

  init();
})();
