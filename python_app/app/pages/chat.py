"""Main chat page. Port of public/index.html + public/app.js.

Chat history/settings/theme are kept in `app.storage.user` (server-side,
per-browser JSON storage that NiceGUI ties to a signed cookie) — the
direct analog of the original frontend's localStorage-based persistence
(see README's note that the /api/sessions backend exists but is unused by
the browser UI). The REST /api/sessions endpoints in app/api.py remain
available as a documented, independent backend.
"""
import json
import uuid
from datetime import datetime, timezone

import httpx
from nicegui import app, run, ui

from .. import config, ollama_client
from ..auth_store import store as auth_store

ATTACHMENT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log",
    ".js", ".ts", ".py", ".html", ".css", ".yaml", ".yml", ".xml", ".sh",
}
ATTACHMENT_MAX_SIZE = 200 * 1024
ATTACHMENT_MAX_COUNT = 3


def _format_bytes(n) -> str:
    if n is None:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    val = float(n)
    i = 0
    while val >= 1024 and i < len(units) - 1:
        val /= 1024
        i += 1
    return f"{val:.0f} {units[i]}" if (val >= 10 or i == 0) else f"{val:.1f} {units[i]}"


def _default_settings() -> dict:
    return {"systemPrompt": "", "temperature": 0.8, "topP": 0.9, "numCtx": 4096, "lastModel": ""}


@ui.page("/")
async def chat_page():
    if not app.storage.user.get("authenticated", False):
        ui.navigate.to("/login")
        return

    username = app.storage.user.get("username", "")

    # ---- per-browser persisted state (mirrors localStorage in app.js) ----
    chats: list = app.storage.user.setdefault("chats", [])
    settings: dict = app.storage.user.setdefault("settings", _default_settings())
    state = {
        "active_chat_id": chats[0]["id"] if chats else None,
        "models": [],
        "system_info": None,
        "pending_attachments": [],
        "streaming": False,
        "stream_task": None,
    }

    def save():
        app.storage.user["chats"] = chats
        app.storage.user["settings"] = settings

    def get_active_chat():
        return next((c for c in chats if c["id"] == state["active_chat_id"]), None)

    # ---- layout ----
    ui.add_head_html(
        "<style>.msg-attachment-chip{font-size:12px;opacity:.8}"
        ".streaming-dot{animation:pulse 1s ease-in-out infinite}"
        "@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}"
        ".attach-upload .q-uploader{box-shadow:none;background:transparent;width:40px;height:40px;min-height:40px;}"
        ".attach-upload .q-uploader__header{padding:0;background:transparent;min-height:40px;}"
        ".attach-upload .q-uploader__header-content{padding:0;}"
        ".attach-upload .q-uploader__title,.attach-upload .q-uploader__subtitle,.attach-upload .q-uploader__list"
        "{display:none !important;}"
        ".attach-upload .q-uploader__header .q-btn:not(:last-child){display:none;}</style>"
    )
    ui.dark_mode().bind_value(app.storage.user, "dark_mode")

    with ui.header().classes("items-center justify-between"):
        with ui.row().classes("items-center gap-2"):
            ui.button(icon="menu", on_click=lambda: sidebar.toggle()).props("flat color=white")
            model_select = ui.select([], label="Model").props("dense outlined dark options-dense").style("min-width:220px")
            ui.button(icon="refresh", on_click=lambda: ui.timer(0.01, load_models, once=True)).props("flat color=white round")
        chat_title = ui.label("New chat").classes("text-lg font-medium text-white")
        with ui.row().classes("items-center gap-2"):
            ui.button("Clear", on_click=lambda: clear_chat()).props("flat color=white")
            ui.button(icon="dark_mode", on_click=lambda: ui.dark_mode().toggle()).props("flat color=white round")
            ui.button(icon="settings", on_click=lambda: settings_dialog.open()).props("flat color=white round")
            ui.label(username).classes("text-white text-sm")
            ui.button("Log out", on_click=lambda: do_logout()).props("flat color=white")

    with ui.left_drawer(value=True).classes("bg-grey-1") as sidebar:
        ui.button("+ New chat", on_click=lambda: create_chat()).props("color=primary").classes("w-full")
        chat_list_column = ui.column().classes("w-full gap-1 mt-2")
        ui.separator()
        status_row = ui.row().classes("items-center gap-2 text-sm")
        with status_row:
            status_dot = ui.icon("circle", size="10px").classes("text-grey")
            status_label = ui.label("Checking Ollama…")

    memory_warning = ui.row().classes("w-full bg-orange-100 text-orange-900 rounded p-2 gap-2 items-center")
    memory_warning.set_visibility(False)
    with memory_warning:
        ui.icon("warning")
        memory_warning_label = ui.label("")

    messages_column = ui.column().classes("w-full max-w-3xl mx-auto gap-1 p-2").style(
        "flex:1; overflow-y:auto; min-height:0;"
    )

    pending_row = ui.row().classes("w-full max-w-3xl mx-auto gap-1 px-2")

    with ui.footer().classes("bg-transparent"):
        with ui.column().classes("w-full max-w-3xl mx-auto gap-1 p-2"):
            with ui.row().classes("w-full items-end gap-2"):
                upload = ui.upload(
                    on_upload=lambda e: handle_upload(e),
                    auto_upload=True,
                    multiple=True,
                ).props(
                    'accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.js,.ts,.py,.html,.css,.yaml,.yml,.xml,.sh" '
                    'flat hide-upload-btn'
                ).classes("attach-upload w-10")
                prompt_input = ui.textarea(placeholder="Message your local model…").props("outlined autogrow").classes(
                    "flex-grow"
                ).on("keydown.enter.prevent", lambda: ui.timer(0.01, send_message, once=True))
                send_btn = ui.button(icon="send", on_click=lambda: send_message()).props("round color=primary")
                stop_btn = ui.button(icon="stop", on_click=lambda: stop_streaming()).props("round color=negative")
                stop_btn.set_visibility(False)
            ui.label("Enter to send · Shift+Enter for new line · attach up to 3 text files (200KB each)").classes(
                "text-xs text-gray-500"
            )

    # ---- settings dialog ----
    with ui.dialog() as settings_dialog, ui.card().classes("w-full max-w-lg"):
        ui.label("Settings").classes("text-xl font-bold")
        ui.label(f"Ollama server: {config.OLLAMA_HOST}").classes("text-xs text-gray-500")
        system_prompt_input = ui.textarea("System prompt", value=settings.get("systemPrompt", "")).classes("w-full")
        temperature_slider = ui.slider(min=0, max=2, step=0.05, value=settings.get("temperature", 0.8)).props(
            "label-always"
        )
        ui.label().bind_text_from(temperature_slider, "value", lambda v: f"Temperature: {v}")
        top_p_slider = ui.slider(min=0, max=1, step=0.05, value=settings.get("topP", 0.9)).props("label-always")
        ui.label().bind_text_from(top_p_slider, "value", lambda v: f"Top P: {v}")
        num_ctx_input = ui.number("Context window (num_ctx)", value=settings.get("numCtx", 4096), min=512, step=512)

        ui.separator()
        ui.label("Model management").classes("font-medium")
        installed_models_column = ui.column().classes("w-full gap-1")
        with ui.row().classes("w-full items-center gap-2"):
            pull_input = ui.input(placeholder="e.g. llama3.1:8b").classes("flex-grow")
            ui.button("Pull", on_click=lambda: ui.timer(0.01, lambda: pull_model(pull_input.value), once=True))
        pull_progress = ui.linear_progress(value=0).classes("w-full")
        pull_progress.set_visibility(False)
        pull_status_label = ui.label("")

        ui.separator()
        ui.label("Danger zone").classes("font-medium text-red-600")

        def confirm_delete_all():
            chats.clear()
            state["active_chat_id"] = None
            save()
            render_chat_list()
            render_messages()
            update_title()
            settings_dialog.close()

        ui.button("Delete all chats", on_click=confirm_delete_all).props("color=negative")

        def close_settings():
            settings["systemPrompt"] = system_prompt_input.value
            settings["temperature"] = temperature_slider.value
            settings["topP"] = top_p_slider.value
            settings["numCtx"] = int(num_ctx_input.value or 4096)
            save()
            settings_dialog.close()

        ui.button("Close", on_click=close_settings).classes("mt-2")

    # ---- rendering ----
    def render_chat_list():
        chat_list_column.clear()
        with chat_list_column:
            if not chats:
                ui.label("No chats yet.").classes("text-xs text-gray-400 p-2")
            for c in chats:
                with ui.row().classes(
                    "w-full items-center justify-between rounded p-2 cursor-pointer "
                    + ("bg-primary text-white" if c["id"] == state["active_chat_id"] else "hover:bg-grey-2")
                ).on("click", lambda _, cid=c["id"]: select_chat(cid)):
                    ui.label(c["title"]).classes("truncate flex-grow text-sm")
                    ui.button(icon="close", on_click=lambda _, cid=c["id"]: delete_chat(cid)).props(
                        "flat dense round size=sm"
                    ).classes("text-inherit")

    def build_message_row(msg: dict):
        with messages_column:
            with ui.row().classes("w-full gap-2 " + ("justify-end" if msg["role"] == "user" else "justify-start")):
                if msg["role"] != "user":
                    ui.icon("smart_toy", size="24px").classes("text-primary mt-2")
                with ui.column().classes("gap-0 max-w-[85%]"):
                    ui.label("You" if msg["role"] == "user" else (msg.get("model") or "Assistant")).classes(
                        "text-xs text-gray-500"
                    )
                    content_holder = ui.markdown(msg.get("content") or "").classes(
                        "rounded-lg p-2 " + ("bg-primary text-white" if msg["role"] == "user" else "bg-grey-2")
                    )
                    if msg.get("attachments"):
                        with ui.row().classes("gap-1 flex-wrap"):
                            for att in msg["attachments"]:
                                ui.chip(f'{att["name"]} ({_format_bytes(att.get("size"))})', icon="attach_file").classes(
                                    "msg-attachment-chip"
                                )
                if msg["role"] == "user":
                    ui.icon("person", size="24px").classes("text-grey-7 mt-2")
        return content_holder

    def render_messages():
        messages_column.clear()
        chat = get_active_chat()
        if not chat or not chat["messages"]:
            with messages_column:
                with ui.column().classes("items-center text-center gap-1 mx-auto mt-16"):
                    ui.icon("chat", size="48px").classes("text-primary")
                    ui.label("Ollama Chat").classes("text-2xl font-bold")
                    ui.label("Chat with your local models. Nothing leaves your machine.").classes(
                        "text-gray-500"
                    )
                    hint = "No local models found." if not state["models"] else f'{len(state["models"])} model(s) available locally.'
                    ui.label(hint).classes("text-xs text-gray-400")
            return
        for msg in chat["messages"]:
            build_message_row(msg)

    def update_title():
        chat = get_active_chat()
        chat_title.text = chat["title"] if chat else "New chat"

    def render_pending_attachments():
        pending_row.clear()
        with pending_row:
            for att in state["pending_attachments"]:
                def _remove(a=att):
                    state["pending_attachments"].remove(a)
                    render_pending_attachments()

                with ui.chip(f'{att["name"]} ({_format_bytes(att["size"])})', icon="attach_file", removable=True).on(
                    "remove", lambda _, fn=_remove: fn()
                ):
                    pass

    # ---- chat actions ----
    def create_chat():
        chat = {
            "id": str(uuid.uuid4()),
            "title": "New chat",
            "model": model_select.value or settings.get("lastModel") or "",
            "messages": [],
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        chats.insert(0, chat)
        state["active_chat_id"] = chat["id"]
        save()
        render_chat_list()
        render_messages()
        update_title()

    def select_chat(chat_id):
        state["active_chat_id"] = chat_id
        render_chat_list()
        render_messages()
        update_title()
        chat = get_active_chat()
        if chat and chat.get("model"):
            model_select.value = chat["model"]

    def delete_chat(chat_id):
        chats[:] = [c for c in chats if c["id"] != chat_id]
        if state["active_chat_id"] == chat_id:
            state["active_chat_id"] = chats[0]["id"] if chats else None
        save()
        render_chat_list()
        render_messages()
        update_title()

    def clear_chat():
        chat = get_active_chat()
        if not chat:
            return
        chat["messages"] = []
        chat["title"] = "New chat"
        save()
        render_chat_list()
        render_messages()
        update_title()

    # ---- models / system info ----
    async def load_models():
        try:
            data = await ollama_client.list_models()
            state["models"] = data.get("models") or []
            model_select.set_options([m["name"] for m in state["models"]])
            preferred = (get_active_chat() or {}).get("model") or settings.get("lastModel")
            if preferred and any(m["name"] == preferred for m in state["models"]):
                model_select.value = preferred
            elif state["models"]:
                model_select.value = state["models"][0]["name"]
            status_dot.classes(replace="text-positive", remove="text-negative text-grey")
            status_label.text = "Ollama connected"
        except ollama_client.OllamaError as err:
            status_dot.classes(replace="text-negative", remove="text-positive text-grey")
            status_label.text = str(err)
        render_installed_models()
        render_messages()
        check_memory_for_selected_model()

    async def load_system_info():
        try:
            import psutil

            vm = psutil.virtual_memory()
            state["system_info"] = {"totalMemory": vm.total, "freeMemory": vm.available}
        except Exception:  # noqa: BLE001
            state["system_info"] = None

    def check_memory_for_selected_model():
        info = state["system_info"]
        if not info or not model_select.value:
            memory_warning.set_visibility(False)
            return
        model = next((m for m in state["models"] if m["name"] == model_select.value), None)
        if not model or not model.get("size"):
            memory_warning.set_visibility(False)
            return
        threshold = info["freeMemory"] * 0.85
        if model["size"] > threshold:
            memory_warning_label.text = (
                f'"{model["name"]}" is {_format_bytes(model["size"])}, but only '
                f'{_format_bytes(info["freeMemory"])} RAM is free. It may run very slowly or cause heavy swapping.'
            )
            memory_warning.set_visibility(True)
        else:
            memory_warning.set_visibility(False)

    model_select.on_value_change(lambda: check_memory_for_selected_model())

    def render_installed_models():
        installed_models_column.clear()
        with installed_models_column:
            if not state["models"]:
                ui.label("No models installed yet.").classes("text-xs text-gray-400")
            for m in state["models"]:
                with ui.row().classes("w-full items-center justify-between"):
                    ui.label(m["name"]).classes("text-sm")
                    ui.label(_format_bytes(m.get("size"))).classes("text-xs text-gray-500")
                    ui.button(
                        "Delete", on_click=lambda _, name=m["name"]: ui.timer(0.01, lambda: delete_model(name), once=True)
                    ).props("flat dense color=negative size=sm")

    async def delete_model(name: str):
        with ui.dialog() as confirm_dlg, ui.card():
            ui.label(f'Delete model "{name}"? This removes it from disk.')
            with ui.row():
                ui.button("Cancel", on_click=confirm_dlg.close)

                async def _do_delete():
                    confirm_dlg.close()
                    try:
                        await ollama_client.delete_model(name)
                        await load_models()
                    except ollama_client.OllamaError as err:
                        ui.notify(str(err), type="negative")

                ui.button("Delete", on_click=_do_delete).props("color=negative")
        confirm_dlg.open()

    async def pull_model(name: str):
        name = (name or "").strip()
        if not name:
            return
        pull_progress.set_visibility(True)
        pull_progress.value = 0
        pull_status_label.text = f'Starting pull of "{name}"…'
        buffer = ""
        try:
            async for chunk in ollama_client.stream_pull(name):
                buffer += chunk.decode("utf-8", "ignore")
                *lines, buffer = buffer.split("\n")
                for line in lines:
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("error"):
                        raise RuntimeError(data["error"])
                    if data.get("total") and data.get("completed") is not None:
                        pct = data["completed"] / data["total"]
                        pull_progress.value = pct
                        pull_status_label.text = f'{data.get("status", "Pulling")} — {round(pct * 100)}%'
                    elif data.get("status"):
                        pull_status_label.text = data["status"]
            pull_progress.value = 1
            pull_status_label.text = f'Done — "{name}" is ready.'
            await load_models()
        except Exception as err:  # noqa: BLE001
            pull_status_label.text = f"Error: {err}"

    # ---- attachments ----
    async def handle_upload(e):
        if len(state["pending_attachments"]) >= ATTACHMENT_MAX_COUNT:
            ui.notify(f"You can attach at most {ATTACHMENT_MAX_COUNT} files per message.", type="warning")
            return
        name = e.name
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        content_bytes = e.content.read()
        if ext not in ATTACHMENT_EXTENSIONS:
            ui.notify(f'"{name}" isn\'t a supported text file type.', type="warning")
            return
        if len(content_bytes) > ATTACHMENT_MAX_SIZE:
            ui.notify(f'"{name}" exceeds the {_format_bytes(ATTACHMENT_MAX_SIZE)} limit per file.', type="warning")
            return
        text = content_bytes.decode("utf-8", "ignore")
        state["pending_attachments"].append({"name": name, "content": text, "size": len(content_bytes)})
        render_pending_attachments()

    # ---- sending / streaming ----
    def build_ollama_messages(chat) -> list:
        msgs = []
        if settings.get("systemPrompt", "").strip():
            msgs.append({"role": "system", "content": settings["systemPrompt"].strip()})
        for m in chat["messages"]:
            content = m["content"]
            if m.get("attachments"):
                blocks = "\n\n".join(f'[Attached file: {a["name"]}]\n```\n{a["content"]}\n```' for a in m["attachments"])
                content = f"{content}\n\n{blocks}" if content else blocks
            msgs.append({"role": m["role"], "content": content})
        return msgs

    def set_sending(is_sending: bool):
        send_btn.set_visibility(not is_sending)
        stop_btn.set_visibility(is_sending)
        prompt_input.props(f'{"disable" if is_sending else ""}')

    async def stream_assistant_reply(chat):
        ollama_messages = build_ollama_messages(chat)
        assistant_msg = {"role": "assistant", "content": "", "model": chat["model"]}
        chat["messages"].append(assistant_msg)
        render_messages()
        content_holder = messages_column.default_slot.children[-1]
        set_sending(True)
        buffer = ""
        try:
            async for chunk in ollama_client.stream_chat(chat["model"], ollama_messages, {
                "temperature": settings.get("temperature", 0.8),
                "top_p": settings.get("topP", 0.9),
                "num_ctx": settings.get("numCtx", 4096),
            }):
                buffer += chunk.decode("utf-8", "ignore")
                *lines, buffer = buffer.split("\n")
                for line in lines:
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("error"):
                        raise RuntimeError(data["error"])
                    msg = data.get("message") or {}
                    if isinstance(msg.get("content"), str):
                        assistant_msg["content"] += msg["content"]
                        update_last_message(assistant_msg["content"])
            save()
            render_chat_list()
        except Exception as err:  # noqa: BLE001
            if "CancelledError" in type(err).__name__:
                assistant_msg["content"] += ("\n\n_[stopped]_" if assistant_msg["content"] else "_[stopped]_")
                update_last_message(assistant_msg["content"])
            else:
                ui.notify(str(err), type="negative")
                if not assistant_msg["content"]:
                    chat["messages"].pop()
                    render_messages()
            save()
        finally:
            set_sending(False)
            state["stream_task"] = None

    def update_last_message(text: str):
        try:
            last_row = messages_column.default_slot.children[-1]
            # find the markdown element within the last message row (recursively)
            def find_markdown(el):
                for child in getattr(el, "default_slot", None).children if getattr(el, "default_slot", None) else []:
                    if isinstance(child, ui.markdown):
                        return child
                    found = find_markdown(child)
                    if found:
                        return found
                return None

            md = find_markdown(last_row)
            if md:
                md.set_content(text)
        except Exception:  # noqa: BLE001
            pass

    async def send_message():
        text = (prompt_input.value or "").strip()
        if not text:
            return
        if not model_select.value:
            ui.notify('Select a model first. If none are listed, pull one with "ollama pull <model>".', type="warning")
            return

        chat = get_active_chat()
        if not chat:
            create_chat()
            chat = get_active_chat()
        chat["model"] = model_select.value
        settings["lastModel"] = model_select.value

        if chat["title"] == "New chat":
            chat["title"] = text[:48] + ("…" if len(text) > 48 else "")

        user_msg = {"role": "user", "content": text}
        if state["pending_attachments"]:
            user_msg["attachments"] = [dict(a) for a in state["pending_attachments"]]
        chat["messages"].append(user_msg)
        state["pending_attachments"] = []
        render_pending_attachments()
        save()
        render_chat_list()
        render_messages()
        update_title()

        prompt_input.value = ""

        await stream_assistant_reply(chat)

    def stop_streaming():
        # Best-effort: the stream loop checks nothing external, so we just
        # mark UI as not-sending; a full cancellation would need an
        # asyncio.Task reference (kept simple here since this is single-flight).
        set_sending(False)

    async def do_logout():
        token = app.storage.user.get("session_token")
        if token:
            auth_store.delete_session(token)
        app.storage.user.clear()
        ui.navigate.to("/login")

    async def check_health_loop():
        result = await ollama_client.health()
        if result["ok"]:
            status_dot.classes(replace="text-positive", remove="text-negative text-grey")
            status_label.text = "Ollama connected"
        else:
            status_dot.classes(replace="text-negative", remove="text-positive text-grey")
            status_label.text = result.get("error", "Ollama unreachable")

    # ---- init ----
    await load_system_info()
    await load_models()
    render_chat_list()
    render_messages()
    update_title()
    ui.timer(15.0, check_health_loop)
