"""Login page. Port of public/login.html + the 'login' mode of public/auth.js."""
from nicegui import app, ui

from ..auth_store import AuthError, store as auth_store


@ui.page("/login")
def login_page():
    if app.storage.user.get("authenticated", False):
        ui.navigate.to("/")
        return

    def do_login():
        error_label.set_visibility(False)
        username = username_input.value.strip() if username_input.value else ""
        password = password_input.value or ""
        if not username or not password:
            error_label.text = "Please fill in both fields."
            error_label.set_visibility(True)
            return

        user = auth_store.verify_user(username, password)
        if not user:
            error_label.text = "Invalid username or password."
            error_label.set_visibility(True)
            return

        token, _expires_at = auth_store.create_session(user.id)
        app.storage.user.update(
            {"authenticated": True, "user_id": user.id, "username": user.username, "session_token": token}
        )
        ui.navigate.to(app.storage.user.pop("referrer_path", "/"))

    with ui.column().classes("absolute-center items-stretch gap-2").style("width: 360px; max-width: 92vw;"):
        ui.icon("chat", size="42px").classes("self-center text-primary")
        ui.label("Log in").classes("text-2xl font-bold self-center")
        ui.label("Chat with your local models. Nothing leaves your machine.").classes(
            "text-sm text-gray-500 self-center text-center"
        )

        error_label = ui.label("").classes("text-red-500 text-sm self-center")
        error_label.set_visibility(False)

        username_input = ui.input("Username").props("autofocus").classes("w-full").on(
            "keydown.enter", lambda: do_login()
        )
        password_input = ui.input("Password", password=True, password_toggle_button=True).classes("w-full").on(
            "keydown.enter", lambda: do_login()
        )

        ui.button("Log in", on_click=do_login).classes("w-full").props("color=primary")
        with ui.row().classes("self-center text-sm gap-1"):
            ui.label("Don't have an account?")
            ui.link("Sign up", "/signup")
