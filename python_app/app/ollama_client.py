"""Thin async client for the local Ollama HTTP API.

Port of the fetch-based calls to Ollama scattered through server.js:
/api/tags (models), /api/show, /api/chat (streaming), /api/pull
(streaming), /api/delete, /api/version (health).
"""
import json
from typing import AsyncIterator, Optional

import httpx

from . import config


class OllamaError(Exception):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


async def list_models() -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(f"{config.OLLAMA_HOST}/api/tags")
        except httpx.HTTPError as err:
            raise OllamaError(f"Cannot reach Ollama at {config.OLLAMA_HOST}: {err}") from err
        if r.status_code >= 400:
            raise OllamaError(f"Cannot reach Ollama at {config.OLLAMA_HOST}: status {r.status_code}")
        return r.json()


async def show_model(model: str) -> tuple:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            r = await client.post(f"{config.OLLAMA_HOST}/api/show", json={"model": model})
        except httpx.HTTPError as err:
            raise OllamaError(str(err)) from err
        return r.status_code, r.json()


async def health() -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(f"{config.OLLAMA_HOST}/api/version")
            if r.status_code >= 400:
                raise RuntimeError(f"status {r.status_code}")
            return {"ok": True, "ollama": r.json()}
        except Exception as err:  # noqa: BLE001
            return {"ok": False, "error": f"Cannot reach Ollama at {config.OLLAMA_HOST}: {err}"}


async def delete_model(name: str) -> None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.request("DELETE", f"{config.OLLAMA_HOST}/api/delete", json={"name": name})
        except httpx.HTTPError as err:
            raise OllamaError(str(err)) from err
        if r.status_code >= 400:
            raise OllamaError(r.text or "Failed to delete model.", status=r.status_code)


async def stream_chat(
    model: str, messages: list, options: Optional[dict], keep_alive=None
) -> AsyncIterator[bytes]:
    """Streams newline-delimited JSON chunks straight from Ollama's /api/chat."""
    body = {"model": model, "messages": messages, "options": options, "keep_alive": keep_alive, "stream": True}
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", f"{config.OLLAMA_HOST}/api/chat", json=body) as upstream:
            if upstream.status_code >= 400:
                text = await upstream.aread()
                raise OllamaError(text.decode("utf-8", "ignore") or "Upstream error from Ollama.", status=upstream.status_code)
            async for chunk in upstream.aiter_bytes():
                yield chunk


async def stream_pull(name: str) -> AsyncIterator[bytes]:
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", f"{config.OLLAMA_HOST}/api/pull", json={"name": name, "stream": True}) as upstream:
            if upstream.status_code >= 400:
                text = await upstream.aread()
                raise OllamaError(text.decode("utf-8", "ignore") or "Upstream error from Ollama.", status=upstream.status_code)
            async for chunk in upstream.aiter_bytes():
                yield chunk


async def summarize(messages_to_summarize: list, model: str) -> str:
    """Non-streaming chat call used by compaction to summarize old turns."""
    summary_model = config.COMPACTION_MODEL or model
    body = {
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
    }
    timeout = config.COMPACTION_TIMEOUT_MS / 1000
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            r = await client.post(f"{config.OLLAMA_HOST}/api/chat", json=body)
        except httpx.TimeoutException as err:
            raise RuntimeError(f"Ollama summarization timed out after {config.COMPACTION_TIMEOUT_MS}ms.") from err
        if r.status_code >= 400:
            raise RuntimeError(f"Ollama summarization request failed (status {r.status_code}): {r.text}")
        data = r.json()
        return (data.get("message") or {}).get("content", "")
