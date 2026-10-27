"""Calls Ollama's embeddings endpoint to turn text into a vector.

Newer Ollama versions expose POST /api/embed (body: { model, input },
response: { embeddings: [[...]] }). Older versions only have
POST /api/embeddings (body: { model, prompt }, response: { embedding: [...] }).
We try the new endpoint first and fall back to the old one on a 404.
"""

from __future__ import annotations

import os

import httpx

OLLAMA_HOST = os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434"
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL") or "nomic-embed-text"


class EmbeddingsError(Exception):
    pass


async def embed(text: str, client: httpx.AsyncClient | None = None) -> list[float]:
    """Return the embedding vector for `text`. Raises EmbeddingsError on
    upstream failure or an unexpected response shape; callers turn that
    into a 503 (or, in /api/chat, fail open without memory)."""
    owns_client = client is None
    client = client or httpx.AsyncClient()

    try:
        # Preferred: /api/embed
        r = await client.post(
            f"{OLLAMA_HOST}/api/embed",
            json={"model": EMBEDDING_MODEL, "input": text},
        )

        if r.status_code == 404:
            # Fallback: older /api/embeddings endpoint.
            r = await client.post(
                f"{OLLAMA_HOST}/api/embeddings",
                json={"model": EMBEDDING_MODEL, "prompt": text},
            )
            if not r.is_success:
                raise EmbeddingsError(
                    f"Ollama embeddings request failed ({r.status_code}): {_safe_text(r)}"
                )
            data = r.json()
            if not (isinstance(data, dict) and isinstance(data.get("embedding"), list)):
                raise EmbeddingsError("Unexpected response shape from /api/embeddings.")
            return data["embedding"]

        if not r.is_success:
            raise EmbeddingsError(
                f"Ollama embed request failed ({r.status_code}): {_safe_text(r)}"
            )

        data = r.json()
        # /api/embed returns { embeddings: [[...]] } — one vector per input.
        if (
            isinstance(data, dict)
            and isinstance(data.get("embeddings"), list)
            and data["embeddings"]
            and isinstance(data["embeddings"][0], list)
        ):
            return data["embeddings"][0]
        if isinstance(data, dict) and isinstance(data.get("embedding"), list):
            return data["embedding"]
        raise EmbeddingsError("Unexpected response shape from /api/embed.")
    finally:
        if owns_client:
            await client.aclose()


def _safe_text(r: httpx.Response) -> str:
    try:
        return r.text
    except Exception:
        return ""
