"use client";
/* Port of marketing/chat.js — the on-page assistant that talks straight to
   the visitor's own Ollama at 127.0.0.1:11434: streams NDJSON from
   /api/chat, lists installed models from /api/tags, fails plainly when
   Ollama isn't running. Same DOM shape/classes as the original so
   marketing.css styles it unchanged. */
import { useEffect, useRef, useState } from "react";

const OLLAMA = "http://127.0.0.1:11434";
const SYSTEM =
  "You are the on-page assistant for Ollama Chat, a local chat UI for " +
  "Ollama. Answer briefly and plainly. You run entirely on the visitor's " +
  "own machine; say so if it is relevant.";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({ state: "checking", text: "reaching 127.0.0.1:11434…" });
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [log, setLog] = useState([]); // {kind: user|asst|system|error, text}
  const [text, setText] = useState("");
  const historyRef = useRef([]);
  const controllerRef = useRef(null);
  const widgetRef = useRef(null);
  const logRef = useRef(null);
  const streamingRef = useRef(false);
  streamingRef.current = streaming;

  useEffect(() => {
    let dead = false;
    fetch(OLLAMA + "/api/tags")
      .then((r) => { if (!r.ok) throw new Error("tags " + r.status); return r.json(); })
      .then((data) => {
        if (dead) return;
        const list = (data.models || []).map((m) => m.name);
        if (!list.length) {
          setStatus({ state: "error", text: "no models pulled — run: ollama pull llama3" });
          setLog((l) => [...l, { kind: "system", text: "Ollama is up but has no models. Pull one (ollama pull llama3), then reload this chat." }]);
          return;
        }
        const preferred = list.filter((n) => /1b|3b|mini/.test(n))[0] || list[0];
        setModels(list);
        setModel(preferred);
        setStatus({ state: "ok", text: preferred + " · on this machine" });
        setLog((l) => [...l, { kind: "system", text: "Connected to your local Ollama (" + preferred + "). Ask anything — it never leaves this machine." }]);
      })
      .catch(() => {
        if (dead) return;
        setStatus({ state: "error", text: "Ollama not reachable at 127.0.0.1:11434" });
        setLog((l) => [...l, { kind: "system", text: "Ollama isn’t reachable right now. Start it (ollama serve, or the desktop app) and reload this chat." }]);
      });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, streaming]);

  function submit(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    setLog((l) => [...l, { kind: "user", text: value }]);
    historyRef.current.push({ role: "user", content: value });
    stream();
  }

  function stream() {
    setStreaming(true);
    controllerRef.current = new AbortController();
    fetch(OLLAMA + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model, messages: [{ role: "system", content: SYSTEM }].concat(historyRef.current), stream: true }),
      signal: controllerRef.current.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("chat " + res.status);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "", full = "";
        function pump() {
          return reader.read().then((chunk) => {
            if (chunk.done) return full;
            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            lines.forEach((line) => {
              const trimmed = line.trim();
              if (!trimmed) return;
              try {
                const parsed = JSON.parse(trimmed);
                const piece = parsed.message && parsed.message.content;
                if (piece) {
                  full += piece;
                  setLog((l) => {
                    const last = l[l.length - 1];
                    if (last && last.kind === "asst") {
                      return [...l.slice(0, -1), { kind: "asst", text: last.text + piece }];
                    }
                    return [...l, { kind: "asst", text: piece }];
                  });
                }
              } catch (err) { /* partial line — next chunk completes it */ }
            });
            return pump();
          });
        }
        return pump();
      })
      .then((full) => {
        if (full) historyRef.current.push({ role: "assistant", content: full });
        else setLog((l) => [...l, { kind: "error", text: "The request to your local Ollama failed. Is it running (ollama serve)?" }]);
        controllerRef.current = null;
        setStreaming(false);
      })
      .catch((err) => {
        const stopped = err && err.name === "AbortError";
        if (stopped) setLog((l) => [...l, { kind: "system", text: "Generation stopped." }]);
        else setLog((l) => [...l, { kind: "error", text: "The request to your local Ollama failed. Is it running (ollama serve)?" }]);
        controllerRef.current = null;
        setStreaming(false);
      });
  }

  return (
    <div className={"chat-widget" + (open ? " is-open" : "")} ref={widgetRef}>
      <button
        className="chat-launcher"
        id="chatLauncher"
        type="button"
        aria-label="Open chat with your local Ollama"
        aria-expanded={open ? "true" : "false"}
        aria-controls="chatPanel"
        onClick={() => setOpen(!open)}
      >
        <svg className="chat-glyph-open" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3.5c-4.9 0-8.5 3.3-8.5 7.6 0 2 .8 3.8 2.1 5.1-.2 1.2-.7 2.4-1.6 3.3 1.6-.1 3.1-.7 4.2-1.4 1.1.4 2.4.6 3.8.6 4.9 0 8.5-3.3 8.5-7.6S16.9 3.5 12 3.5Z" />
        </svg>
        <svg className="chat-glyph-close" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <section className="chat-panel" id="chatPanel" aria-label="Chat with your local Ollama" hidden={!open}>
        <header className="chat-head">
          <span className="chat-status" data-state={status.state} aria-hidden="true"></span>
          <div className="chat-head-text">
            <p className="chat-title">Local chat</p>
            <p className="chat-sub mono">{status.text}</p>
          </div>
          <label className="sr-only" htmlFor="chatModel">Model</label>
          <select className="chat-model mono" id="chatModel" value={model} disabled={!models.length}
                  onChange={(e) => { setModel(e.target.value); setStatus({ state: "ok", text: e.target.value + " · on this machine" }); }}>
            {models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className="chat-close" id="chatClose" type="button" aria-label="Close chat" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="chat-log" id="chatLog" ref={logRef}>
          {log.map((m, i) => (
            <div key={i} className={"chat-msg chat-msg-" + (m.kind === "asst" ? "asst" : m.kind)}>
              {m.kind === "user"
                ? <div className="chat-bubble">{m.text}</div>
                : <p className="chat-prose">{m.text}</p>}
            </div>
          ))}
        </div>

        <form className="chat-form" id="chatForm" onSubmit={submit}>
          <label className="sr-only" htmlFor="chatInput">Message your local model</label>
          <input className="chat-input" id="chatInput" type="text" placeholder="Ask your local model…"
                 autoComplete="off" enterKeyHint="send" value={text}
                 disabled={streaming} onChange={(e) => setText(e.target.value)} />
          <button className="chat-send" id="chatSend" type="submit" aria-label="Send message" disabled={streaming}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 12.5v-9M8 3.5 4.5 7M8 3.5 11.5 7" /></svg>
          </button>
          <button className="chat-stop" id="chatStop" type="button" hidden={!streaming}
                  onClick={() => controllerRef.current && controllerRef.current.abort()}>Stop</button>
        </form>
        <p className="chat-foot mono">runs on your machine — nothing leaves it</p>
      </section>
    </div>
  );
}
