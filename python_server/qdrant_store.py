"""Thin wrapper around Qdrant's REST API for semantic memory storage.

Qdrant here stores VECTORS + metadata payloads for similarity search only —
it is not the primary chat-history store (that's db.py). This module is
intentionally self-contained so it can fail without taking down the rest of
the server: every exported function may raise, and callers are expected to
catch and turn that into a 503.

Implemented directly over the REST API with httpx instead of pulling in the
`qdrant-client` package, keeping the project's minimal-dependency footprint.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

QDRANT_URL = os.environ.get("QDRANT_URL") or "http://127.0.0.1:6333"
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION") or "chat_messages"
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM") or 768)


class QdrantError(Exception):
    pass


# Test-only hook: lets a test suite swap in a fake client without a mocking
# dependency. Mirrors the injected-dependency pattern used elsewhere in this
# project (e.g. compaction's `summarize`).
_client: httpx.AsyncClient | None = None
_client_closed = False


def _get_client() -> httpx.AsyncClient:
    global _client_closed
    if _client is None or _client_closed:
        return httpx.AsyncClient(base_url=QDRANT_URL, timeout=30.0)
    return _client


def _set_client_for_tests(fake_client: httpx.AsyncClient | None) -> None:
    global _client, _client_closed, _collection_ready
    _client = fake_client
    _client_closed = fake_client is None
    _collection_ready = False


# Tracks whether we've already ensured the collection exists this process,
# so we don't re-check it on every request.
_collection_ready = False


def _reset_collection_ready() -> None:
    global _collection_ready
    _collection_ready = False


async def ensure_collection() -> None:
    global _collection_ready
    if _collection_ready:
        return
    client = _get_client()
    r = await client.get(f"/collections/{QDRANT_COLLECTION}")
    if r.status_code == 404:
        exists = False
    elif r.is_success:
        body = r.json()
        exists = bool(body.get("result"))
    else:
        raise QdrantError(f"Qdrant returned status {r.status_code} checking collection: {r.text}")

    if not exists:
        rr = await client.put(
            f"/collections/{QDRANT_COLLECTION}",
            json={"vectors": {"size": EMBEDDING_DIM, "distance": "Cosine"}},
        )
        if not rr.is_success:
            raise QdrantError(f"Failed to create Qdrant collection: {rr.text}")
    else:
        info = r.json()
        try:
            existing_size = info["result"]["config"]["params"]["vectors"]["size"]
        except (KeyError, TypeError):
            existing_size = None
        if existing_size and existing_size != EMBEDDING_DIM:
            raise QdrantError(
                f'Qdrant collection "{QDRANT_COLLECTION}" was created with vector size {existing_size}, '
                f"but EMBEDDING_DIM is currently set to {EMBEDDING_DIM}. This usually means EMBEDDING_DIM "
                f"was changed after the collection already existed. Either set EMBEDDING_DIM={existing_size} "
                f'to match the existing collection, or delete/recreate the "{QDRANT_COLLECTION}" collection '
                f"in Qdrant so it can be rebuilt with the new dimension."
            )
    _collection_ready = True


async def check_connection() -> dict:
    """One-time, non-fatal startup check. Logs a single warning if Qdrant
    isn't reachable but never raises — the caller (main.py) should not await
    anything blocking on this."""
    try:
        client = _get_client()
        r = await client.get("/collections")
        r.raise_for_status()
        return {"ok": True}
    except Exception as err:
        return {"ok": False, "error": str(err)}


async def _with_collection_retry(fn) -> Any:
    """Run `fn` (which assumes the collection exists) and, if it fails, reset
    collection_ready, re-run ensure_collection() (which will recreate the
    collection if it was deleted externally), and retry `fn` exactly once.
    If the retry also fails, the retry's error propagates so callers still
    see a real failure (turned into a 503 upstream) instead of a silently
    masked one."""
    try:
        return await fn()
    except Exception:
        _reset_collection_ready()
        await ensure_collection()
        return await fn()


async def upsert_point(*, id, vector: list[float], payload: dict) -> None:
    await ensure_collection()
    if not isinstance(vector, list) or len(vector) != EMBEDDING_DIM:
        got_len = len(vector) if isinstance(vector, list) else type(vector).__name__
        raise QdrantError(
            f"Embedding has dimension {got_len}, but this Qdrant collection expects EMBEDDING_DIM={EMBEDDING_DIM}. "
            f"This usually means EMBEDDING_MODEL was changed to a model that produces different-sized vectors. "
            f"Align EMBEDDING_MODEL/EMBEDDING_DIM, or recreate the \"{QDRANT_COLLECTION}\" collection for the new size."
        )
    client = _get_client()

    async def _do():
        r = await client.put(
            f"/collections/{QDRANT_COLLECTION}/points?wait=true",
            json={"points": [{"id": id, "vector": vector, "payload": payload}]},
        )
        if not r.is_success:
            raise QdrantError(f"Qdrant upsert failed ({r.status_code}): {r.text}")
        return r

    await _with_collection_retry(_do)


async def search_by_vector(
    vector: list[float],
    *,
    limit: int = 5,
    score_threshold: float | None = None,
    filter: dict | None = None,
) -> list[dict]:
    """Search by vector, returning [{ id, score, payload }, ...]. Pass
    `filter` to scope results (e.g. to a single user's payload.userId), so
    one account's semantic memory search never surfaces another account's
    indexed messages."""
    await ensure_collection()
    client = _get_client()

    body: dict = {"vector": vector, "limit": limit, "with_payload": True}
    if score_threshold is not None:
        body["score_threshold"] = score_threshold
    if filter is not None:
        body["filter"] = filter

    async def _do():
        r = await client.post(f"/collections/{QDRANT_COLLECTION}/points/search", json=body)
        if not r.is_success:
            raise QdrantError(f"Qdrant search failed ({r.status_code}): {r.text}")
        return r

    r = await _with_collection_retry(_do)
    result = r.json().get("result") or []
    return [{"id": p["id"], "score": p["score"], "payload": p.get("payload")} for p in result]
