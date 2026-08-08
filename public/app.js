(() => {
  'use strict';

  // ---------- State ----------
  const STORAGE_KEY = 'ollama-chat:chats';
  const SETTINGS_KEY = 'ollama-chat:settings';

  let chats = loadChats();
  let activeChatId = chats.length ? chats[0].id : null;
  let settings = loadSettings();
  let models = [];
  let abortController = null;
  let sidebarCollapsed = false;
  let systemInfo = null; // { totalMemory, freeMemory }
  let pullController = null;

  // ---------- Elements ----------
  const el = {
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    chatList: document.getElementById('chatList'),
    newChatBtn: document.getElementById('newChatBtn'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    settingsBtn: document.getElementById('settingsBtn'),
    modelSelect: document.getElementById('modelSelect'),
    refreshModelsBtn: document.getElementById('refreshModelsBtn'),
    chatTitle: document.getElementById('chatTitle'),
    clearChatBtn: document.getElementById('clearChatBtn'),
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
    deleteAllBtn: document.getElementById('deleteAllBtn'),
    installedModelsList: document.getElementById('installedModelsList'),
    pullModelInput: document.getElementById('pullModelInput'),
    pullModelBtn: document.getElementById('pullModelBtn'),
    pullProgress: document.getElementById('pullProgress'),
    pullProgressFill: document.getElementById('pullProgressFill'),
    pullProgressText: document.getElementById('pullProgressText'),
    memoryWarning: document.getElementById('memoryWarning'),
  };

  // ---------- Persistence ----------
  function loadChats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveChats() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  }

  function defaultSettings() {
    return { systemPrompt: '', temperature: 0.8, topP: 0.9, numCtx: 4096, lastModel: '' };
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ---------- Chat helpers ----------
  function createChat() {
    const chat = {
      id: crypto.randomUUID(),
      title: 'New chat',
      model: el.modelSelect.value || settings.lastModel || '',
      messages: [],
      createdAt: Date.now(),
    };
    chats.unshift(chat);
    activeChatId = chat.id;
    saveChats();
    renderChatList();
    renderMessages();
    updateTitle();
  }

  function getActiveChat() {
    return chats.find((c) => c.id === activeChatId) || null;
  }

  function deleteChat(id, evt) {
    if (evt) evt.stopPropagation();
    chats = chats.filter((c) => c.id !== id);
    saveChats();
    if (activeChatId === id) {
      activeChatId = chats.length ? chats[0].id : null;
    }
    renderChatList();
    renderMessages();
    updateTitle();
  }

  function selectChat(id) {
    activeChatId = id;
    renderChatList();
    renderMessages();
    updateTitle();
    const chat = getActiveChat();
    if (chat && chat.model) el.modelSelect.value = chat.model;
  }

  function updateTitleFromFirstMessage(chat, text) {
    if (chat.title === 'New chat') {
      chat.title = text.slice(0, 48) + (text.length > 48 ? '…' : '');
    }
  }

  function updateTitle() {
    const chat = getActiveChat();
    el.chatTitle.textContent = chat ? chat.title : 'New chat';
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

      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Delete chat';
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
      if (/^\u0000CODE\d+\u0000$/.test(p.trim())) return p.trim();
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    });
    working = paragraphs.join('\n');

    working = working.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => {
      const { lang, code } = blocks[Number(idx)];
      const escaped = escapeHtml(code).replace(/\n$/, '');
      return `<div class="pre-wrap"><pre><code data-lang="${escapeHtml(lang)}">${escaped}</code></pre><button class="copy-btn" type="button">Copy</button></div>`;
    });

    return working;
  }

  function renderMessages() {
    el.messages.innerHTML = '';
    const chat = getActiveChat();

    if (!chat || !chat.messages.length) {
      el.messages.appendChild(el.emptyState);
      el.emptyState.classList.remove('hidden');
      refreshEmptyHint();
      return;
    }

    el.emptyState.classList.add('hidden');

    for (const msg of chat.messages) {
      el.messages.appendChild(buildMessageRow(msg));
    }
    scrollToBottom();
  }

  function refreshEmptyHint() {
    if (models.length) {
      el.emptyModelHint.textContent = `${models.length} model${models.length === 1 ? '' : 's'} available locally.`;
    } else {
      el.emptyModelHint.textContent = 'No local models found — pull one with "ollama pull <model>".';
    }
  }

  function buildMessageRow(msg) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (msg.role === 'user' ? 'user' : 'assistant');

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = msg.role === 'user' ? '🧑' : '🦙';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const role = document.createElement('div');
    role.className = 'msg-role';
    role.textContent = msg.role === 'user' ? 'You' : (msg.model || 'Assistant');

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = renderMarkdown(msg.content || '');

    body.appendChild(role);
    body.appendChild(content);

    if (msg.role === 'assistant' && msg.content) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = () => navigator.clipboard.writeText(msg.content);
      actions.appendChild(copyBtn);
      body.appendChild(actions);
    }

    row.appendChild(avatar);
    row.appendChild(body);
    return row;
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
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
        const preferred = getActiveChat()?.model || settings.lastModel;
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
    checkMemoryForSelectedModel();
  }

  function setStatus(ok, message) {
    el.statusDot.className = 'status-dot ' + (ok ? 'ok' : 'bad');
    el.statusText.textContent = ok ? 'Ollama connected' : (message || 'Ollama unreachable');
  }

  // ---------- System memory ----------
  async function loadSystemInfo() {
    try {
      const res = await fetch('/api/system');
      if (!res.ok) return;
      systemInfo = await res.json();
    } catch {
      systemInfo = null;
    }
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  // Warn (don't block) when the selected model's on-disk size is close to or
  // larger than currently free RAM — the scenario from the server-side
  // comment where a too-big model causes swap thrashing instead of a clean
  // out-of-memory error.
  function checkMemoryForSelectedModel() {
    if (!systemInfo || !el.modelSelect.value) {
      el.memoryWarning.classList.add('hidden');
      return;
    }
    const model = models.find((m) => m.name === el.modelSelect.value);
    if (!model || !model.size) {
      el.memoryWarning.classList.add('hidden');
      return;
    }
    const threshold = systemInfo.freeMemory * 0.85;
    if (model.size > threshold) {
      el.memoryWarning.textContent =
        `⚠ "${model.name}" is ${formatBytes(model.size)}, but only ${formatBytes(systemInfo.freeMemory)} RAM is free. ` +
        `It may run very slowly or cause heavy swapping.`;
      el.memoryWarning.classList.remove('hidden');
    } else {
      el.memoryWarning.classList.add('hidden');
    }
  }

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

    let chat = getActiveChat();
    if (!chat) {
      createChat();
      chat = getActiveChat();
    }
    chat.model = model;
    settings.lastModel = model;
    saveSettings();

    updateTitleFromFirstMessage(chat, text);
    chat.messages.push({ role: 'user', content: text });
    saveChats();
    renderChatList();
    renderMessages();
    updateTitle();

    el.promptInput.value = '';
    autoResizeTextarea();

    await streamAssistantReply(chat);
  });

  function buildOllamaMessages(chat) {
    const msgs = [];
    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      msgs.push({ role: 'system', content: settings.systemPrompt.trim() });
    }
    for (const m of chat.messages) {
      msgs.push({ role: m.role, content: m.content });
    }
    return msgs;
  }

  async function streamAssistantReply(chat) {
    const ollamaMessages = buildOllamaMessages(chat);

    const assistantMsg = { role: 'assistant', content: '', model: chat.model };
    chat.messages.push(assistantMsg);
    renderMessages();
    setSending(true);

    abortController = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model: chat.model,
          messages: ollamaMessages,
          options: {
            temperature: settings.temperature,
            top_p: settings.topP,
            num_ctx: settings.numCtx,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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
          if (json.message && typeof json.message.content === 'string') {
            assistantMsg.content += json.message.content;
            updateLastMessageContent(assistantMsg.content);
          }
          if (json.done) {
            // stream finished
          }
        }
      }

      saveChats();
      renderChatList();
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content += assistantMsg.content ? '\n\n_[stopped]_' : '_[stopped]_';
        updateLastMessageContent(assistantMsg.content);
      } else {
        showError(err.message);
        if (!assistantMsg.content) {
          chat.messages.pop();
          renderMessages();
        }
      }
      saveChats();
    } finally {
      setSending(false);
      abortController = null;
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
    banner.textContent = message;
    el.messages.appendChild(banner);
    scrollToBottom();
  }

  // ---------- Sidebar / chats ----------
  el.newChatBtn.addEventListener('click', createChat);
  el.clearChatBtn.addEventListener('click', () => {
    const chat = getActiveChat();
    if (!chat) return;
    chat.messages = [];
    chat.title = 'New chat';
    saveChats();
    renderChatList();
    renderMessages();
    updateTitle();
  });

  el.sidebarToggle.addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    el.app.classList.toggle('sidebar-collapsed', sidebarCollapsed);
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
    el.settingsOverlay.classList.remove('hidden');
  }

  function closeSettings() {
    settings.systemPrompt = el.systemPrompt.value;
    settings.temperature = Number(el.temperature.value);
    settings.topP = Number(el.topP.value);
    settings.numCtx = Number(el.numCtx.value) || 4096;
    saveSettings();
    el.settingsOverlay.classList.add('hidden');
  }

  el.settingsBtn.addEventListener('click', openSettings);
  el.closeSettingsBtn.addEventListener('click', closeSettings);
  el.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === el.settingsOverlay) closeSettings();
  });
  el.temperature.addEventListener('input', () => (el.tempValue.textContent = el.temperature.value));
  el.topP.addEventListener('input', () => (el.topPValue.textContent = el.topP.value));
  el.deleteAllBtn.addEventListener('click', () => {
    if (!confirm('Delete all chats? This cannot be undone.')) return;
    chats = [];
    activeChatId = null;
    saveChats();
    renderChatList();
    renderMessages();
    updateTitle();
    closeSettings();
  });

  el.modelSelect.addEventListener('change', checkMemoryForSelectedModel);

  // ---------- Init ----------
  async function init() {
    await loadSystemInfo();
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
