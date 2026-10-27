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
    isImageAttachment,
    isPdfAttachment,
    imageMimeType,
    buildOllamaMessages,
    estimateChatTokens,
    formatTokens,
    normalizeSettings,
    cacheKeyFor,
    templateVariables,
    chatToMarkdown,
    chatToJson,
    exportFilename,
    renderMarkdown,
    suggestModel,
    quantizationSuggestions,
    enqueueOfflineSend,
    shiftOfflineSend,
    offlineQueueCount,
  } = window.ChatHelpers;

  let settings = loadSettings();
  let models = [];
  let abortController = null;
  let sidebarCollapsed = false;
  let pullController = null;

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
    shortcutBar: document.getElementById('shortcutBar'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    serverSelect: document.getElementById('serverSelect'),
    presetSelect: document.getElementById('presetSelect'),
    presetSaveBtn: document.getElementById('presetSaveBtn'),
    presetDeleteBtn: document.getElementById('presetDeleteBtn'),
    pinInput: document.getElementById('pinInput'),
    pinAddBtn: document.getElementById('pinAddBtn'),
    pinsList: document.getElementById('pinsList'),
    templateName: document.getElementById('templateName'),
    templateText: document.getElementById('templateText'),
    templateAddBtn: document.getElementById('templateAddBtn'),
    templatesList: document.getElementById('templatesList'),
    memoryLoadBtn: document.getElementById('memoryLoadBtn'),
    memoryPageInfo: document.getElementById('memoryPageInfo'),
    memoryList: document.getElementById('memoryList'),
    summarizeUrl: document.getElementById('summarizeUrl'),
    summarizeUrlBtn: document.getElementById('summarizeUrlBtn'),
    summarizeUrlResult: document.getElementById('summarizeUrlResult'),
    useDocuments: document.getElementById('useDocuments'),
    docFileInput: document.getElementById('docFileInput'),
    docPickBtn: document.getElementById('docPickBtn'),
    docFileName: document.getElementById('docFileName'),
    docIndexBtn: document.getElementById('docIndexBtn'),
    auditList: document.getElementById('auditList'),
    webhookNameInput: document.getElementById('webhookNameInput'),
    webhookUrlInput: document.getElementById('webhookUrlInput'),
    webhookEventPull: document.getElementById('webhookEventPull'),
    webhookEventSession: document.getElementById('webhookEventSession'),
    webhookAddBtn: document.getElementById('webhookAddBtn'),
    webhookList: document.getElementById('webhookList'),
    tokenNameInput: document.getElementById('tokenNameInput'),
    tokenCreateBtn: document.getElementById('tokenCreateBtn'),
    tokenSecretBox: document.getElementById('tokenSecretBox'),
    tokenList: document.getElementById('tokenList'),
    shareBtn: document.getElementById('shareBtn'),
    statsBtn: document.getElementById('statsBtn'),
    metricsBtn: document.getElementById('metricsBtn'),
    metricsOverlay: document.getElementById('metricsOverlay'),
    metricsRefreshBtn: document.getElementById('metricsRefreshBtn'),
    closeMetricsBtn: document.getElementById('closeMetricsBtn'),
    metricsBody: document.getElementById('metricsBody'),
    autoRoute: document.getElementById('autoRoute'),
    modelsHealthBtn: document.getElementById('modelsHealthBtn'),
    modelsHealthOverlay: document.getElementById('modelsHealthOverlay'),
    modelsHealthRefreshBtn: document.getElementById('modelsHealthRefreshBtn'),
    closeModelsHealthBtn: document.getElementById('closeModelsHealthBtn'),
    modelsHealthBody: document.getElementById('modelsHealthBody'),
    statsOverlay: document.getElementById('statsOverlay'),
    closeStatsBtn: document.getElementById('closeStatsBtn'),
    statsBody: document.getElementById('statsBody'),
    compareBtn: document.getElementById('compareBtn'),
    compareOverlay: document.getElementById('compareOverlay'),
    closeCompareBtn: document.getElementById('closeCompareBtn'),
    comparePrompt: document.getElementById('comparePrompt'),
    compareModelList: document.getElementById('compareModelList'),
    compareRunBtn: document.getElementById('compareRunBtn'),
    councilRunBtn: document.getElementById('councilRunBtn'),
    compareResults: document.getElementById('compareResults'),
    paletteOverlay: document.getElementById('paletteOverlay'),
    paletteInput: document.getElementById('paletteInput'),
    paletteList: document.getElementById('paletteList'),
    micBtn: document.getElementById('micBtn'),
    systemPrompt: document.getElementById('systemPrompt'),
    temperature: document.getElementById('temperature'),
    tempValue: document.getElementById('tempValue'),
    topP: document.getElementById('topP'),
    topPValue: document.getElementById('topPValue'),
    numCtx: document.getElementById('numCtx'),
    useMemory: document.getElementById('useMemory'),
    responseCache: document.getElementById('responseCache'),
    usageReportBtn: document.getElementById('usageReportBtn'),
    usageReportBody: document.getElementById('usageReportBody'),
    cleanupDays: document.getElementById('cleanupDays'),
    cleanupPreviewBtn: document.getElementById('cleanupPreviewBtn'),
    cleanupRunBtn: document.getElementById('cleanupRunBtn'),
    cleanupPreviewBody: document.getElementById('cleanupPreviewBody'),
    deleteAllBtn: document.getElementById('deleteAllBtn'),
    downloadDataBtn: document.getElementById('downloadDataBtn'),
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
      // Keyboard reachability (7.17): the list was div-onclick only, which a
      // keyboard user could never operate. role=button + tabindex + Enter /
      // Space activation, and aria-current marks the open chat for screen
      // readers.
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      if (chat.id === activeChatId) item.setAttribute('aria-current', 'true');
      item.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectChat(chat.id);
        }
      };

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

  // Arrow-key roving (7.17): with a chat item focused, Up/Down moves focus
  // through the list like a proper listbox instead of scrolling the page.
  el.chatList?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(el.chatList.querySelectorAll('.chat-item'));
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = items[idx + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
  });

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
    // The cached badge (7.13) only exists on live replies — it isn't a
    // persisted field, and a reloaded chat has nothing to badge.
    role.textContent = (msg.role === 'user' ? 'You' : (msg.model || 'Assistant'))
      + (msg.cached ? ' · cached' : '');

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

    // Citations (7.7): a document-grounded reply lists the chunks it drew
    // from, collapsed by default so provenance is available without being
    // loud. Persisted on the message, so it survives a reload.
    if (msg.role === 'assistant' && Array.isArray(msg.citations) && msg.citations.length) {
      const sources = document.createElement('details');
      sources.className = 'msg-citations';
      const summary = document.createElement('summary');
      summary.textContent = `Sources (${msg.citations.length})`;
      sources.appendChild(summary);
      for (const c of msg.citations) {
        const item = document.createElement('div');
        item.className = 'msg-citation';
        const head = document.createElement('div');
        head.className = 'msg-citation-head';
        head.textContent = c.docName + (Number.isInteger(c.chunk) ? ` · chunk ${c.chunk}` : '');
        const snippet = document.createElement('blockquote');
        snippet.textContent = c.snippet || '';
        item.appendChild(head);
        item.appendChild(snippet);
        sources.appendChild(item);
      }
      body.appendChild(sources);
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

    // Reactions (7.2): 👍/👎 on any completed assistant reply. A second
    // click on the active one clears it (reaction === value → null), and
    // the choice persists with the message via db.js's normalizeMessage.
    if (msg.role === 'assistant' && msg.content) {
      const reactionBtn = (value, label) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reaction-btn' + (msg.reaction === value ? ' active' : '');
        btn.textContent = label;
        btn.setAttribute('aria-pressed', String(msg.reaction === value));
        btn.setAttribute('aria-label', `Rate this reply ${value === 'up' ? 'up' : 'down'}`);
        btn.onclick = () => setMessageReaction(index, msg.reaction === value ? null : value);
        return btn;
      };
      actions.appendChild(reactionBtn('up', '👍'));
      actions.appendChild(reactionBtn('down', '👎'));
    }

    if (msg.role === 'user') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => startEditingMessage(index, row);
      actions.appendChild(editBtn);
    }

    // Speak (F7): read an assistant reply aloud with the browser's TTS.
    if (msg.role === 'assistant' && msg.content && 'speechSynthesis' in window) {
      const speakBtn = document.createElement('button');
      speakBtn.type = 'button';
      speakBtn.textContent = 'Speak';
      speakBtn.onclick = () => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
          speakBtn.textContent = 'Speak';
          return;
        }
        const utterance = new SpeechSynthesisUtterance(msg.content);
        utterance.onend = () => (speakBtn.textContent = 'Speak');
        speakBtn.textContent = 'Stop';
        window.speechSynthesis.speak(utterance);
      };
      actions.appendChild(speakBtn);
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

  // Reactions (7.2): set or clear the user's 👍/👎 on one assistant reply.
  // A full messages replace is the only write path the API offers, and the
  // reaction lives on the message, so that's what persistence uses — same
  // trade-off regenerate/edit already accepted for linear history. The
  // server's normalizeMessage drops anything but 'up'/'down'/absent.
  async function setMessageReaction(index, value) {
    const chat = activeSession;
    if (!chat || !chat.messages[index]) return;
    const updated = chat.messages.map((m, i) => {
      if (i !== index) return m;
      const next = { ...m };
      if (value) next.reaction = value;
      else delete next.reaction;
      return next;
    });
    if (!(await replaceMessages(chat, updated))) return;
    renderMessages();
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
    // bypassCache: a regenerate's whole point is a fresh answer — replaying
    // the cached text for the identical prompt would make the button a no-op.
    await streamAssistantReply(chat, model, { bypassCache: true });
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
    // bypassCache: same reasoning as regenerate — an edit changes the
    // prompt, and the old cached reply for the un-edited history is stale.
    await streamAssistantReply(chat, model, { bypassCache: true });
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

  // ---------- Offline send queue (7.16 completion) ----------
  // Sends that fail at the network level (server unreachable) are parked in
  // localStorage and flushed here — on the browser's 'online' event and when
  // the periodic health poll confirms the server is back. Deliberately NOT
  // on every send completion: a still-down server would turn that into a
  // hot retry loop. Queue helpers are pure (chat-helpers.js).
  function updateOfflineQueueStatus() {
    const n = offlineQueueCount(window.localStorage);
    if (n > 0) setStatus(false, `${n} message${n === 1 ? '' : 's'} queued — will send when back online`);
  }

  async function flushOfflineQueue() {
    if (navigator.onLine === false) return;
    if (abortController) return;   // a send is already in flight
    if (offlineQueueCount(window.localStorage) === 0) return;
    const entry = shiftOfflineSend(window.localStorage);
    if (!entry) return;
    const target = chats.find((c) => c.id === entry.chatId);
    if (!target) {                 // chat deleted while the message was queued
      updateOfflineQueueStatus();
      return flushOfflineQueue();
    }
    if (!activeSession || activeSession.id !== target.id) await selectChat(target.id);
    el.promptInput.value = entry.text;
    autoResizeTextarea();
    el.composer.requestSubmit();
  }

  window.addEventListener('online', () => { flushOfflineQueue(); });

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
        // Model-not-found (F12): Ollama answers 404 with "model ... not
        // found" — offer the one-click pull instead of a dead end.
        if (res.status === 404 && /not find|not found|model/i.test(data.error || '')) {
          showErrorWithPull(data.error, model);
        } else {
          showError(data.error || `Request failed (${res.status})`);
        }
        throw new Error(data.error || `Request failed (${res.status})`);
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
    const isImage = isImageAttachment(att.name);
    if (isImage) chip.classList.add('image-chip');

    if (isImage) {
      // Thumbnail decode straight from the stored base64 — same payload
      // whole app ships around, no second source of truth.
      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.src = `data:${imageMimeType(att.name)};base64,${att.content}`;
      thumb.alt = '';
      chip.appendChild(thumb);
    }

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
        if (isImageAttachment(file.name)) {
          // Images: base64 (bare, no data: prefix) — that is the payload
          // Ollama's `images: []` expects, and it rides along in the
          // persisted message verbatim.
          const dataUrl = await readAsDataURL(file);
          const content = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
          pendingAttachments.push({ name: file.name, content, size: file.size, type: 'image' });
        } else if (isPdfAttachment(file.name)) {
          // PDFs: pdf.js (vendored) extracts the text client-side, so the
          // attachment reaches the model as plain text exactly like a
          // .txt file — the binary never leaves the machine either.
          const content = await extractPdfText(file);
          pendingAttachments.push({ name: file.name, content, size: file.size });
        } else {
          const content = await file.text();
          pendingAttachments.push({ name: file.name, content, size: file.size });
        }
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

  // FileReader wrapped in a promise — the async/await shape handleFileSelect
  // needs; file.text() can't be used because images must base64, not decode
  // as text.
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error(`Could not read "${file.name}".`));
      reader.readAsDataURL(file);
    });
  }

  // ---------- PDF text extraction ----------
  // pdf.js is loaded as a classic script (public/vendor/pdf.min.js, the UMD
  // build) and exposes window.pdfjsLib; the worker is the same-version file
  // vendored next to it. Extraction runs entirely in the browser: the PDF's
  // bytes are never uploaded anywhere, consistent with the app's
  // local-only posture. If pdfjsLib is missing (vendor file deleted, or an
  // offline load failure) the caller surfaces a plain error rather than
  // silently attaching an empty string.
  async function extractPdfText(file) {
    if (!window.pdfjsLib) {
      throw new Error('PDF support is unavailable — the vendored pdf.js library failed to load.');
    }
    const buffer = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    try {
      const pages = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        // Reconstruct line breaks from pdf.js's positioned text items: an
        // item that ends below the previous one's baseline starts a new
        // line. Joining with '' would gluem WordsTogether on wrapped text.
        let text = '';
        let lastY = null;
        for (const item of textContent.items) {
          const y = item.transform && item.transform[5];
          if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 1 && text && !text.endsWith('\n')) {
            text += '\n';
          }
          text += item.str;
          if (y !== undefined) lastY = y;
        }
        const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
        pages.push(trimmed ? `--- Page ${i} of ${doc.numPages} ---\n${trimmed}` : `--- Page ${i} of ${doc.numPages} (no extractable text) ---`);
      }
      const joined = pages.join('\n\n').trim();
      if (!joined || /^(-{3} Page \d+ of \d+ \(no extractable text\) -{3}\n?)+$/.test(joined)) {
        throw new Error('no text layer found (scanned PDFs need OCR, which this app does not do)');
      }
      return joined;
    } finally {
      doc.destroy();
    }
  }

  // ---------- Prompt shortcuts toolbar (Phase 7.3) ----------
  // One-click prompt starters above the composer. A shortcut fills the
  // composer (never auto-sends — the user keeps the final word), and any
  // {{variable}} placeholders are prompted for first, same interaction as
  // the prompt library (F17). variable extraction via templateVariables
  // (chat-helpers.js), so it's test-pinned there.
  const PROMPT_SHORTCUTS = [
    { label: 'Summarize', text: 'Summarize the conversation so far in a few bullet points.' },
    { label: 'Translate', text: 'Translate the following into {{language}}:\n' },
    { label: 'Explain code', text: 'Explain what this code does, step by step:\n```\n\n```' },
    { label: 'Brainstorm', text: 'Give me 10 ideas for {{topic}}, from conventional to unexpected.' },
    { label: 'Proofread', text: 'Proofread the text below. Fix grammar and clarity, then list the changes you made:\n' },
  ];

  function renderShortcutBar() {
    if (!el.shortcutBar) return;
    el.shortcutBar.innerHTML = '';
    for (const shortcut of PROMPT_SHORTCUTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shortcut-chip';
      btn.textContent = shortcut.label;
      btn.onclick = () => applyShortcut(shortcut.text);
      el.shortcutBar.appendChild(btn);
    }
  }

  function applyShortcut(template) {
    let text = template;
    for (const varName of templateVariables(template)) {
      const value = prompt(`Value for "${varName}":`);
      if (value === null) return; // cancelled — leave the composer alone
      text = text.split(`{{${varName}}}`).join(value);
    }
    el.promptInput.value += (el.promptInput.value ? '\n' : '') + text;
    el.promptInput.focus();
    // Put the caret at the end so typing continues where the template left off.
    el.promptInput.setSelectionRange(el.promptInput.value.length, el.promptInput.value.length);
    autoResizeTextarea();
  }

  // ---------- Sending messages ----------
  function autoResizeTextarea() {
    el.promptInput.style.height = 'auto';
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + 'px';
  }

  // ---------- Prompt history (↑/↓ recall) ----------
  // Terminal-style recall of recently sent prompts. Stored locally per
  // browser like settings/theme — prompts never leave the machine. The
  // newest entry is first; duplicates are moved to the front; capped so a
  // long session can't grow localStorage without bound.
  const PROMPT_HISTORY_KEY = 'ollama-chat:prompt-history';
  const PROMPT_HISTORY_MAX = 50;

  let promptHistory = loadPromptHistory();
  let historyIndex = -1; // position while cycling; -1 = not cycling
  let historyDraft = ''; // what was in the box before ↑ was pressed

  function loadPromptHistory() {    try {
      const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string' && p.trim()).slice(0, PROMPT_HISTORY_MAX) : [];
    } catch {
      return [];
    }
  }

  function recordPromptHistory(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    promptHistory = [trimmed, ...promptHistory.filter((p) => p !== trimmed)].slice(0, PROMPT_HISTORY_MAX);
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(promptHistory));
    } catch {
      // Quota/private mode: recall just won't survive a reload this time.
    }
    historyIndex = -1;
  }

  // Returns the text to put in the box for a move of -1 (older) or +1
  // (newer) through the history, or null when there is nowhere to go.
  function historyMove(step, currentText) {
    if (!promptHistory.length) return null;
    if (historyIndex === -1) {
      if (step > 0) return null;
      historyDraft = currentText;
      historyIndex = 0;
      return promptHistory[0];
    }
    const next = historyIndex + step;
    if (next >= promptHistory.length) return null;
    if (next < 0) {
      historyIndex = -1;
      return historyDraft;
    }
    historyIndex = next;
    return promptHistory[next];
  }

  el.promptInput.addEventListener('input', autoResizeTextarea);
  el.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && !e.shiftKey && !el.promptInput.value) {
      const text = historyMove(-1, el.promptInput.value);
      if (text !== null) {
        e.preventDefault();
        el.promptInput.value = text;
        el.promptInput.setSelectionRange(text.length, text.length);
        autoResizeTextarea();
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && historyIndex !== -1) {
      const text = historyMove(1, el.promptInput.value);
      if (text !== null) {
        e.preventDefault();
        el.promptInput.value = text;
        el.promptInput.setSelectionRange(text.length, text.length);
        autoResizeTextarea();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });

  el.composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    let text = el.promptInput.value.trim();
    if (!text) return;

    // Slash commands (F13): handled inline, never sent to the model.
    if (text.startsWith('/')) {
      await runSlashCommand(text);
      return;
    }

    recordPromptHistory(text);
    let model = el.modelSelect.value;
    if (!model) {
      showError('Select a model first. If none are listed, pull one with "ollama pull <model>".');
      return;
    }

    // Auto model routing (7.11): when enabled, the rules-based suggester
    // picks which installed model answers this prompt; the picker's model
    // is only the fallback. The suggested switch is shown, never silent.
    if (settings.autoRoute === true && models.length) {
      const suggested = suggestModel({ models, text, currentModel: model });
      if (suggested && suggested !== model && models.some((m) => m.name === suggested)) {
        model = suggested;
        el.modelSelect.value = suggested;
        setStatus(true, `Routed to ${suggested}`);
      }
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

  // ---------- Slash commands (F13) ----------
  async function runSlashCommand(raw) {
    const [cmd] = raw.split(/\s+/);
    const arg = raw.slice(cmd.length).trim();
    el.promptInput.value = '';
    autoResizeTextarea();
    switch (cmd) {
      case '/help':
        alert('Commands:\n/new — start a new chat\n/clear — clear this chat\n/model <name> — switch model\n/system <prompt> — set the system prompt\n/help — this list\n\nTip: Ctrl/Cmd+K opens the command palette.');
        break;
      case '/new':
        await createChat();
        break;
      case '/clear':
        el.clearChatBtn.click();
        break;
      case '/model':
        if (!arg) {
          showError('Usage: /model <name>. Installed: ' + (models.map((m) => m.name).join(', ') || 'none'));
          return;
        }
        if (!models.some((m) => m.name === arg)) {
          showError(`"${arg}" is not installed. Try /model with one of: ${models.map((m) => m.name).join(', ') || 'none'}`);
          return;
        }
        el.modelSelect.value = arg;
        settings.lastModel = arg;
        saveSettings();
        break;
      case '/system':
        if (!arg) {
          showError('Usage: /system <prompt>');
          return;
        }
        settings.systemPrompt = arg;
        saveSettings();
        el.systemPrompt.value = arg;
        break;
      default:
        showError(`Unknown command "${cmd}". Try /help.`);
    }
  }

  // ---------- Response cache (Phase 7.13) ----------
  // In-memory, per browsing session: identical requests (same model, same
  // conversation prefix as the model sees it, same sampling options, same
  // server) replay the stored reply instead of re-running the model. Never
  // persisted, capped, and bypassed by regenerate/edit — a regenerate that
  // returned the cached text would be useless. Counters feed the stats
  // modal; reset on reload like the cache itself.
  const RESPONSE_CACHE_MAX = 50;
  const responseCache = new Map(); // cacheKey -> assistant text
  const cacheCounters = { hits: 0, misses: 0 };

  function cacheGet(key) {
    if (!responseCache.has(key)) {
      cacheCounters.misses += 1;
      return null;
    }
    cacheCounters.hits += 1;
    // Re-insert so the freshest key is evicted last (LRU via delete+set).
    const text = responseCache.get(key);
    responseCache.delete(key);
    responseCache.set(key, text);
    return text;
  }

  function cachePut(key, text) {
    if (!text || !text.trim()) return;
    responseCache.set(key, text);
    if (responseCache.size > RESPONSE_CACHE_MAX) {
      responseCache.delete(responseCache.keys().next().value);
    }
  }

  async function streamAssistantReply(chat, model, { bypassCache = false } = {}) {
    const ollamaMessages = buildOllamaMessages(settings.systemPrompt, chat.messages);
    const requestOptions = {
      temperature: settings.temperature,
      top_p: settings.topP,
      num_ctx: settings.numCtx,
    };

    const assistantMsg = { role: 'assistant', content: '', model };
    chat.messages.push(assistantMsg);
    renderMessages();
    markLastRowStreaming(true);
    setSending(true);

    abortController = new AbortController();

    // Cache lookup (7.13): only for plain sends with the setting on. A hit
    // replays the stored reply without touching Ollama — no stream to
    // abort, so the request short-circuits straight to persistence.
    const cacheKey = bypassCache || settings.responseCache !== true
      ? null
      : cacheKeyFor({
          model,
          messages: ollamaMessages,
          options: requestOptions,
          serverId: settings.serverId || 0,
        });
    if (cacheKey) {
      const cached = cacheGet(cacheKey);
      if (cached !== null) {
        assistantMsg.content = cached;
        assistantMsg.cached = true;
        pendingRenderText = null;
        // A full re-render, not just a content swap: renderMessages() ran
        // earlier with empty content and no `cached` flag, so only rebuilding
        // the rows makes the "· cached" role badge show up too.
        renderMessages();
        await persistAssistantMessage(chat, assistantMsg);
        setSending(false);
        markLastRowStreaming(false);
        abortController = null;
        renderChatList();
        return;
      }
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          options: requestOptions,
          useMemory: settings.useMemory === true || settings.useDocuments === true,
          useDocuments: settings.useDocuments === true,
          serverId: settings.serverId || 0,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Model-not-found (F12): Ollama answers 404 with "model ... not
        // found" — offer the one-click pull instead of a dead end.
        if (res.status === 404 && /not find|not found|model/i.test(data.error || '')) {
          showErrorWithPull(data.error, model);
        } else {
          showError(data.error || `Request failed (${res.status})`);
        }
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      // Set by /api/chat when compactMessages() actually folded older
      // turns into a summary for this request.
      if (res.headers.get('X-Compacted') === 'true') {
        compactedChats.add(chat.id);
        updateContextMeter();
      }

      // Citations (7.7): a document-grounded reply carries base64 JSON in
      // X-Citations. Attaching it to the message is what makes it persist —
      // db.js's normalizeMessage keeps a well-formed citations array.
      const citationsHeader = res.headers.get('X-Citations');
      if (citationsHeader) {
        try {
          // base64 → bytes → UTF-8. atob alone would latin-1-decode and
          // mangle non-ASCII snippets; there's no Buffer in the browser.
          const bytes = Uint8Array.from(atob(citationsHeader), (ch) => ch.charCodeAt(0));
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (Array.isArray(parsed) && parsed.length) assistantMsg.citations = parsed;
        } catch {
          // Malformed header — provenance is best-effort; drop it silently.
        }
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
      if (cacheKey) cachePut(cacheKey, assistantMsg.content);
      await persistAssistantMessage(chat, assistantMsg);
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content += assistantMsg.content ? '\n\n_[stopped]_' : '_[stopped]_';
        pendingRenderText = null;
        updateLastMessageContent(assistantMsg.content);
        await persistAssistantMessage(chat, assistantMsg);
      } else if (err.name === 'TypeError' && !bypassCache && !assistantMsg.content) {
        // Network-level failure (the request never got a response — server
        // unreachable): park the outgoing message in the offline queue
        // (7.16 completion) instead of just erroring. It flushes on the
        // 'online' event or the next successful health poll. Never queued:
        // regenerate/edit (bypassCache) and messages with attachments or
        // images (they may not survive a reload).
        pendingRenderText = null;
        const failedUserMsg = chat.messages[chat.messages.length - 1];
        const queueable = failedUserMsg && failedUserMsg.role === 'user'
          && typeof failedUserMsg.content === 'string' && failedUserMsg.content.trim().length > 0
          && !failedUserMsg.attachments && !failedUserMsg.images;
        chat.messages.pop();
        renderMessages();
        if (queueable) {
          enqueueOfflineSend(window.localStorage, { chatId: chat.id, text: failedUserMsg.content });
          updateOfflineQueueStatus();
          showError('Offline — message queued. It will send automatically when the connection returns.');
        } else {
          showError(err.message);
        }
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

  // Error banner with a one-click pull action (F12): shown when a chat or
  // regenerate targets a model that isn't installed on the host.
  function showErrorWithPull(message, modelName) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.setAttribute('role', 'alert');
    const icon = document.createElement('span');
    icon.className = 'error-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ICONS.warning;
    const text = document.createElement('span');
    text.textContent = message;
    const pull = document.createElement('button');
    pull.type = 'button';
    pull.className = 'btn btn-primary';
    pull.textContent = `Pull ${modelName}`;
    pull.onclick = () => {
      banner.remove();
      el.pullModelInput.value = modelName;
      openSettings();
      pullModel();
    };
    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(pull);
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
    el.serverSelect.value = String(settings.serverId || 0);
    el.systemPrompt.value = settings.systemPrompt || '';
    el.temperature.value = settings.temperature;
    el.tempValue.textContent = settings.temperature;
    el.topP.value = settings.topP;
    el.topPValue.textContent = settings.topP;
    el.numCtx.value = settings.numCtx;
    el.useMemory.checked = settings.useMemory === true;
    el.useDocuments.checked = settings.useDocuments === true;
    el.autoRoute.checked = settings.autoRoute === true;
    el.responseCache.checked = settings.responseCache !== false;
    renderPresets();
    renderPins();
    renderTemplates();
    renderAudit();
    renderTokens();
    renderWebhooks();
    el.settingsOverlay.classList.remove('hidden');
    el.closeSettingsBtn.focus();
  }

  function closeSettings() {
    settings.serverId = Number(el.serverSelect.value) || 0;
    settings.systemPrompt = el.systemPrompt.value;
    settings.temperature = Number(el.temperature.value);
    settings.topP = Number(el.topP.value);
    settings.numCtx = Number(el.numCtx.value) || 4096;
    settings.useMemory = el.useMemory.checked;
    settings.useDocuments = el.useDocuments.checked;
    settings.autoRoute = el.autoRoute.checked;
    settings.responseCache = el.responseCache.checked;
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

  // ---------- Multi-server picker (F16) ----------
  async function loadServers() {
    try {
      const data = await apiRequest('/api/servers');
      const servers = data.servers || [];
      el.serverSelect.innerHTML = '';
      for (const s of servers) {
        const opt = document.createElement('option');
        opt.value = String(s.id);
        opt.textContent = s.url;
        el.serverSelect.appendChild(opt);
      }
      // A settings.serverId beyond the current list (hosts were removed)
      // falls back to the primary rather than leaving a broken selection.
      if (!servers.some((s) => String(s.id) === String(settings.serverId || 0))) {
        settings.serverId = 0;
      }
      el.serverSelect.value = String(settings.serverId || 0);
    } catch (err) {
      showError(`Couldn't load the server list: ${err.message}`);
    }
  }

  // ---------- System prompt presets (F6) ----------
  const PRESETS_KEY = 'ollama-chat:presets';
  let presets = [];

  function loadPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRESETS_KEY));
      presets = Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.name === 'string') : [];
    } catch {
      presets = [];
    }
  }

  function savePresets() {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  }

  function renderPresets() {
    el.presetSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— custom —';
    el.presetSelect.appendChild(none);
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      el.presetSelect.appendChild(opt);
    }
    el.presetSelect.value = '';
  }

  el.presetSelect?.addEventListener('change', () => {
    const preset = presets.find((p) => p.name === el.presetSelect.value);
    if (!preset) return;
    el.systemPrompt.value = preset.systemPrompt || '';
    el.temperature.value = preset.temperature;
    el.tempValue.textContent = preset.temperature;
    el.topP.value = preset.topP;
    el.topPValue.textContent = preset.topP;
  });

  el.presetSaveBtn?.addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name || !name.trim()) return;
    const preset = {
      name: name.trim().slice(0, 60),
      systemPrompt: el.systemPrompt.value,
      temperature: Number(el.temperature.value),
      topP: Number(el.topP.value),
    };
    presets = presets.filter((p) => p.name !== preset.name);
    presets.push(preset);
    savePresets();
    renderPresets();
    el.presetSelect.value = preset.name;
  });

  el.presetDeleteBtn?.addEventListener('click', () => {
    const name = el.presetSelect.value;
    if (!name) return;
    presets = presets.filter((p) => p.name !== name);
    savePresets();
    renderPresets();
  });

  // ---------- Pinned facts (F14) ----------
  async function renderPins() {
    el.pinsList.innerHTML = '';
    let pins;
    try {
      const data = await apiRequest('/api/pins');
      pins = data.pins || [];
    } catch (err) {      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `Pins unavailable: ${err.message}`;
      el.pinsList.appendChild(note);
      return;
    }
    if (!pins.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No pinned facts yet.';
      el.pinsList.appendChild(empty);
      return;
    }
    for (const pin of pins) {
      const item = document.createElement('div');
      item.className = 'model-manage-item';
      const text = document.createElement('span');
      text.className = 'name';
      text.textContent = pin.text;
      const del = document.createElement('button');
      del.className = 'del-model';
      del.type = 'button';
      del.textContent = 'Delete';
      del.onclick = async () => {
        try {
          await apiRequest(`/api/pins/${encodeURIComponent(pin.id)}`, { method: 'DELETE' });
          await renderPins();
        } catch (err) {
          showError(err.message);
        }
      };
      item.appendChild(text);
      item.appendChild(del);
      el.pinsList.appendChild(item);
    }
  }

  el.pinAddBtn?.addEventListener('click', async () => {
    const text = el.pinInput.value.trim();
    if (!text) return;
    try {
      await apiRequest('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      el.pinInput.value = '';
      await renderPins();
    } catch (err) {
      showError(err.message);
    }
  });

  // ---------- Prompt library (F17) ----------
  const TEMPLATES_KEY = 'ollama-chat:templates';
  let templates = [];

  function loadTemplates() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TEMPLATES_KEY));
      templates = Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.name === 'string' && typeof t.text === 'string') : [];
    } catch {
      templates = [];
    }
  }

  function saveTemplates() {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  function renderTemplates() {
    el.templatesList.innerHTML = '';
    if (!templates.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No templates yet — {{variables}} are filled in when used.';
      el.templatesList.appendChild(empty);
      return;
    }
    for (const t of templates) {
      const item = document.createElement('div');
      item.className = 'model-manage-item';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.name;
      const use = document.createElement('button');
      use.className = 'del-model';
      use.type = 'button';
      use.textContent = 'Use';
      use.onclick = () => {
        let text = t.text;
        const vars = [...new Set((t.text.match(/{{\s*([\w.-]+)\s*}}/g) || []))];
        for (const v of vars) {
          const val = prompt(`Value for "${v.replace(/[{}]/g, '').trim()}":`);
          if (val === null) return;
          text = text.split(v).join(val);
        }
        el.promptInput.value += (el.promptInput.value ? '\n' : '') + text;
        el.promptInput.focus();
        autoResizeTextarea();
      };
      const del = document.createElement('button');
      del.className = 'del-model';
      del.type = 'button';
      del.textContent = 'Delete';
      del.onclick = () => {
        templates = templates.filter((x) => x !== t);
        saveTemplates();
        renderTemplates();
      };
      item.appendChild(name);
      item.appendChild(use);
      item.appendChild(del);
      el.templatesList.appendChild(item);
    }
  }

  el.templateAddBtn?.addEventListener('click', () => {
    const name = el.templateName.value.trim();
    const text = el.templateText.value.trim();
    if (!name || !text) {
      showError('A template needs both a name and text.');
      return;
    }
    templates = templates.filter((t) => t.name !== name);
    templates.push({ name, text });
    saveTemplates();
    el.templateName.value = '';
    el.templateText.value = '';
    renderTemplates();
  });

  // ---------- Memory editing (Phase 7.8) ----------
  // Explicitly loaded (Qdrant scroll isn't free and most sessions never
  // touch this), paginated by the server's next_page_offset, and edited
  // inline: Edit swaps the text for a textarea, Save PATCHes (server
  // re-embeds), Delete removes the point after a confirm.
  let memoryNextOffset = null;

  async function loadMemoryPoints() {
    el.memoryList.innerHTML = '<div class="muted">Loading…</div>';
    el.memoryPageInfo.textContent = '';
    try {
      const query = memoryNextOffset ? `?offset=${encodeURIComponent(memoryNextOffset)}` : '';
      const data = await apiRequest(`/api/memory/points${query}`);
      renderMemoryPoints(data.points || []);
      memoryNextOffset = data.nextOffset || null;
      el.memoryPageInfo.textContent = memoryNextOffset ? 'More available — click again for the next page.' : '';
    } catch (err) {
      el.memoryList.innerHTML = '';
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `Memory unavailable: ${err.message}`;
      el.memoryList.appendChild(note);
    }
  }

  function renderMemoryPoints(points) {
    el.memoryList.innerHTML = '';
    if (!points.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = memoryNextOffset ? '' : 'Nothing indexed yet — chat with "Semantic memory" enabled to build it.';
      el.memoryList.appendChild(empty);
      return;
    }
    for (const point of points) {
      const item = document.createElement('div');
      item.className = 'model-manage-item memory-item';

      const textEl = document.createElement('span');
      textEl.className = 'name';
      const full = typeof point.payload?.text === 'string' ? point.payload.text : '';
      textEl.textContent = full.length > 160 ? `${full.slice(0, 160)}…` : full;
      textEl.title = full;
      item.appendChild(textEl);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'del-model';
      edit.textContent = 'Edit';
      edit.onclick = () => startMemoryEdit(item, point, full);
      item.appendChild(edit);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-model';
      del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm('Delete this memory point? It cannot be recovered.')) return;
        try {
          await apiRequest(`/api/memory/points/${encodeURIComponent(point.id)}`, { method: 'DELETE' });
          item.remove();
        } catch (err) {
          showError(err.message);
        }
      };
      item.appendChild(del);
      el.memoryList.appendChild(item);
    }
  }

  function startMemoryEdit(item, point, currentText) {
    if (item.querySelector('.memory-edit')) return;
    item.querySelectorAll('button').forEach((b) => (b.disabled = true));

    const editor = document.createElement('div');
    editor.className = 'memory-edit';
    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.value = currentText;
    const actions = document.createElement('div');
    actions.className = 'msg-edit-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary';
    save.textContent = 'Save';
    save.onclick = async () => {
      const text = textarea.value.trim();
      if (!text) { showError('Memory text cannot be empty.'); return; }
      save.disabled = true;
      try {
        await apiRequest(`/api/memory/points/${encodeURIComponent(point.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        await loadMemoryPoints();
      } catch (err) {
        save.disabled = false;
        showError(err.message);
      }
    };
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => loadMemoryPoints();

    actions.appendChild(save);
    actions.appendChild(cancel);
    editor.appendChild(textarea);
    editor.appendChild(actions);
    item.appendChild(editor);
    textarea.focus();
  }

  el.memoryLoadBtn?.addEventListener('click', () => {
    memoryNextOffset = null;
    loadMemoryPoints();
  });

  // ---------- URL summarizer (Phase 7.9) ----------
  el.summarizeUrlBtn?.addEventListener('click', async () => {
    const url = el.summarizeUrl.value.trim();
    const model = el.modelSelect.value;
    if (!url) { showError('Enter a URL to summarize.'); return; }
    if (!model) { showError('Select a model first — the summary needs one.'); return; }
    el.summarizeUrlBtn.disabled = true;
    el.summarizeUrlResult.innerHTML = '<div class="muted">Fetching and summarizing…</div>';
    try {
      const data = await apiRequest('/api/summarize-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, model }),
      });
      el.summarizeUrlResult.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'muted';
      head.textContent = `${data.chars} characters of text summarized from ${data.url}`;
      const body = document.createElement('div');
      body.className = 'msg-content';
      body.innerHTML = renderMarkdown(data.summary || '_(empty summary)_');
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn btn-ghost';
      use.textContent = 'Use as prompt';
      use.onclick = () => {
        el.promptInput.value += (el.promptInput.value ? '\n' : '') + data.summary;
        autoResizeTextarea();
        closeSettings();
        el.promptInput.focus();
      };
      el.summarizeUrlResult.appendChild(head);
      el.summarizeUrlResult.appendChild(body);
      el.summarizeUrlResult.appendChild(use);
    } catch (err) {
      el.summarizeUrlResult.innerHTML = '';
      showError(err.message);
    } finally {
      el.summarizeUrlBtn.disabled = false;
    }
  });

  // ---------- Document library (F3) ----------
  let docFile = null;
  el.docPickBtn?.addEventListener('click', () => el.docFileInput.click());
  el.docFileInput?.addEventListener('change', () => {
    docFile = el.docFileInput.files[0] || null;
    el.docFileName.textContent = docFile ? docFile.name : '';
    el.docIndexBtn.disabled = !docFile;
  });
  el.docIndexBtn?.addEventListener('click', async () => {
    if (!docFile) return;
    el.docIndexBtn.disabled = true;
    try {
      const text = await docFile.text();
      const data = await apiRequest('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: docFile.name, text }),
      });
      el.docFileName.textContent = `Indexed ${data.chunks} chunks from ${data.name}`;
      docFile = null;
      el.docFileInput.value = '';
      el.docIndexBtn.disabled = true;
      await renderAudit();
    } catch (err) {
      showError(err.message);
      el.docIndexBtn.disabled = false;
    }
  });

  // ---------- Audit log viewer (F20) ----------
  async function renderAudit() {
    if (!el.auditList) return;
    el.auditList.innerHTML = '';
    let entries;
    try {
      const data = await apiRequest('/api/audit');
      entries = data.entries || [];
    } catch (err) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `Audit log unavailable: ${err.message}`;
      el.auditList.appendChild(note);
      return;
    }
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No sensitive actions recorded yet.';
      el.auditList.appendChild(empty);
      return;
    }
    for (const entry of entries.slice(0, 50)) {
      const item = document.createElement('div');
      item.className = 'audit-item';
      const when = new Date(entry.at).toLocaleString();
      item.textContent = `${when} — ${entry.action}${entry.detail ? `: ${entry.detail}` : ''}`;
      el.auditList.appendChild(item);
    }
  }

  // ---------- API tokens (7.14) ----------
  // Create/list/revoke personal API keys. The secret is displayed once, in
  // a highlighted box, and never fetched again — the list endpoint only
  // ever returns the prefix, so a leaked page state can't leak a key.
  async function renderTokens() {
    if (!el.tokenList) return;
    el.tokenList.innerHTML = '';
    let tokens;
    try {
      const data = await apiRequest('/api/tokens');
      tokens = data.tokens || [];
    } catch (err) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `API tokens unavailable: ${err.message}`;
      el.tokenList.appendChild(note);
      return;
    }
    if (!tokens.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No API tokens yet.';
      el.tokenList.appendChild(empty);
      return;
    }
    for (const token of tokens) {
      const item = document.createElement('div');
      item.className = 'model-manage-item';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${token.name} · ${token.prefix}…`;
      name.title = `Created ${new Date(token.createdAt).toLocaleString()}` +
        (token.lastUsedAt ? ` · last used ${new Date(token.lastUsedAt).toLocaleString()}` : ' · never used');
      const del = document.createElement('button');
      del.className = 'del-model';
      del.type = 'button';
      del.textContent = 'Revoke';
      del.onclick = async () => {
        if (!confirm(`Revoke token "${token.name}"? Scripts using it will stop working immediately.`)) return;
        try {
          await apiRequest(`/api/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' });
          await renderTokens();
          await renderAudit();
        } catch (err) {
          showError(err.message);
        }
      };
      item.appendChild(name);
      item.appendChild(del);
      el.tokenList.appendChild(item);
    }
  }

  el.tokenCreateBtn?.addEventListener('click', async () => {
    const name = el.tokenNameInput.value.trim();
    if (!name) {
      showError('Give the token a name first.');
      return;
    }
    el.tokenCreateBtn.disabled = true;
    try {
      const token = await apiRequest('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      el.tokenNameInput.value = '';
      // One-time secret display. Selectable text, not a prompt() — it may
      // need copying from a machine without clipboard permission.
      el.tokenSecretBox.classList.remove('hidden');
      el.tokenSecretBox.innerHTML = '';
      const label = document.createElement('div');
      label.className = 'muted';
      label.textContent = 'Copy this token now — it is shown only once:';
      const code = document.createElement('code');
      code.className = 'token-secret';
      code.textContent = token.token;
      el.tokenSecretBox.appendChild(label);
      el.tokenSecretBox.appendChild(code);
      await renderTokens();
      await renderAudit();
    } catch (err) {
      showError(err.message);
    } finally {
      el.tokenCreateBtn.disabled = false;
    }
  });

  // ---------- Webhooks (7.15) ----------
  async function renderWebhooks() {
    if (!el.webhookList) return;
    el.webhookList.innerHTML = '';
    let webhooks;
    try {
      const data = await apiRequest('/api/webhooks');
      webhooks = data.webhooks || [];
    } catch (err) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `Webhooks unavailable: ${err.message}`;
      el.webhookList.appendChild(note);
      return;
    }
    if (!webhooks.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No webhooks yet.';
      el.webhookList.appendChild(empty);
      return;
    }
    for (const hook of webhooks) {
      const item = document.createElement('div');
      item.className = 'model-manage-item';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${hook.name} — ${hook.events.join(', ')}`;
      name.title = hook.url;

      const test = document.createElement('button');
      test.className = 'del-model';
      test.type = 'button';
      test.textContent = 'Test';
      test.onclick = async () => {
        test.disabled = true;
        try {
          const outcome = await apiRequest(`/api/webhooks/${encodeURIComponent(hook.id)}/test`, { method: 'POST' });
          test.textContent = outcome.ok ? 'Delivered ✓' : `Failed (${outcome.error || outcome.status})`;
        } catch (err) {
          test.textContent = 'Failed';
          showError(err.message);
        } finally {
          setTimeout(() => { test.textContent = 'Test'; test.disabled = false; }, 2500);
        }
      };

      const del = document.createElement('button');
      del.className = 'del-model';
      del.type = 'button';
      del.textContent = 'Delete';
      del.onclick = async () => {
        try {
          await apiRequest(`/api/webhooks/${encodeURIComponent(hook.id)}`, { method: 'DELETE' });
          await renderWebhooks();
          await renderAudit();
        } catch (err) {
          showError(err.message);
        }
      };

      item.appendChild(name);
      item.appendChild(test);
      item.appendChild(del);
      el.webhookList.appendChild(item);
    }
  }

  el.webhookAddBtn?.addEventListener('click', async () => {
    const name = el.webhookNameInput.value.trim();
    const url = el.webhookUrlInput.value.trim();
    const events = [
      ...(el.webhookEventPull.checked ? ['model.pull'] : []),
      ...(el.webhookEventSession.checked ? ['session.create'] : []),
    ];
    el.webhookAddBtn.disabled = true;
    try {
      await apiRequest('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, events }),
      });
      el.webhookNameInput.value = '';
      el.webhookUrlInput.value = '';
      await renderWebhooks();
      await renderAudit();
    } catch (err) {
      showError(err.message);
    } finally {
      el.webhookAddBtn.disabled = false;
    }
  });

  // ---------- Share link (F10) ----------
  el.shareBtn?.addEventListener('click', async () => {
    const chat = activeSession;
    if (!chat || !chat.messages.length) {
      showError('Nothing to share yet — this chat has no messages.');
      return;
    }
    try {
      const data = await apiRequest(`/api/sessions/${encodeURIComponent(chat.id)}/share`, { method: 'POST' });
      const url = `${location.origin}${data.url}`;
      try {
        await navigator.clipboard.writeText(url);
        alert(`Share link copied to clipboard:\n${url}\n\nSharing again revokes this link.`);
      } catch {
        prompt('Share link (copy manually):', url);
      }
      await renderAudit();
    } catch (err) {
      showError(err.message);
    }
  });
  // ---------- Voice dictation (F7) ----------
  // Web Speech API where the browser offers it; hidden otherwise. Results
  // append to whatever is already in the composer so dictation and typing
  // mix freely.
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;

  if (SpeechRecognition && el.micBtn) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    let listening = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          el.promptInput.value += (el.promptInput.value ? ' ' : '') + event.results[i][0].transcript;
          autoResizeTextarea();
        }
      }
    };
    recognition.onend = () => {
      listening = false;
      el.micBtn.classList.remove('recording');
    };
    recognition.onerror = () => {
      listening = false;
      el.micBtn.classList.remove('recording');
    };
    el.micBtn.addEventListener('click', () => {
      if (listening) {
        recognition.stop();
        return;
      }
      listening = true;
      el.micBtn.classList.add('recording');
      recognition.start();
    });
  } else if (el.micBtn) {
    el.micBtn.classList.add('hidden');
  }

  // ---------- Command palette (F13) ----------
  function paletteCommands() {
    const modelCmds = models.map((m) => ({
      label: `Model: ${m.name}`,
      run: () => {
        el.modelSelect.value = m.name;
        settings.lastModel = m.name;
        saveSettings();
      },
    }));
    return [
      { label: 'New chat', run: () => createChat() },
      { label: 'Toggle theme', run: toggleTheme },
      { label: 'Open settings', run: openSettings },
      { label: 'Export chat as Markdown', run: () => exportActiveChat('markdown') },
      { label: 'Export chat as JSON', run: () => exportActiveChat('json') },
      { label: 'Share this chat', run: () => el.shareBtn.click() },
      { label: 'Compare models', run: () => openCompare() },
      { label: 'Chat statistics', run: () => openStats() },
      ...modelCmds,
    ];
  }

  function renderPalette(filter) {
    el.paletteList.innerHTML = '';
    const q = filter.trim().toLowerCase();
    const matches = paletteCommands().filter((c) => !q || c.label.toLowerCase().includes(q));
    for (const cmd of matches.slice(0, 12)) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.setAttribute('role', 'option');
      item.textContent = cmd.label;
      item.onclick = () => {
        setPaletteOpen(false);
        cmd.run();
      };
      el.paletteList.appendChild(item);
    }
  }

  function setPaletteOpen(open) {
    el.paletteOverlay.classList.toggle('hidden', !open);
    if (open) {
      el.paletteInput.value = '';
      renderPalette('');
      el.paletteInput.focus();
    }
  }

  el.paletteInput?.addEventListener('input', () => renderPalette(el.paletteInput.value));
  el.paletteOverlay?.addEventListener('click', (e) => {
    if (e.target === el.paletteOverlay) setPaletteOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen(!el.paletteOverlay.classList.contains('hidden') ? false : true);
    }
    if (e.key === 'Escape' && !el.paletteOverlay.classList.contains('hidden')) {
      setPaletteOpen(false);
    }
  });

  // ---------- Chat statistics (F9) ----------
  function openStats() {
    const chat = activeSession;
    el.statsBody.innerHTML = '';
    if (!chat || !chat.messages.length) {
      el.statsBody.innerHTML = '<div class="muted">No messages yet.</div>';
    } else {
      const byModel = new Map();
      let userCount = 0;
      let assistantCount = 0;
      for (const m of chat.messages) {
        if (m.role === 'user') userCount += 1;
        if (m.role === 'assistant') {
          assistantCount += 1;
          const key = m.model || 'unknown';
          byModel.set(key, (byModel.get(key) || 0) + 1);
        }
      }
      const tokens = estimateChatTokens(settings.systemPrompt, chat.messages);
      const rows = [
        ['Messages', `${chat.messages.length} (${userCount} you, ${assistantCount} assistant)`],
        ['Estimated tokens (whole chat)', `~${formatTokens(tokens)}`],
        ['Context window', `${formatTokens(settings.numCtx || 4096)} tokens`],
        ['Models used', [...byModel].map(([m, c]) => `${m} (${c})`).join(', ') || '—'],
        ['Response cache (this session)', `${cacheCounters.hits} hit${cacheCounters.hits === 1 ? '' : 's'} / ${cacheCounters.misses} miss${cacheCounters.misses === 1 ? '' : 'es'} · ${responseCache.size} stored`],
      ];
      for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'stats-row';
        const l = document.createElement('span');
        l.className = 'stats-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        el.statsBody.appendChild(row);
      }
    }
    el.statsOverlay.classList.remove('hidden');
    trackModalOpener();
    el.closeStatsBtn.focus();
  }

  el.statsBtn?.addEventListener('click', openStats);
  el.closeStatsBtn?.addEventListener('click', () => hideModal(el.statsOverlay));
  el.statsOverlay?.addEventListener('click', (e) => {
    if (e.target === el.statsOverlay) hideModal(el.statsOverlay);
  });

  // ---------- Keyboard access for the remaining modals (7.17) ----------
  // Settings and the command palette each manage their own Escape handling;
  // stats / metrics / model-health / compare are simple overlays, so one
  // shared close helper + Escape listener covers them. hideModal restores
  // focus to the element that opened the dialog — each open function moves
  // focus into the overlay (to its close button), so closing must move it
  // back or keyboard/SR users are left stranded on a hidden button.
  let modalOpener = null;
  function hideModal(overlay) {
    overlay.classList.add('hidden');
    if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
    modalOpener = null;
  }
  function trackModalOpener() {
    modalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const overlay of [el.statsOverlay, el.metricsOverlay, el.modelsHealthOverlay, el.compareOverlay]) {
      if (overlay && !overlay.classList.contains('hidden')) {
        hideModal(overlay);
        return;
      }
    }
  });

  // Focus trap (7.17): while a dialog is open, Tab must cycle inside it —
  // otherwise focus escapes to the page behind the overlay, which keyboard
  // and screen-reader users can't see. One shared handler covers every
  // overlay (settings, palette, and the four simple ones); exactly one is
  // ever open, so the single-open guard also keeps this inert otherwise.
  const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const open = [el.settingsOverlay, el.statsOverlay, el.metricsOverlay, el.modelsHealthOverlay, el.compareOverlay, el.paletteOverlay]
      .filter((o) => o && !o.classList.contains('hidden'));
    if (open.length !== 1) return;
    const focusables = open[0].querySelectorAll(FOCUSABLE_SELECTOR);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !open[0].contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  });

  // ---------- Server metrics dashboard ----------
  // Renders the snapshot from GET /api/metrics (metrics.js): totals up
  // front, then one row per method+route with request counts, status
  // breakdown, and latency min/avg/max. Data is in-memory and resets when
  // the server restarts — the header says so, so nobody reads a small
  // number after a fresh start as a drop in traffic.
  async function openMetrics() {
    el.metricsOverlay.classList.remove('hidden');
    trackModalOpener();
    el.closeMetricsBtn.focus();
    await renderMetrics();
  }

  async function renderMetrics() {
    el.metricsBody.innerHTML = '<p class="muted">Loading…</p>';
    let snap;
    try {
      snap = await apiRequest('/api/metrics');
    } catch (err) {
      el.metricsBody.innerHTML = '';
      el.metricsBody.appendChild(buildMetricsSummary('Could not load metrics', err.message, ''));
      return;
    }

    el.metricsBody.innerHTML = '';
    const uptimeMin = snap.uptimeSeconds >= 90
      ? `${Math.round(snap.uptimeSeconds / 60)} min`
      : `${snap.uptimeSeconds}s`;
    el.metricsBody.appendChild(
      buildMetricsSummary('Since server start', `${snap.totalRequests} requests`, `uptime ${uptimeMin} · ${snap.upstreamErrorCount} upstream errors`)
    );

    const routes = Object.entries(snap.routes || {}).sort((a, b) => b[1].count - a[1].count);
    if (!routes.length) return;

    const table = document.createElement('table');
    table.className = 'metrics-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Route</th><th>Requests</th><th>Statuses</th><th>Latency min/avg/max</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const [route, s] of routes) {
      const tr = document.createElement('tr');

      const name = document.createElement('td');
      name.textContent = route;

      const count = document.createElement('td');
      count.textContent = String(s.count);

      const statuses = document.createElement('td');
      statuses.textContent = Object.entries(s.statusCounts || {})
        .map(([code, n]) => `${code}×${n}`)
        .join(', ');

      const latency = document.createElement('td');
      latency.textContent = `${s.minMs} / ${s.avgMs} / ${s.maxMs} ms`;

      tr.appendChild(name);
      tr.appendChild(count);
      tr.appendChild(statuses);
      tr.appendChild(latency);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.metricsBody.appendChild(table);
    el.metricsBody.insertAdjacentHTML(
      'beforeend',
      '<p class="muted">In-memory only — these counters reset whenever the server restarts.</p>'
    );
  }

  function buildMetricsSummary(title, value, sub) {
    const box = document.createElement('div');
    box.className = 'metrics-summary';
    const h = document.createElement('div');
    h.className = 'stats-label';
    h.textContent = title;
    const v = document.createElement('div');
    v.textContent = value;
    box.appendChild(h);
    box.appendChild(v);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      box.appendChild(s);
    }
    return box;
  }

  el.metricsBtn?.addEventListener('click', openMetrics);
  el.metricsRefreshBtn?.addEventListener('click', renderMetrics);
  el.closeMetricsBtn?.addEventListener('click', () => hideModal(el.metricsOverlay));
  el.metricsOverlay?.addEventListener('click', (e) => {
    if (e.target === el.metricsOverlay) hideModal(el.metricsOverlay);
  });

  // ---------- Model health (7.10) ----------
  // Renders the /api/models/health snapshot: Ollama version, installed
  // models with sizes, currently loaded models with VRAM residency, and
  // the account's recent pull history from the audit log.
  async function renderModelsHealth() {
    el.modelsHealthBody.innerHTML = '<p class="muted">Loading…</p>';
    let snap;
    try {
      snap = await apiRequest('/api/models/health');
    } catch (err) {
      el.modelsHealthBody.innerHTML = '';
      el.modelsHealthBody.appendChild(buildMetricsSummary('Could not load model health', err.message, ''));
      return;
    }

    el.modelsHealthBody.innerHTML = '';
    const version = snap.ollama && snap.ollama.version ? snap.ollama.version : 'unknown';
    el.modelsHealthBody.appendChild(
      buildMetricsSummary('Ollama', `v${version}`, `${snap.installed.length} installed · ${snap.loaded.length} loaded`)
    );

    if (snap.loaded.length) {
      const title = document.createElement('div');
      title.className = 'stats-label';
      title.textContent = 'Loaded in memory';
      el.modelsHealthBody.appendChild(title);
      const table = document.createElement('table');
      table.className = 'metrics-table';
      table.innerHTML = '<thead><tr><th>Model</th><th>Size</th><th>On GPU</th><th>Unloads</th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const m of snap.loaded) {
        const tr = document.createElement('tr');
        const cells = [
          m.name,
          m.size ? formatBytes(m.size) : '—',
          m.sizeVram ? formatBytes(m.sizeVram) : '— (CPU)',
          m.expiresAt ? new Date(m.expiresAt).toLocaleTimeString() : '—',
        ];
        for (const text of cells) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      el.modelsHealthBody.appendChild(table);
    }

    if (snap.installed.length) {
      const title = document.createElement('div');
      title.className = 'stats-label';
      title.textContent = 'Installed models';
      el.modelsHealthBody.appendChild(title);
      for (const m of snap.installed) {
        const item = document.createElement('div');
        item.className = 'model-manage-item';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = m.name + (m.parameterSize ? ` · ${m.parameterSize}` : '') + (m.quantization ? ` · ${m.quantization}` : '');
        const size = document.createElement('span');
        size.className = 'size';
        size.textContent = m.size ? formatBytes(m.size) : '';
        item.appendChild(name);
        item.appendChild(size);
        el.modelsHealthBody.appendChild(item);
      }

      // Quantization advisor (7.12): point out installed smaller variants
      // of the same base model that would save real disk space.
      const suggestions = quantizationSuggestions(snap.installed);
      if (suggestions.length) {
        const qTitle = document.createElement('div');
        qTitle.className = 'stats-label';
        qTitle.textContent = 'Space-saving suggestions';
        el.modelsHealthBody.appendChild(qTitle);
        for (const s of suggestions) {
          const item = document.createElement('div');
          item.className = 'muted';
          item.textContent = `"${s.model}" has a smaller variant installed: "${s.suggestion}" saves ${formatBytes(s.savedBytes)} (${s.savedPercent}%). Delete the bigger one from Settings if you no longer need it.`;
          el.modelsHealthBody.appendChild(item);
        }
      }
    }

    if (snap.pulls.length) {
      const title = document.createElement('div');
      title.className = 'stats-label';
      title.textContent = 'Recent pulls (this account)';
      el.modelsHealthBody.appendChild(title);
      for (const entry of snap.pulls) {
        const item = document.createElement('div');
        item.className = 'muted';
        item.textContent = `${new Date(entry.at).toLocaleString()} — ${entry.detail}`;
        el.modelsHealthBody.appendChild(item);
      }
    }
  }

  el.modelsHealthBtn?.addEventListener('click', () => {
    el.modelsHealthOverlay.classList.remove('hidden');
    trackModalOpener();
    el.closeModelsHealthBtn.focus();
    renderModelsHealth();
  });
  el.modelsHealthRefreshBtn?.addEventListener('click', renderModelsHealth);
  el.closeModelsHealthBtn?.addEventListener('click', () => hideModal(el.modelsHealthOverlay));
  el.modelsHealthOverlay?.addEventListener('click', (e) => {
    if (e.target === el.modelsHealthOverlay) hideModal(el.modelsHealthOverlay);
  });

  // ---------- Model comparison (F4) ----------
  function openCompare() {
    el.compareModelList.innerHTML = '';
    el.compareResults.innerHTML = '';
    if (!models.length) {
      el.compareModelList.innerHTML = '<div class="muted">No models installed.</div>';
    } else {
      models.slice(0, 8).forEach((m, i) => {
        const label = document.createElement('label');
        label.className = 'checkbox-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = m.name;
        box.dataset.maxGuard = '1';
        box.addEventListener('change', () => {
          const checked = el.compareModelList.querySelectorAll('input:checked');
          if (checked.length >= 4) {
            for (const other of el.compareModelList.querySelectorAll('input:not(:checked)')) {
              other.disabled = true;
            }
          } else {
            for (const other of el.compareModelList.querySelectorAll('input')) {
              other.disabled = false;
            }
          }
        });
        if (i === 0) box.checked = true;
        label.appendChild(box);
        label.appendChild(document.createTextNode(` ${m.name}`));
        el.compareModelList.appendChild(label);
      });
    }
    el.compareOverlay.classList.remove('hidden');
    trackModalOpener();
    el.closeCompareBtn.focus();
  }

  el.compareBtn?.addEventListener('click', openCompare);
  el.closeCompareBtn?.addEventListener('click', () => hideModal(el.compareOverlay));
  el.compareOverlay?.addEventListener('click', (e) => {
    if (e.target === el.compareOverlay) hideModal(el.compareOverlay);
  });

  // Council mode (7.5): same modal as compare, but the endpoint also runs a
  // synthesis pass and the merged answer renders above the member columns.
  el.councilRunBtn?.addEventListener('click', async () => {
    const selected = [...el.compareModelList.querySelectorAll('input:checked')].map((b) => b.value);
    const prompt = el.comparePrompt.value.trim();
    if (selected.length < 2) {
      showError('Select at least two models for the council.');
      return;
    }
    if (!prompt) {
      showError('Enter a prompt to run the council on.');
      return;
    }
    el.councilRunBtn.disabled = true;
    el.compareResults.innerHTML = '<div class="muted">Convening the council… (every selected model answers, then a synthesis pass merges them)</div>';
    try {
      const data = await apiRequest('/api/council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selected,
          prompt,
          synthesizer: selected[0],
          options: { temperature: settings.temperature, top_p: settings.topP },
          serverId: settings.serverId || 0,
        }),
      });
      el.compareResults.innerHTML = '';
      if (data.synthesis) {
        const box = document.createElement('div');
        box.className = 'council-synthesis';
        const head = document.createElement('div');
        head.className = 'compare-head';
        head.textContent = `Council synthesis · ${data.synthesis.model}`;
        const body = document.createElement('div');
        body.className = 'msg-content';
        body.innerHTML = data.synthesis.error
          ? `<em class="muted">${data.synthesis.error}</em>`
          : renderMarkdown(data.synthesis.content || '_(empty)_');
        box.appendChild(head);
        box.appendChild(body);
        el.compareResults.appendChild(box);
      }
      for (const r of data.results || []) {
        const col = document.createElement('div');
        col.className = 'compare-col';
        const head = document.createElement('div');
        head.className = 'compare-head';
        const tps = r.evalCount && r.evalDuration
          ? ` · ${Math.round(r.evalCount / (r.evalDuration / 1e9))} tok/s`
          : '';
        head.textContent = `${r.model} · ${r.durationMs}ms${tps}`;
        const body = document.createElement('div');
        body.className = 'msg-content';
        body.innerHTML = r.error
          ? `<em class="muted">${r.error}</em>`
          : renderMarkdown(r.content || '_(empty)_');
        col.appendChild(head);
        col.appendChild(body);
        el.compareResults.appendChild(col);
      }
    } catch (err) {
      el.compareResults.innerHTML = '';
      showError(err.message);
    } finally {
      el.councilRunBtn.disabled = false;
    }
  });

  el.compareRunBtn?.addEventListener('click', async () => {
    const selected = [...el.compareModelList.querySelectorAll('input:checked')].map((b) => b.value);
    const prompt = el.comparePrompt.value.trim();
    if (selected.length < 2) {
      showError('Select at least two models to compare.');
      return;
    }
    if (!prompt) {
      showError('Enter a prompt to compare on.');
      return;
    }
    el.compareRunBtn.disabled = true;
    el.compareResults.innerHTML = '<div class="muted">Running…</div>';
    try {
      const data = await apiRequest('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selected,
          prompt,
          options: { temperature: settings.temperature, top_p: settings.topP },
          serverId: settings.serverId || 0,
        }),
      });
      el.compareResults.innerHTML = '';
      for (const r of data.results || []) {
        const col = document.createElement('div');
        col.className = 'compare-col';
        const head = document.createElement('div');
        head.className = 'compare-head';
        const tps = r.evalCount && r.evalDuration
          ? ` · ${Math.round(r.evalCount / (r.evalDuration / 1e9))} tok/s`
          : '';
        head.textContent = `${r.model} · ${r.durationMs}ms${tps}`;
        const body = document.createElement('div');
        body.className = 'msg-content';
        body.innerHTML = r.error
          ? `<em class="muted">${r.error}</em>`
          : renderMarkdown(r.content || '_(empty)_');
        col.appendChild(head);
        col.appendChild(body);
        el.compareResults.appendChild(col);
      }
    } catch (err) {
      el.compareResults.innerHTML = '';
      showError(err.message);
    } finally {
      el.compareRunBtn.disabled = false;
    }
  });

  // Fetches the auth-scoped full export (GET /api/export) and hands it to
  // the browser as a JSON download. Uses the raw fetch rather than
  // apiRequest because the response is the file itself, not a JSON envelope
  // with an error field.
  el.downloadDataBtn?.addEventListener('click', async () => {
    el.downloadDataBtn.disabled = true;
    try {
      const res = await fetch('/api/export');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const text = await res.text();
      // Parse once to fail fast on a broken response, then re-stringify to
      // rebuild the exact payload the server stamped (Content-Disposition
      // already carries the filename; the blob path needs one anyway).
      JSON.parse(text);
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      downloadBlob(match ? match[1] : 'ollama-chat-export.json', 'application/json', text);
    } catch (err) {
      showError(`Export failed: ${err.message}`);
    } finally {
      el.downloadDataBtn.disabled = false;
    }
  });

  // ---------- Usage report (Phase 7.20) ----------
  el.usageReportBtn?.addEventListener('click', async () => {
    el.usageReportBtn.disabled = true;
    el.usageReportBody.innerHTML = '<div class="muted">Crunching…</div>';
    try {
      const report = await apiRequest('/api/usage-report');
      el.usageReportBody.innerHTML = '';
      const t = report.totals || {};
      const rows = [
        ['Sessions', String(t.sessions ?? 0)],
        ['Messages', `${t.messages ?? 0} (${t.userMessages ?? 0} you, ${t.assistantMessages ?? 0} assistant)`],
        ['Estimated tokens (all time)', `~${formatTokens(t.estimatedTokens || 0)}`],
        ['Estimated tokens (last 7 days)', `~${formatTokens(t.estimatedTokensLastWeek || 0)}`],
        ['Models used', (report.byModel || []).map((m) => `${m.model} (${m.messages})`).join(', ') || '—'],
      ];
      for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'stats-row';
        const l = document.createElement('span');
        l.className = 'stats-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        el.usageReportBody.appendChild(row);
      }
      if ((report.topChats || []).length) {
        const title = document.createElement('div');
        title.className = 'stats-label';
        title.textContent = 'Largest chats';
        el.usageReportBody.appendChild(title);
        for (const c of report.topChats) {
          const item = document.createElement('div');
          item.className = 'muted';
          item.textContent = `${c.title} — ${c.messages} messages (~${formatTokens(c.estimatedTokens || 0)} tokens)`;
          el.usageReportBody.appendChild(item);
        }
      }
    } catch (err) {
      el.usageReportBody.innerHTML = '';
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `Usage report unavailable: ${err.message}`;
      el.usageReportBody.appendChild(note);
    } finally {
      el.usageReportBtn.disabled = false;
    }
  });

  // ---------- Scheduled session cleanup (Phase 7.18) ----------
  function cleanupCutoffDays() {
    const days = Number(el.cleanupDays.value);
    if (!Number.isFinite(days) || days < 1 || days > 3650 || !Number.isInteger(days)) {
      showError('"days" must be a whole number between 1 and 3650.');
      return null;
    }
    return days;
  }

  el.cleanupPreviewBtn?.addEventListener('click', async () => {
    const days = cleanupCutoffDays();
    if (days === null) return;
    el.cleanupPreviewBtn.disabled = true;
    el.cleanupPreviewBody.innerHTML = '<div class="muted">Counting…</div>';
    try {
      const data = await apiRequest(`/api/cleanup/preview?days=${days}`);
      el.cleanupPreviewBody.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'muted';
      head.textContent = data.count
        ? `${data.count} chat${data.count === 1 ? '' : 's'} not touched since ${new Date(data.cutoff).toLocaleDateString()}${data.sessions.length < data.count ? ` (showing ${data.sessions.length})` : ''}:`
        : 'Nothing to delete — no chats are that old.';
      el.cleanupPreviewBody.appendChild(head);
      for (const s of data.sessions) {
        const item = document.createElement('div');
        item.className = 'model-manage-item';
        item.textContent = `${s.title} — last touched ${new Date(s.updatedAt).toLocaleDateString()}`;
        el.cleanupPreviewBody.appendChild(item);
      }
    } catch (err) {
      el.cleanupPreviewBody.innerHTML = '';
      showError(err.message);
    } finally {
      el.cleanupPreviewBtn.disabled = false;
    }
  });

  el.cleanupRunBtn?.addEventListener('click', async () => {
    const days = cleanupCutoffDays();
    if (days === null) return;
    // The server refuses to delete without confirm:true; the double confirm
    // here is the human half of that guard.
    if (!confirm(`Delete every chat not touched in the last ${days} day(s)? This cannot be undone. Preview first if you're unsure.`)) return;
    el.cleanupRunBtn.disabled = true;
    try {
      const data = await apiRequest('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, confirm: true }),
      });
      el.cleanupPreviewBody.innerHTML = `<div class="muted">Deleted ${data.deleted} chat${data.deleted === 1 ? '' : 's'}.</div>`;
      await refreshChatList();
      if (activeChatId && !chats.some((c) => c.id === activeChatId)) {
        activeChatId = null;
        activeSession = null;
        if (chats.length) await selectChat(chats[0].id);
        renderChatList();
        renderMessages();
        updateTitle();
      } else {
        renderChatList();
      }
      await renderAudit();
    } catch (err) {
      showError(err.message);
    } finally {
      el.cleanupRunBtn.disabled = false;
    }
  });

  // ---------- Danger zone ----------
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
    loadPresets();
    loadTemplates();
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
    await loadServers();
    renderChatList();
    renderMessages();
    updateTitle();
    autoResizeTextarea();
    renderShortcutBar();
    updateOfflineQueueStatus();
    setInterval(async () => {
      try {
        const r = await fetch('/api/health');
      const d = await r.json();
      setStatus(d.ok, d.error);
      if (d.ok) flushOfflineQueue();   // server is back — drain queued sends
      } catch {
        setStatus(false, 'Ollama unreachable');
      }
    }, 15000);
  }

  init();

  // ---------- PWA registration (7.16) ----------
  // Fail-open by design: a rejected registration must never break the app.
  // Only register on https or localhost (file:// and plain-LAN http would
  // throw); the service worker itself never caches /api/* traffic.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const secure = window.isSecureContext || location.hostname === 'localhost';
      if (!secure) return;
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline shell unavailable — the app works unchanged without it */
      });
    });
  }
})();
