"""Calls Ollama's embeddings endpoint to turn text into a vector.

Port of embeddings.js. Newer Ollama versions expose POST /api/embed (body:
{model, input}, response: {embeddings: [[...]]}). Older versions only have
POST /api/embeddings (body: {model, prompt}, response: {embedding: [...]}).
Tries the new endpoint first, falls back to the old one on a 404.
"""
import httpx

from . import config


async def embed(text: str) -> list:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{config.OLLAMA_HOST}/api/embed",
            json={"model": config.EMBEDDING_MODEL, "input": text},
        )

        if r.status_code == 404:
            r2 = await client.post(
                f"{config.OLLAMA_HOST}/api/embeddings",
                json={"model": config.EMBEDDING_MODEL, "prompt": text},
            )
            if r2.status_code >= 400:
                raise RuntimeError(f"Ollama embeddings request failed ({r2.status_code}): {r2.text}")
            data = r2.json()
            if not isinstance(data.get("embedding"), list):
                raise RuntimeError("Unexpected response shape from /api/embeddings.")
            return data["embedding"]

        if r.status_code >= 400:
            raise RuntimeError(f"Ollama embed request failed ({r.status_code}): {r.text}")

        data = r.json()
        embeddings = data.get("embeddings")
        if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
            return embeddings[0]
        if isinstance(data.get("embedding"), list):
            return data["embedding"]
        raise RuntimeError("Unexpected response shape from /api/embed.")
