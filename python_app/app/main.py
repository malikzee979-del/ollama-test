"""App entrypoint: wires the FastAPI REST API, auth gate middleware, and
the NiceGUI pages (login/signup/chat) into a single process.

Run with:  python -m app.main   (from the python_app/ directory)
"""
import asyncio

from fastapi import Request
from fastapi.responses import RedirectResponse
from nicegui import app, ui
from starlette.middleware.base import BaseHTTPMiddleware

from . import config
from .api import logging_metrics_middleware, router as api_router
from .auth_store import store as auth_store

# Page routes that don't require authentication.
UNRESTRICTED_PAGE_ROUTES = {"/login", "/signup"}


class AuthMiddleware(BaseHTTPMiddleware):
    """Gates NiceGUI page routes behind app.storage.user['authenticated'].

    /api/* routes are excluded here — every /api/* handler in api.py checks
    the "sid" cookie itself and returns 401 JSON, mirroring server.js's
    behavior of gating pages and API routes with the same underlying
    session concept but different response shapes (redirect vs 401 JSON).
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            path.startswith("/api/")
            or path.startswith("/_nicegui")
            or path.startswith("/static")
            or path in UNRESTRICTED_PAGE_ROUTES
            or path == "/favicon.ico"
        ):
            return await call_next(request)

        if not app.storage.user.get("authenticated", False):
            app.storage.user["referrer_path"] = path
            return RedirectResponse("/login")

        return await call_next(request)


app.add_middleware(AuthMiddleware)
# Request logging + /api/metrics counters (TODO 3.1.1: previously defined in
# api.py but never registered, so /api/metrics always served an empty
# snapshot and no X-Request-Id was ever emitted). Added after AuthMiddleware
# so it wraps every route the auth gate handles too.
app.add_middleware(logging_metrics_middleware)
app.include_router(api_router)

# Import page modules for their @ui.page side effects.
from .pages import login, signup, chat  # noqa: E402,F401


async def _prune_sessions_periodically():
    while True:
        await asyncio.sleep(6 * 60 * 60)
        auth_store.prune_expired_sessions()


@app.on_event("startup")
async def _on_startup():
    auth_store.prune_expired_sessions()
    asyncio.create_task(_prune_sessions_periodically())


def main():
    ui.run(
        host="0.0.0.0",
        port=config.PORT,
        title="Ollama Chat",
        storage_secret=config.STORAGE_SECRET,
        reload=False,
        show=False,
    )


if __name__ in {"__main__", "__mp_main__"}:
    main()
