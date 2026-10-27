"""Ollama Chat — Python port of server.js (full parity).

A local web chat UI proxy for Ollama models. FastAPI + httpx; run with:

    uvicorn main:app --port 4173     # from the python_server/ directory
    # or: python main.py

Route-for-route and behavior-for-behavior equivalent to the Node.js
server.js at the repo root: same env vars, same response shapes, same
host-header guard, per-user scoping, fail-open memory/compaction, and
ndjson streaming proxy.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, unquote

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import auth
import db
import embeddings as embeddings_module
import logger
import metrics
import qdrant_store as qdrant
from compaction import MARKER as COMPACTION_MARKER
from compaction import compact_messages

app = FastAPI()
PORT = int(os.environ.get("PORT") or 4173)
OLLAMA_HOST = os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434"

# Chat compaction settings — see README.md "Chat compaction" section.
COMPACTION_MAX_MESSAGES = int(os.environ.get("COMPACTION_MAX_MESSAGES") or 0) or 40
COMPACTION_MAX_CHARS = int(os.environ.get("COMPACTION_MAX_CHARS") or 0) or 24000
COMPACTION_KEEP_RECENT = int(os.environ.get("COMPACTION_KEEP_RECENT") or 0) or 8
COMPACTION_MODEL = os.environ.get("COMPACTION_MODEL") or None

# Size caps for PATCH /api/sessions/:id bodies, beyond the global 10mb JSON
# limit — bounds how large a single session/title/message can grow.
MAX_SESSION_TITLE_CHARS = 200
MAX_SESSION_MESSAGES = 1000
MAX_MESSAGE_CONTENT_CHARS = 1000000

# Batch/size caps for /api/memory/index.
MAX_MEMORY_BATCH = 100
MAX_MEMORY_TEXT_CHARS = 100000

# Semantic-memory retrieval for /api/chat, behind the opt-in `useMemory`
# request flag. Top-k excerpts are injected as one system message and the
# completed turn is auto-indexed afterwards; both paths fail open so a
# Qdrant/embeddings outage never breaks normal chat.
MEMORY_TOP_K = int(os.environ.get("MEMORY_TOP_K") or 0) or 5
MEMORY_TIMEOUT_MS = int(os.environ.get("MEMORY_TIMEOUT_MS") or 0) or 3000
MEMORY_MARKER = "[retrieved-memory]"

# Ollama's non-streaming summarization call has no inherent timeout; without
# one, a hung Ollama would stall the otherwise-streaming /api/chat request
# indefinitely before the real response even starts.
COMPACTION_TIMEOUT_MS = int(os.environ.get("COMPACTION_TIMEOUT_MS") or 0) or 30000

MAX_BODY_BYTES = 10 * 1024 * 1024  # express.json's 10mb limit

_shared_http = httpx.AsyncClient(timeout=None)


# Calls Ollama's non-streaming chat endpoint to produce a concise summary
# of a slice of older messages. Injected into compact_messages() so the
# compaction logic itself stays free of any HTTP/Ollama specifics.
async def summarize_with_ollama(messages_to_summarize, model: str) -> str:
    summary_model = COMPACTION_MODEL or model
    try:
        r = await _shared_http.post(
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model": summary_model,
                "stream": False,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Summarize the following conversation turns concisely and factually. "
                            "Capture key facts, decisions made, and any unresolved questions. "
                            "Do not add commentary or restate this instruction; output only the summary."
                        ),
                    },
                    *messages_to_summarize,
                ],
            },
            timeout=COMPACTION_TIMEOUT_MS / 1000,
        )
    except (httpx.TimeoutException, asyncio.TimeoutError):
        raise RuntimeError(
            f"Ollama summarization timed out after {COMPACTION_TIMEOUT_MS}ms."
        ) from None
    if not r.is_success:
        raise RuntimeError(
            f"Ollama summarization request failed (status {r.status_code}): {r.text}"
        )
    data = r.json()
    if isinstance(data, dict):
        return (data.get("message") or {}).get("content") or ""
    return ""


# Host-header guard. A page on another origin can make this server's
# cookie-authenticated endpoints fire cross-origin via DNS rebinding.
# Rejecting any Host outside loopback closes that; additional hosts go in
# HOST_ALLOWLIST as a comma-separated list.
HOST_ALLOWLIST = {
    h.strip().lower()
    for h in (os.environ.get("HOST_ALLOWLIST") or "").split(",")
    if h.strip()
}


def is_allowed_host(host_header) -> bool:
    if not isinstance(host_header, str) or not host_header.strip():
        return False
    host = host_header.strip().lower()
    # Strip the port. IPv6 arrives bracketed ("[::1]:4173"); for anything
    # else only strip a trailing :port when the remainder is colon-free,
    # so an unbracketed "::1" survives intact.
    if host.startswith("["):
        end = host.find("]")
        if end != -1:
            host = host[1:end]
    else:
        m = re.match(r"^(.+):(\d+)$", host)
        if m and ":" not in m.group(1):
            host = m.group(1)
    if host in ("localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"):
        return True
    return host in HOST_ALLOWLIST


# --- Auth helpers (local, SQLite-backed) ---------------------------------
# No cookie-parser dependency: cookies are simple enough to parse by hand.


def parse_cookies(request: Request) -> dict:
    header = request.headers.get("cookie")
    cookies = {}
    if not header:
        return cookies
    for pair in header.split(";"):
        idx = pair.find("=")
        if idx == -1:
            continue
        name = pair[:idx].strip()
        value = pair[idx + 1:].strip()
        if name:
            # A malformed percent-encoding (e.g. `Cookie: sid=%`) must not
            # turn every request into a 500, so skip the malformed pair.
            try:
                cookies[name] = unquote(value)
            except Exception:
                pass  # A bad value is indistinguishable from absent.
    return cookies


def set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    parts = [
        f"{auth.SESSION_COOKIE}={quote(token)}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Expires={expires_at.strftime('%a, %d %b %Y %H:%M:%S GMT')}",
    ]
    # Only mark the cookie Secure when actually served over HTTPS — this app
    # runs over plain HTTP on localhost by default, and Secure would stop
    # the browser from ever sending the cookie back in that case.
    if os.environ.get("COOKIE_SECURE") == "1":
        parts.append("Secure")
    response.headers["Set-Cookie"] = "; ".join(parts)


def clear_session_cookie(response: Response) -> None:
    response.headers["Set-Cookie"] = (
        f"{auth.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; "
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    )


# Simple in-memory fixed-window rate limiter, keyed by client IP. Guards
# the auth endpoints (brute-forcing a password, or hammering signup) and
# the model-management / memory-index routes (pulling is expensive on the
# host, and indexing should stay bounded). Deliberately dependency-free;
# resets on restart, which is fine for its purpose.


class RateLimiter:
    def __init__(self, *, window_ms: int, max: int):
        self.window_ms = window_ms
        self.max = max
        self.hits: dict[str, list[float]] = {}  # ip -> [timestamps]
        self.last_sweep = 0.0

    def check(self, ip: str) -> dict:
        """Return {} to allow, or {'retryAfterSec': int} to reject."""
        now = time.time() * 1000
        # Opportunistic sweep, at most once per window: a key whose last
        # request is long gone would otherwise sit in `hits` forever.
        if now - self.last_sweep > self.window_ms:
            self.last_sweep = now
            for key, stamps in list(self.hits.items()):
                alive = [t for t in stamps if now - t < self.window_ms]
                if alive:
                    self.hits[key] = alive
                else:
                    del self.hits[key]
        timestamps = [t for t in self.hits.get(ip, []) if now - t < self.window_ms]
        if len(timestamps) >= self.max:
            return {
                "retryAfterSec": -(-int(self.window_ms - (now - timestamps[0])) // 1000)
            }
        timestamps.append(now)
        self.hits[ip] = timestamps
        return {}


auth_rate_limiter = RateLimiter(window_ms=5 * 60 * 1000, max=10)

# Looser limits for the model-management and memory routes: pulling a model
# downloads gigabytes onto the host (the most expensive action this app can
# trigger), deleting is destructive, and memory indexing embeds + upserts
# per item.
model_pull_rate_limiter = RateLimiter(window_ms=15 * 60 * 1000, max=5)
model_delete_rate_limiter = RateLimiter(window_ms=5 * 60 * 1000, max=10)
memory_index_rate_limiter = RateLimiter(window_ms=5 * 60 * 1000, max=20)


def client_ip(request: Request) -> str:
    return (request.client.host if request.client else None) or "unknown"


def _check_rate(limiter: RateLimiter, request: Request) -> JSONResponse | None:
    result = limiter.check(client_ip(request))
    if result:
        response = err_response(429, "Too many attempts. Please wait and try again.")
        response.headers["Retry-After"] = str(result["retryAfterSec"])
        return response
    return None


def err_response(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


class BodyError(Exception):
    pass


def json_body(request: Request) -> dict:
    """Parsed JSON body from the raw bytes the middleware read — guaranteed
    to be a dict, mirroring `req.body || {}` in server.js."""
    body = getattr(request.state, "json_body", None)
    if body is None:
        raw = getattr(request.state, "raw_body", b"") or b"{}"
        try:
            body = json.loads(raw)
        except ValueError:
            raise BodyError("Invalid JSON body.")
        request.state.json_body = body
    if not isinstance(body, dict):
        raise BodyError("Invalid JSON body.")
    return body


# --- Central middleware ------------------------------------------------------
# One explicit function doing, in order, exactly what server.js's app.use
# chain does: request-id + logging/metrics (outermost, so rejections are
# still logged), host guard, body read (10mb cap), auth context, and the
# everything-below-requires-a-session gate.


PUBLIC_ASSETS = {"/login.html", "/signup.html", "/auth.js", "/style.css"}


@app.middleware("http")
async def pipeline(request: Request, call_next):
    # 1. Request logging + metrics. Never touches response bodies — only
    # attaches a request id and records method/path/status/duration.
    request_id = secrets.token_hex(6)
    started_ns = time.perf_counter_ns()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        duration_ms = (time.perf_counter_ns() - started_ns) / 1e6
        route = request.scope.get("route")
        route_path = getattr(route, "path", None) or request.url.path
        logger.info(f"{request.method} {route_path} {status} {duration_ms:.1f}ms id={request_id}")
        metrics.record(
            route=route_path, method=request.method, status=status, duration_ms=duration_ms
        )

    # 2. Host guard. Registered right after logging so rejections are still
    # logged, and before cookie parsing / every route.
    # (Handled below in-gate because call_next already ran — see note.)

    return response


@app.middleware("http")
async def gate(request: Request, call_next):
    # Host guard first.
    if not is_allowed_host(request.headers.get("host")):
        host = request.headers.get("host") or "(missing)"
        return err_response(
            403,
            f'Host "{host}" is not allowed. Add it to HOST_ALLOWLIST if this is intentional.',
        )

    # Read the raw body once (up to 10mb) so routes can share it.
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BODY_BYTES:
                return err_response(413, "Request body too large.")
            chunks.append(chunk)
        request.state.raw_body = b"".join(chunks)
    else:
        request.state.raw_body = b""

    # Auth context: attach the user (or None) based on the session cookie.
    cookies = parse_cookies(request)
    token = cookies.get(auth.SESSION_COOKIE)
    request.state.session_token = token
    user = auth.get_user_by_session_token(token) if token else None
    request.state.user = user
    path = request.url.path

    # Auth gate: everything below this point (both pages and API routes)
    # requires a logged-in session, except the static assets needed to
    # render the login/signup pages themselves and the /api/auth/* routes.
    is_public_font = path.startswith("/fonts/") and path.endswith(".woff2")
    if path in ("/", "/index.html") and not user:
        return RedirectResponse("/login.html", status_code=302)
    if not (user or path.startswith("/api/auth/") or path in PUBLIC_ASSETS or is_public_font):
        if path.startswith("/api/"):
            return err_response(401, "Authentication required.")
        return RedirectResponse("/login.html", status_code=302)

    return await call_next(request)


# --- Message shape checks ----------------------------------------------------
# A chat message is valid if role/content are strings and — when present —
# `images` is an array of non-empty base64 strings (Ollama's vision input
# shape; empty strings would be forwarded upstream and rejected by Ollama
# with an opaque error, so they're rejected here with a clear one).


def is_valid_images(imgs) -> bool:
    return (
        isinstance(imgs, list)
        and len(imgs) > 0
        and all(isinstance(i, str) and len(i) > 0 for i in imgs)
    )


def is_valid_message(m) -> bool:
    return (
        isinstance(m, dict)
        and isinstance(m.get("role"), str)
        and isinstance(m.get("content"), str)
        and (m.get("images") is None or is_valid_images(m["images"]))
    )


# --- Streaming ndjson proxy ---------------------------------------------------
# Shared plumbing for the two ndjson streaming proxies (/api/chat and
# /api/pull): fetches the upstream Ollama endpoint, validates the response,
# sets the ndjson headers, and pumps chunks through as they arrive. Routes
# customize via `on_chunk`/`on_done` observers — e.g. /api/chat accumulates
# the assistant reply for memory auto-indexing. Client disconnects tear the
# upstream response down via aclose(); mid-stream write errors are swallowed
# (the EPIPE guard from server.js).


class NdjsonStream(StreamingResponse):
    def __init__(self, generator, *, headers=None):
        super().__init__(
            generator,
            status_code=200,
            media_type="application/x-ndjson",
            headers=headers or {},
        )


async def pipe_upstream_ndjson(request: Request, *, path: str, body: dict, on_chunk=None, on_done=None):
    try:
        response = await _shared_http.send(
            _shared_http.build_request("POST", f"{OLLAMA_HOST}{path}", json=body),
            stream=True,
        )
    except Exception as e:
        if await request.is_disconnected():
            return {"aborted": True}
        return err_response(503, f"Cannot reach Ollama at {OLLAMA_HOST}: {e}")

    if not response.is_success:
        try:
            text = response.text
        except Exception:
            text = ""
        status = response.status_code or 502
        await response.aclose()
        return JSONResponse(status_code=status, content={"error": text or "Upstream error from Ollama."})

    async def streamer():
        try:
            async for chunk in response.aiter_bytes():
                if on_chunk is not None:
                    on_chunk(chunk)
                yield chunk
        except Exception:
            pass  # Client likely disconnected or upstream dropped.
        finally:
            await response.aclose()
            if on_done is not None:
                try:
                    result = on_done()
                    if hasattr(result, "__await__"):
                        asyncio.ensure_future(result)
                except Exception as e:
                    logger.warn("[memory] on_done failed:", str(e))

    return NdjsonStream(
        streamer(),
        headers={
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# --- Auth routes -----------------------------------------------------------

@app.post("/api/auth/signup")
async def signup(request: Request):
    if gate_resp := _check_rate(auth_rate_limiter, request):
        return gate_resp
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")

    try:
        user = auth.create_user(body.get("username"), body.get("password"))
        session = auth.create_session(user["id"])
        response = JSONResponse(status_code=201, content={"user": user})
        set_session_cookie(response, session["token"], session["expiresAt"])
        return response
    except auth.AuthError as e:
        return err_response(400, str(e))


@app.post("/api/auth/login")
async def login(request: Request):
    if gate_resp := _check_rate(auth_rate_limiter, request):
        return gate_resp
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")

    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return err_response(400, 'Missing "username" or "password".')

    ip = client_ip(request)
    # Per-username+IP lockout (see auth.py): the per-IP limiter can't see a
    # single-username spray from many IPs. Check before touching the DB so
    # a locked pair burns no scrypt work either.
    lock = auth.login_lock_remaining(username, ip)
    if lock:
        response = err_response(
            429, "Too many failed attempts for this account. Please wait and try again."
        )
        response.headers["Retry-After"] = str(lock["retryAfterSec"])
        return response

    user = auth.verify_user(username, password)
    if not user:
        auth.record_login_failure(username, ip)
        return err_response(401, "Invalid username or password.")

    # Successful login clears the pair's history so spaced-out failures
    # never accumulate into a lock.
    auth.clear_login_failures(username, ip)
    session = auth.create_session(user["id"])
    response = JSONResponse(content={"user": user})
    set_session_cookie(response, session["token"], session["expiresAt"])
    return response


@app.post("/api/auth/logout")
async def logout(request: Request):
    token = request.state.session_token
    if token:
        auth.delete_session(token)
    response = JSONResponse(content={"ok": True})
    clear_session_cookie(response)
    return response


@app.get("/api/auth/me")
async def me(request: Request):
    return {"user": request.state.user or None}


# --- Health, metrics, models ------------------------------------------------

@app.get("/api/health")
async def health():
    try:
        r = await _shared_http.get(f"{OLLAMA_HOST}/api/version")
        if not r.is_success:
            raise RuntimeError(f"status {r.status_code}")
        return {"ok": True, "ollama": r.json()}
    except Exception as e:
        return err_response(503, f"Cannot reach Ollama at {OLLAMA_HOST}: {e}")


@app.get("/api/metrics")
async def get_metrics():
    return metrics.snapshot()


@app.get("/api/models")
async def list_models():
    try:
        r = await _shared_http.get(f"{OLLAMA_HOST}/api/tags")
        if not r.is_success:
            raise RuntimeError(f"status {r.status_code}")
        return r.json()
    except Exception as e:
        return err_response(503, f"Cannot reach Ollama at {OLLAMA_HOST}: {e}")


@app.post("/api/show")
async def show(request: Request):
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")
    model = body.get("model")
    if not isinstance(model, str) or not model.strip():
        return err_response(400, 'Missing "model" in request body.')
    try:
        r = await _shared_http.post(f"{OLLAMA_HOST}/api/show", json={"model": model})
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception as e:
        return err_response(503, str(e))


@app.post("/api/chat")
async def chat(request: Request):
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")

    model = body.get("model")
    messages = body.get("messages")
    options = body.get("options")
    keep_alive = body.get("keep_alive")
    use_memory = body.get("useMemory")

    if not model:
        return err_response(400, 'Missing "model" in request body.')
    if not isinstance(messages, list):
        return err_response(400, '"messages" must be an array.')
    if not all(is_valid_message(m) for m in messages):
        return err_response(
            400, 'Each item in "messages" must have string "role" and "content".'
        )

    # Pre-process the outgoing messages: if the conversation has grown too
    # large, fold older turns into a compact summary before forwarding to
    # Ollama. Purely a transformation of the `messages` array sent upstream
    # — it does not touch or alter the streaming response below.
    compacted_messages = await compact_messages(
        messages=messages,
        keep_recent=COMPACTION_KEEP_RECENT,
        max_messages=COMPACTION_MAX_MESSAGES,
        max_chars=COMPACTION_MAX_CHARS,
        summarize=lambda msgs: summarize_with_ollama(msgs, model),
    )

    # compact_messages() returns the original list object untouched when it
    # decides not to compact (or when summarization fails open), so an
    # identity check is exactly "did older turns get folded into a summary".
    # Surfaced as a response header so the UI can tell the user their
    # earlier context was summarized rather than silently dropped.
    was_compacted = compacted_messages is not messages

    # Opt-in semantic memory retrieval (useMemory). Embed the latest user
    # message, search this user's indexed memory, and inject the top-k
    # excerpts as one system message. Entirely fail-open, mirroring
    # compaction: any retrieval failure — Qdrant down, embeddings model
    # missing, timeout — is logged and the chat proceeds without memory.
    user = request.state.user
    messages_to_send = compacted_messages
    last_user = next(
        (
            m
            for m in reversed(messages)
            if isinstance(m, dict)
            and m.get("role") == "user"
            and m.get("content", "").strip()
        ),
        None,
    )

    if use_memory is True and user and last_user:
        try:
            results = await asyncio.wait_for(
                _retrieve_memory(last_user["content"], user["id"]),
                timeout=MEMORY_TIMEOUT_MS / 1000,
            )
            excerpts = []
            for r in results if isinstance(results, list) else []:
                text = (r.get("payload") or {}).get("text") if isinstance(r, dict) else None
                if isinstance(text, str) and text.strip():
                    excerpts.append(f"- {text[:2000]}…" if len(text) > 2000 else f"- {text}")
            if excerpts:
                memory_content = (
                    f"{MEMORY_MARKER} Earlier messages from this user's past chats that look relevant "
                    "to the latest question (semantic search; may be imperfect):\n"
                    + "\n".join(excerpts)
                )
                messages_to_send = inject_memory_message(messages_to_send, memory_content)
        except Exception as e:
            logger.warn("[memory] retrieval failed, continuing without memory:", str(e))

    # on_chunk accumulates the assistant's reply from the ndjson stream
    # (parse errors are ignored — indexing is best-effort) so the completed
    # turn can be auto-indexed below, exactly like a manual
    # /api/memory/index call would.
    ndjson_buffer = bytearray()
    assistant_text = {"text": ""}

    def on_chunk(value: bytes) -> None:
        ndjson_buffer.extend(value)
        while True:
            nl = ndjson_buffer.find(b"\n")
            if nl == -1:
                break
            line = bytes(ndjson_buffer[:nl])
            del ndjson_buffer[: nl + 1]
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
                if (
                    isinstance(obj, dict)
                    and isinstance(obj.get("message"), dict)
                    and isinstance(obj["message"].get("content"), str)
                ):
                    assistant_text["text"] += obj["message"]["content"]
            except ValueError:
                pass  # Partial or malformed line — indexing is best-effort.

    def auto_index_completed_turn():
        if use_memory is not True or not user or not last_user:
            return
        items = [{"text": last_user["content"], "metadata": {"role": "user"}}]
        if assistant_text["text"].strip():
            items.append({"text": assistant_text["text"], "metadata": {"role": "assistant"}})

        async def _index():
            try:
                await index_memory_items(items, user["id"])
            except Exception as e:
                logger.warn("[memory] auto-index failed:", str(e))

        asyncio.ensure_future(_index())

    headers = {}
    if was_compacted:
        # X-Compacted must be set before the first byte is written.
        headers["X-Compacted"] = "true"

    result = await pipe_upstream_ndjson(
        request,
        path="/api/chat",
        body={
            "model": model,
            "messages": messages_to_send,
            "options": options,
            "keep_alive": keep_alive,
            "stream": True,
        },
        on_chunk=on_chunk if use_memory is True else None,
        on_done=auto_index_completed_turn if use_memory is True else None,
    )
    if isinstance(result, NdjsonStream):
        result.headers.update(headers)
    return result


async def _retrieve_memory(text: str, user_id) -> list:
    """Embed the text and search the user's memory, returning raw results.
    Separated from /api/chat so the timeout wrapper races the whole thing —
    neither embeddings.embed nor qdrant.search_by_vector accepts an abort
    signal, so the timeout only bounds how long /api/chat waits; a hung call
    is simply ignored rather than cancelled."""
    vector = await embeddings_module.embed(text)
    return await qdrant.search_by_vector(
        vector,
        limit=MEMORY_TOP_K,
        filter={"must": [{"key": "userId", "match": {"value": user_id}}]},
    )


# Inject a memory system message into the outgoing messages array. If a
# compacted-summary message leads the array, the memory goes right after it
# so the summary stays first; compaction's marker scan runs from the end
# and only recognizes its own MARKER prefix, so the memory message never
# displaces or shadows an existing summary either way.
def inject_memory_message(messages: list, memory_content: str) -> list:
    memory_message = {"role": "system", "content": memory_content}
    if (
        messages
        and isinstance(messages[0], dict)
        and messages[0].get("role") == "system"
        and isinstance(messages[0].get("content"), str)
        and messages[0]["content"].startswith(COMPACTION_MARKER)
    ):
        return [messages[0], memory_message, *messages[1:]]
    return [memory_message, *messages]


@app.post("/api/pull")
async def pull(request: Request):
    if gate_resp := _check_rate(model_pull_rate_limiter, request):
        return gate_resp
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")
    name = body.get("name")

    if not isinstance(name, str) or not name.strip():
        return err_response(400, 'Missing "name" in request body.')
    trimmed_name = name.strip()
    # Ollama model tags are single tokens like "llama3:8b" — reject anything
    # with whitespace or control characters, which can't be a valid tag and
    # would otherwise be forwarded verbatim to the upstream Ollama API.
    if re.search(r"[\s\x00-\x1F\x7F]", trimmed_name):
        return err_response(
            400, 'Invalid "name": must not contain whitespace or control characters.'
        )
    if len(trimmed_name) > 256:
        return err_response(400, 'Invalid "name": must not exceed 256 characters.')

    return await pipe_upstream_ndjson(
        request, path="/api/pull", body={"name": trimmed_name, "stream": True}
    )


@app.delete("/api/models/{name}")
async def delete_model(name: str, request: Request):
    if gate_resp := _check_rate(model_delete_rate_limiter, request):
        return gate_resp
    try:
        r = await _shared_http.request(
            "DELETE", f"{OLLAMA_HOST}/api/delete", json={"name": name}
        )
        if not r.is_success:
            return JSONResponse(
                status_code=r.status_code,
                content={"error": r.text or "Failed to delete model."},
            )
        return {"ok": True}
    except Exception as e:
        return err_response(503, str(e))


# --- Chat history (local database) ---------------------------------------
# Server-side persistence for chat sessions, stored in a JSON file under
# ./data/. Every route here is scoped to the logged-in user's id (see
# db.py) so one account can never read, modify, or delete another
# account's sessions.


@app.get("/api/sessions")
async def list_sessions(request: Request):
    try:
        return {"sessions": db.list_sessions(request.state.user["id"])}
    except Exception as e:
        return err_response(500, str(e))


# Registered BEFORE /api/sessions/{session_id} so "search" can never be
# mistaken for a session id (FastAPI matches in declaration order, same as
# Express).
@app.get("/api/sessions/search")
async def search_sessions(request: Request, q: str = ""):
    q = q.strip() if isinstance(q, str) else ""
    if not q:
        return err_response(400, 'Missing "q" query parameter.')
    try:
        return {"sessions": db.search_sessions(request.state.user["id"], q)}
    except Exception as e:
        return err_response(500, str(e))


@app.get("/api/export")
async def export(request: Request):
    try:
        sessions = db.export_sessions(request.state.user["id"])
        payload = json.dumps(
            {
                "exportedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "app": "ollama-chat",
                "sessions": sessions,
            },
            indent=2,
        )
        today = datetime.now(timezone.utc).date().isoformat()
        filename = f"ollama-chat-export-{today}.json"
        return Response(
            content=payload,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        return err_response(500, str(e))


@app.post("/api/sessions")
async def create_session(request: Request):
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")
    title = body.get("title")
    if title is not None and not isinstance(title, str):
        return err_response(400, '"title" must be a string.')
    try:
        session = db.create_session(request.state.user["id"], title)
        return JSONResponse(status_code=201, content=session)
    except Exception as e:
        return err_response(500, str(e))


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    try:
        session = db.get_session(session_id, request.state.user["id"])
        if not session:
            return err_response(404, f'No session with id "{session_id}".')
        return session
    except Exception as e:
        return err_response(500, str(e))


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")

    title = body.get("title")
    messages = body.get("messages")
    append_messages = body.get("appendMessages")

    if title is not None and not isinstance(title, str):
        return err_response(400, '"title" must be a string.')
    if messages is not None and not isinstance(messages, list):
        return err_response(400, '"messages" must be an array.')
    if append_messages is not None and not isinstance(append_messages, list):
        return err_response(400, '"appendMessages" must be an array.')
    if isinstance(messages, list) and not all(is_valid_message(m) for m in messages):
        return err_response(
            400, 'Each item in "messages" must have string "role" and "content".'
        )
    if isinstance(append_messages, list) and not all(
        is_valid_message(m) for m in append_messages
    ):
        return err_response(
            400, 'Each item in "appendMessages" must have string "role" and "content".'
        )

    # Size limits: shape checks above run first so a malformed item still
    # reports the shape error rather than a confusing size error.
    if isinstance(title, str) and len(title) > MAX_SESSION_TITLE_CHARS:
        return err_response(400, f'"title" must not exceed {MAX_SESSION_TITLE_CHARS} characters.')
    if isinstance(messages, list) and len(messages) > MAX_SESSION_MESSAGES:
        return err_response(400, f'"messages" must not exceed {MAX_SESSION_MESSAGES} items.')
    if isinstance(append_messages, list) and len(append_messages) > MAX_SESSION_MESSAGES:
        return err_response(
            400, f'"appendMessages" must not exceed {MAX_SESSION_MESSAGES} items.'
        )
    if isinstance(messages, list) and any(
        len(m["content"]) > MAX_MESSAGE_CONTENT_CHARS for m in messages
    ):
        return err_response(
            400,
            f'Each message "content" in "messages" must not exceed {MAX_MESSAGE_CONTENT_CHARS} characters.',
        )
    if isinstance(append_messages, list) and any(
        len(m["content"]) > MAX_MESSAGE_CONTENT_CHARS for m in append_messages
    ):
        return err_response(
            400,
            f'Each message "content" in "appendMessages" must not exceed {MAX_MESSAGE_CONTENT_CHARS} characters.',
        )

    try:
        session = db.update_session(
            session_id,
            request.state.user["id"],
            title=title,
            messages=messages,
            append_messages=append_messages,
        )
        if not session:
            return err_response(404, f'No session with id "{session_id}".')
        return session
    except Exception as e:
        return err_response(500, str(e))


@app.delete("/api/sessions/{session_id}")
async def delete_session_route(session_id: str, request: Request):
    try:
        deleted = db.delete_session(session_id, request.state.user["id"])
        if not deleted:
            return err_response(404, f'No session with id "{session_id}".')
        return {"ok": True}
    except Exception as e:
        return err_response(500, str(e))


# --- Semantic memory (Qdrant-backed) ---------------------------------------
# Qdrant stores vectors + metadata payloads only — it is not the primary
# chat-history store. Both routes degrade gracefully: if Qdrant or the
# embeddings call fails, they return 503 rather than crashing.
#
# Every point is tagged with the indexing user's id and search is filtered
# to that same id, so one account's indexed messages are never returned in
# another account's search results — same scoping principle as the
# /api/sessions routes above.


async def index_memory_items(items: list, user_id) -> int:
    """Shared by the /api/memory/index route and /api/chat's auto-indexing
    of completed turns. Embeds and upserts each item sequentially; the
    item's text is stored in the payload (not just embedded), so semantic
    search can return the excerpt itself rather than an opaque vector
    match."""
    for item in items:
        vector = await embeddings_module.embed(item["text"])
        await qdrant.upsert_point(
            id=item.get("id") or str(uuid.uuid4()),
            vector=vector,
            payload={**(item.get("metadata") or {}), "text": item["text"], "userId": user_id},
        )
    return len(items)


@app.post("/api/memory/index")
async def memory_index(request: Request):
    if gate_resp := _check_rate(memory_index_rate_limiter, request):
        return gate_resp
    # Body: { id, text, metadata } or an array of such objects.
    raw = getattr(request.state, "raw_body", b"")
    try:
        raw_body = json.loads(raw)
    except ValueError:
        return err_response(400, "Invalid JSON body.")
    items = raw_body if isinstance(raw_body, list) else ([raw_body] if isinstance(raw_body, dict) else [])

    if len(items) > MAX_MEMORY_BATCH:
        return err_response(400, f"Batch must not exceed {MAX_MEMORY_BATCH} items.")

    for item in items:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("text"), str)
            or not item["text"].strip()
        ):
            return err_response(400, 'Each item requires a non-empty "text" field.')
        if len(item["text"]) > MAX_MEMORY_TEXT_CHARS:
            return err_response(
                400, f'Each item\'s "text" must not exceed {MAX_MEMORY_TEXT_CHARS} characters.'
            )

    try:
        indexed = await index_memory_items(items, request.state.user["id"])
        return {"ok": True, "indexed": indexed}
    except Exception as e:
        return err_response(503, f"Semantic memory indexing failed: {e}")


@app.post("/api/memory/search")
async def memory_search(request: Request):
    try:
        body = json_body(request)
    except BodyError:
        return err_response(400, "Invalid JSON body.")
    query = body.get("query")
    limit = body.get("limit")
    if not isinstance(query, str) or not query.strip():
        return err_response(400, 'Missing "query" in request body.')

    try:
        vector = await embeddings_module.embed(query)
        results = await qdrant.search_by_vector(
            vector,
            limit=limit if isinstance(limit, int) and limit else 5,
            filter={
                "must": [{"key": "userId", "match": {"value": request.state.user["id"]}}]
            },
        )
        return {"results": results}
    except Exception as e:
        return err_response(503, f"Semantic memory search failed: {e}")


# --- Startup / entry point ----------------------------------------------------

# Static frontend, served LAST so every API route matches first (mirrors
# express.static in server.js, registered after the routes). Middleware runs
# before the router, so unauthenticated requests never reach it.
app.mount(
    "/",
    StaticFiles(
        directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public"),
        html=True,
    ),
    name="public",
)



@app.on_event("startup")
async def startup():
    print(f"Ollama Chat running at http://localhost:{PORT}")
    print(f"Proxying Ollama at {OLLAMA_HOST}")

    # Non-fatal startup check: warn once if Qdrant isn't reachable, but
    # never block or crash the server on it.
    result = await qdrant.check_connection()
    if not result["ok"]:
        logger.warn(
            f"Warning: Qdrant unreachable at {qdrant.QDRANT_URL} "
            f"(semantic memory endpoints will return 503 until it's available): "
            f"{result['error']}"
        )

    # Prune expired login sessions on startup, then every 6 hours — keeps
    # the sessions table from growing unbounded with abandoned tokens (see
    # auth.prune_expired_sessions for why lazy pruning alone isn't enough).
    auth.prune_expired_sessions()

    def _prune_loop():
        while True:
            time.sleep(6 * 60 * 60)
            auth.prune_expired_sessions()

    threading.Thread(target=_prune_loop, daemon=True).start()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
