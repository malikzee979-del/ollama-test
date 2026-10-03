/* ==========================================================================
   Ollama Chat — marketing site chat widget
   A small composer on the page that talks straight to the visitor's own
   Ollama at 127.0.0.1:11434 (CORS-permissive by Ollama's design): streams
   NDJSON from /api/chat, lists installed models from /api/tags, and fails
   plainly when Ollama isn't running. No proxy, no account, no cloud —
   the same promise as the product itself.
   ========================================================================== */
(function () {
  "use strict";

  var OLLAMA = "http://127.0.0.1:11434";
  var SYSTEM =
    "You are the on-page assistant for Ollama Chat, a local chat UI for " +
    "Ollama. Answer briefly and plainly. You run entirely on the visitor's " +
    "own machine; say so if it is relevant.";

  var widget = document.querySelector(".chat-widget");
  var launcher = document.getElementById("chatLauncher");
  var panel = document.getElementById("chatPanel");
  var closeBtn = document.getElementById("chatClose");
  var statusDot = document.getElementById("chatStatus");
  var sub = document.getElementById("chatSub");
  var modelSel = document.getElementById("chatModel");
  var log = document.getElementById("chatLog");
  var form = document.getElementById("chatForm");
  var input = document.getElementById("chatInput");
  var sendBtn = document.getElementById("chatSend");
  var stopBtn = document.getElementById("chatStop");

  var history = [];
  var controller = null;
  var streaming = false;
  var greeted = false;

  /* ------------------------------------------------------- open / close */
  function isOpen() { return widget.classList.contains("is-open"); }

  function setOpen(open) {
    widget.classList.toggle("is-open", open);
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      window.setTimeout(function () { input.focus(); }, 80);
    } else {
      launcher.focus();
    }
  }
  launcher.addEventListener("click", function () { setOpen(!isOpen()); });
  closeBtn.addEventListener("click", function () { setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) setOpen(false);
  });

  /* ------------------------------------------------------------ helpers */
  function setStatus(state, text) {
    statusDot.setAttribute("data-state", state);
    sub.textContent = text;
  }
  function pin() { log.scrollTop = log.scrollHeight; }

  function addMsg(kind) {
    var wrap = document.createElement("div");
    wrap.className = "chat-msg chat-msg-" + kind;
    log.appendChild(wrap);
    pin();
    return wrap;
  }
  function addUser(text) {
    var wrap = addMsg("user");
    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);
  }
  function addSystem(text) {
    var wrap = addMsg("system");
    var prose = document.createElement("p");
    prose.className = "chat-prose";
    prose.textContent = text;
    wrap.appendChild(prose);
  }
  function addError(text) {
    var wrap = addMsg("error");
    var prose = document.createElement("p");
    prose.className = "chat-prose";
    prose.textContent = text;
    wrap.appendChild(prose);
  }
  function addAssistant() {
    var wrap = addMsg("asst");
    var prose = document.createElement("p");
    prose.className = "chat-prose";
    var caret = document.createElement("span");
    caret.className = "chat-caret";
    caret.setAttribute("aria-hidden", "true");
    prose.appendChild(caret);
    wrap.appendChild(prose);
    return { prose: prose, caret: caret };
  }

  /* -------------------------------------------------------- model list */
  function loadModels() {
    fetch(OLLAMA + "/api/tags")
      .then(function (res) {
        if (!res.ok) throw new Error("tags " + res.status);
        return res.json();
      })
      .then(function (data) {
        var models = (data.models || []).map(function (m) { return m.name; });
        if (!models.length) {
          setStatus("error", "no models pulled — run: ollama pull llama3");
          addSystem("Ollama is up but has no models. Pull one (ollama pull llama3), then reload this chat.");
          return;
        }
        models.forEach(function (name) {
          var opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          modelSel.appendChild(opt);
        });
        // prefer a small model so the on-page demo answers quickly
        var preferred = models.filter(function (n) { return /1b|3b|mini/.test(n); })[0] || models[0];
        modelSel.value = preferred;
        modelSel.disabled = false;
        setStatus("ok", preferred + " · on this machine");
        if (!greeted) {
          greeted = true;
          addSystem("Connected to your local Ollama (" + preferred + "). Ask anything — it never leaves this machine.");
        }
      })
      .catch(function () {
        setStatus("error", "Ollama not reachable at 127.0.0.1:11434");
        if (!greeted) {
          greeted = true;
          addSystem("Ollama isn’t reachable right now. Start it (ollama serve, or the desktop app) and reload this chat.");
        }
      });
  }
  loadModels();

  modelSel.addEventListener("change", function () {
    setStatus("ok", modelSel.value + " · on this machine");
  });

  /* ------------------------------------------------------ streaming chat */
  function setStreaming(on) {
    streaming = on;
    sendBtn.disabled = on;
    input.disabled = on;
    stopBtn.hidden = !on;
    if (!on) input.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || streaming) return;
    input.value = "";
    addUser(text);
    history.push({ role: "user", content: text });
    stream();
  });

  stopBtn.addEventListener("click", function () {
    if (controller) controller.abort();
  });

  function stream() {
    setStreaming(true);
    var slot = addAssistant();
    var full = "";
    controller = new AbortController();

    var messages = [{ role: "system", content: SYSTEM }].concat(history);

    fetch(OLLAMA + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSel.value, messages: messages, stream: true }),
      signal: controller.signal
    })
      .then(function (res) {
        if (!res.ok) throw new Error("chat " + res.status);
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";

        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) return;
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop();
            lines.forEach(function (line) {
              var trimmed = line.trim();
              if (!trimmed) return;
              try {
                var parsed = JSON.parse(trimmed);
                var piece = parsed.message && parsed.message.content;
                if (piece) {
                  full += piece;
                  slot.caret.insertAdjacentText("beforebegin", piece);
                  pin();
                }
              } catch (err) { /* partial line — next chunk completes it */ }
            });
            return pump();
          });
        }
        return pump();
      })
      .then(function () {
        finish(false);
      })
      .catch(function (err) {
        finish(err && err.name === "AbortError");
      });

    function finish(stopped) {
      if (slot.caret.parentNode) slot.caret.parentNode.removeChild(slot.caret);
      if (full) {
        history.push({ role: "assistant", content: full });
        if (stopped) addSystem("Generation stopped.");
      } else if (stopped) {
        slot.prose.textContent = "";
        addSystem("Stopped before any output arrived.");
      } else {
        slot.prose.textContent = "";
        addError("The request to your local Ollama failed. Is it running (ollama serve)?");
      }
      controller = null;
      setStreaming(false);
      pin();
    }
  }
})();
