"""FastAPI REST API mirroring the routes in server.js.

Kept as real, independently-callable HTTP routes (for parity/testing and
any future non-NiceGUI client), while the NiceGUI pages in app/pages/ call
the underlying service modules directly in-process for the UI itself.
"""
import re
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
import psutil

from . import config, embeddings, logger, metrics, ollama_client, qdrant_store
from .auth_store import AuthError, SESSION_COOKIE, store as auth_store
from .compaction import compact_messages
from .rate_limit import RateLimitExceeded, auth_rate_limiter
from .session_store import store as session_store

router = APIRouter()


# --- helpers -------------------------------------------------------------


def _set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        expires=expires_at,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/")


def get_current_user(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    return auth_store.get_user_by_session_token(token)


# --- auth --------------------------------------------------------------------


@router.post("/api/auth/signup")
async def signup(request: Request, response: Response, body: dict = Body(...)):
    ip = request.client.host if request.client else "unknown"
    try:
        auth_rate_limiter.check(ip)
    except RateLimitExceeded as err:
        return JSONResponse(status_code=429, content={"error": str(err)}, headers={"Retry-After": str(err.retry_after_sec)})

    username = body.get("username")
    password = body.get("password")
    try:
        user = auth_store.create_user(username, password)
    except AuthError as err:
        return JSONResponse(status_code=400, content={"error": str(err)})
    token, expires_at = auth_store.create_session(user.id)
    resp = JSONResponse(status_code=201, content={"user": user.to_dict()})
    _set_session_cookie(resp, token, expires_at)
    return resp


@router.post("/api/auth/login")
async def login(request: Request, body: dict = Body(...)):
    ip = request.client.host if request.client else "unknown"
    try:
        auth_rate_limiter.check(ip)
    except RateLimitExceeded as err:
        return JSONResponse(status_code=429, content={"error": str(err)}, headers={"Retry-After": str(err.retry_after_sec)})

    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return JSONResponse(status_code=400, content={"error": 'Missing "username" or "password".'})
    user = auth_store.verify_user(username, password)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Invalid username or password."})
    token, expires_at = auth_store.create_session(user.id)
    resp = JSONResponse(content={"user": user.to_dict()})
    _set_session_cookie(resp, token, expires_at)
    return resp


@router.post("/api/auth/logout")
async def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        auth_store.delete_session(token)
    resp = JSONResponse(content={"ok": True})
    _clear_session_cookie(resp)
    return resp


@router.get("/api/auth/me")
async def me(request: Request):
    user = get_current_user(request)
    return {"user": user.to_dict() if user else None}


# --- system / health / metrics ---------------------------------------------


@router.get("/api/system")
async def system_info():
    vm = psutil.virtual_memory()
    return {"totalMemory": vm.total, "freeMemory": vm.available}


@router.get("/api/health")
async def health_check():
    result = await ollama_client.health()
    if not result["ok"]:
        return JSONResponse(status_code=503, content=result)
    return result


@router.get("/api/metrics")
async def get_metrics():
    return metrics.snapshot()


# --- models ------------------------------------------------------------------


@router.get("/api/models")
async def models():
    try:
        return await ollama_client.list_models()
    except ollama_client.OllamaError as err:
        return JSONResponse(status_code=err.status, content={"error": str(err)})


@router.post("/api/show")
async def show(body: dict = Body(...)):
    model = body.get("model")
    if not isinstance(model, str) or not model.strip():
        return JSONResponse(status_code=400, content={"error": 'Missing "model" in request body.'})
    try:
        status, data = await ollama_client.show_model(model)
        return JSONResponse(status_code=status, content=data)
    except ollama_client.OllamaError as err:
        return JSONResponse(status_code=err.status, content={"error": str(err)})


@router.post("/api/chat")
async def chat(body: dict = Body(...)):
    model = body.get("model")
    messages = body.get("messages")
    options = body.get("options")
    keep_alive = body.get("keep_alive")

    if not model:
        return JSONResponse(status_code=400, content={"error": 'Missing "model" in request body.'})
    if not isinstance(messages, list):
        return JSONResponse(status_code=400, content={"error": '"messages" must be an array.'})

    compacted = await compact_messages(
        messages,
        summarize=lambda msgs: ollama_client.summarize(msgs, model),
        keep_recent=config.COMPACTION_KEEP_RECENT,
        max_messages=config.COMPACTION_MAX_MESSAGES,
        max_chars=config.COMPACTION_MAX_CHARS,
    )

    try:
        stream = ollama_client.stream_chat(model, compacted, options, keep_alive)
        return StreamingResponse(stream, media_type="application/x-ndjson")
    except ollama_client.OllamaError as err:
        return JSONResponse(status_code=err.status, content={"error": str(err)})


@router.post("/api/pull")
async def pull(body: dict = Body(...)):
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return JSONResponse(status_code=400, content={"error": 'Missing "name" in request body.'})
    trimmed = name.strip()
    if re.search(r"[\s\x00-\x1f\x7f]", trimmed):
        return JSONResponse(status_code=400, content={"error": 'Invalid "name": must not contain whitespace or control characters.'})
    if len(trimmed) > 256:
        return JSONResponse(status_code=400, content={"error": 'Invalid "name": must not exceed 256 characters.'})

    try:
        return StreamingResponse(ollama_client.stream_pull(trimmed), media_type="application/x-ndjson")
    except ollama_client.OllamaError as err:
        return JSONResponse(status_code=err.status, content={"error": str(err)})


@router.delete("/api/models/{name}")
async def delete_model(name: str):
    try:
        await ollama_client.delete_model(name)
        return {"ok": True}
    except ollama_client.OllamaError as err:
        return JSONResponse(status_code=err.status, content={"error": str(err)})


# --- chat history (sessions) -------------------------------------------------


def _is_valid_message(m) -> bool:
    return isinstance(m, dict) and isinstance(m.get("role"), str) and isinstance(m.get("content"), str)


@router.get("/api/sessions")
async def list_sessions(request: Request):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})
    return {"sessions": session_store.list_sessions(user.id)}


@router.post("/api/sessions")
async def create_session(request: Request, body: dict = Body(default={})):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})
    title = body.get("title")
    if title is not None and not isinstance(title, str):
        return JSONResponse(status_code=400, content={"error": '"title" must be a string.'})
    session = session_store.create_session(user.id, title)
    return JSONResponse(status_code=201, content=session)


@router.get("/api/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})
    session = session_store.get_session(session_id, user.id)
    if not session:
        return JSONResponse(status_code=404, content={"error": f'No session with id "{session_id}".'})
    return session


@router.patch("/api/sessions/{session_id}")
async def patch_session(session_id: str, request: Request, body: dict = Body(default={})):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})

    title = body.get("title")
    messages = body.get("messages")
    append_messages = body.get("appendMessages")

    if title is not None and not isinstance(title, str):
        return JSONResponse(status_code=400, content={"error": '"title" must be a string.'})
    if messages is not None and not isinstance(messages, list):
        return JSONResponse(status_code=400, content={"error": '"messages" must be an array.'})
    if append_messages is not None and not isinstance(append_messages, list):
        return JSONResponse(status_code=400, content={"error": '"appendMessages" must be an array.'})
    if isinstance(messages, list) and not all(_is_valid_message(m) for m in messages):
        return JSONResponse(status_code=400, content={"error": 'Each item in "messages" must have string "role" and "content".'})
    if isinstance(append_messages, list) and not all(_is_valid_message(m) for m in append_messages):
        return JSONResponse(status_code=400, content={"error": 'Each item in "appendMessages" must have string "role" and "content".'})

    if isinstance(title, str) and len(title) > config.MAX_SESSION_TITLE_CHARS:
        return JSONResponse(status_code=400, content={"error": f'"title" must not exceed {config.MAX_SESSION_TITLE_CHARS} characters.'})
    if isinstance(messages, list) and len(messages) > config.MAX_SESSION_MESSAGES:
        return JSONResponse(status_code=400, content={"error": f'"messages" must not exceed {config.MAX_SESSION_MESSAGES} items.'})
    if isinstance(append_messages, list) and len(append_messages) > config.MAX_SESSION_MESSAGES:
        return JSONResponse(status_code=400, content={"error": f'"appendMessages" must not exceed {config.MAX_SESSION_MESSAGES} items.'})
    if isinstance(messages, list) and any(len(m["content"]) > config.MAX_MESSAGE_CONTENT_CHARS for m in messages):
        return JSONResponse(status_code=400, content={"error": f'Each message "content" in "messages" must not exceed {config.MAX_MESSAGE_CONTENT_CHARS} characters.'})
    if isinstance(append_messages, list) and any(len(m["content"]) > config.MAX_MESSAGE_CONTENT_CHARS for m in append_messages):
        return JSONResponse(status_code=400, content={"error": f'Each message "content" in "appendMessages" must not exceed {config.MAX_MESSAGE_CONTENT_CHARS} characters.'})

    session = session_store.update_session(session_id, user.id, title=title, messages=messages, append_messages=append_messages)
    if not session:
        return JSONResponse(status_code=404, content={"error": f'No session with id "{session_id}".'})
    return session


@router.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})
    deleted = session_store.delete_session(session_id, user.id)
    if not deleted:
        return JSONResponse(status_code=404, content={"error": f'No session with id "{session_id}".'})
    return {"ok": True}


# --- semantic memory ---------------------------------------------------------


@router.post("/api/memory/index")
async def memory_index(request: Request, body=Body(...)):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})

    items = body if isinstance(body, list) else [body]
    if len(items) > config.MAX_MEMORY_BATCH:
        return JSONResponse(status_code=400, content={"error": f'Batch must not exceed {config.MAX_MEMORY_BATCH} items.'})

    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str) or not item["text"].strip():
            return JSONResponse(status_code=400, content={"error": 'Each item requires a non-empty "text" field.'})
        if len(item["text"]) > config.MAX_MEMORY_TEXT_CHARS:
            return JSONResponse(status_code=400, content={"error": f'Each item\'s "text" must not exceed {config.MAX_MEMORY_TEXT_CHARS} characters.'})

    try:
        for item in items:
            vector = await embeddings.embed(item["text"])
            payload = {**(item.get("metadata") or {}), "userId": user.id}
            await qdrant_store.upsert_point(item.get("id") or str(uuid.uuid4()), vector, payload)
        return {"ok": True, "indexed": len(items)}
    except Exception as err:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"error": f"Semantic memory indexing failed: {err}"})


@router.post("/api/memory/search")
async def memory_search(request: Request, body: dict = Body(...)):
    user = get_current_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required."})

    query = body.get("query")
    limit = body.get("limit")
    if not isinstance(query, str) or not query.strip():
        return JSONResponse(status_code=400, content={"error": 'Missing "query" in request body.'})

    try:
        vector = await embeddings.embed(query)
        results = await qdrant_store.search_by_vector(vector, limit=limit or 5, query_filter=qdrant_store.user_filter(user.id))
        return {"results": results}
    except Exception as err:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"error": f"Semantic memory search failed: {err}"})


# --- request logging / metrics middleware -----------------------------------


async def logging_metrics_middleware(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-Id"] = request_id
    route = request.scope.get("route").path if request.scope.get("route") else request.url.path
    logger.info(f"{request.method} {route} {response.status_code} {duration_ms:.1f}ms id={request_id}")
    metrics.record(route=route, method=request.method, status=response.status_code, duration_ms=duration_ms)
    return response
