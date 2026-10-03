"""Thin wrapper around the Qdrant client for semantic memory storage.

Port of qdrant.js. Qdrant here stores vectors + metadata payloads for
similarity search only — it is not the primary chat-history store. Every
exported function may raise; callers are expected to catch and turn that
into a 503, exactly like the original.
"""
from typing import Optional

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from . import config

client = AsyncQdrantClient(url=config.QDRANT_URL)

_collection_ready = False


def _set_client_for_tests(fake_client) -> None:
    """Test-only hook, mirrors qdrant.js's _setClientForTests."""
    global client, _collection_ready
    client = fake_client or AsyncQdrantClient(url=config.QDRANT_URL)
    _collection_ready = False


async def ensure_collection() -> None:
    global _collection_ready
    if _collection_ready:
        return
    exists = await client.collection_exists(config.QDRANT_COLLECTION)
    if not exists:
        await client.create_collection(
            config.QDRANT_COLLECTION,
            vectors_config=qmodels.VectorParams(size=config.EMBEDDING_DIM, distance=qmodels.Distance.COSINE),
        )
    else:
        info = await client.get_collection(config.QDRANT_COLLECTION)
        vectors_config = info.config.params.vectors
        existing_size = getattr(vectors_config, "size", None)
        if existing_size and existing_size != config.EMBEDDING_DIM:
            raise RuntimeError(
                f'Qdrant collection "{config.QDRANT_COLLECTION}" was created with vector size {existing_size}, '
                f"but EMBEDDING_DIM is currently set to {config.EMBEDDING_DIM}. This usually means EMBEDDING_DIM "
                f"was changed after the collection already existed. Either set EMBEDDING_DIM={existing_size} "
                f'to match the existing collection, or delete/recreate the "{config.QDRANT_COLLECTION}" '
                f"collection in Qdrant so it can be rebuilt with the new dimension."
            )
    _collection_ready = True


async def check_connection() -> dict:
    try:
        await client.get_collections()
        return {"ok": True}
    except Exception as err:  # noqa: BLE001
        return {"ok": False, "error": str(err)}


async def _with_collection_retry(fn):
    global _collection_ready
    try:
        return await fn()
    except Exception:
        _collection_ready = False
        await ensure_collection()
        return await fn()


async def upsert_point(point_id, vector: list, payload: dict) -> None:
    await ensure_collection()
    if not isinstance(vector, list) or len(vector) != config.EMBEDDING_DIM:
        got_len = len(vector) if isinstance(vector, list) else type(vector).__name__
        raise RuntimeError(
            f"Embedding has dimension {got_len}, but this Qdrant collection expects "
            f"EMBEDDING_DIM={config.EMBEDDING_DIM}. This usually means EMBEDDING_MODEL was changed to a model "
            f"that produces different-sized vectors. Align EMBEDDING_MODEL/EMBEDDING_DIM, or recreate the "
            f'"{config.QDRANT_COLLECTION}" collection for the new size.'
        )

    async def _do():
        await client.upsert(
            config.QDRANT_COLLECTION,
            points=[qmodels.PointStruct(id=point_id, vector=vector, payload=payload)],
            wait=True,
        )

    await _with_collection_retry(_do)


async def search_by_vector(vector: list, limit: int = 5, score_threshold: Optional[float] = None, query_filter=None) -> list:
    await ensure_collection()

    async def _do():
        return await client.search(
            config.QDRANT_COLLECTION,
            query_vector=vector,
            limit=limit,
            query_filter=query_filter,
            with_payload=True,
            score_threshold=score_threshold,
        )

    results = await _with_collection_retry(_do)
    return [{"id": r.id, "score": r.score, "payload": r.payload} for r in results]


def user_filter(user_id) -> "qmodels.Filter":
    """Builds a Filter scoping results/writes to a single user's payload.userId."""
    return qmodels.Filter(must=[qmodels.FieldCondition(key="userId", match=qmodels.MatchValue(value=user_id))])
