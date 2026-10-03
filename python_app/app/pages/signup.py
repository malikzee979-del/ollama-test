"""Signup page. Port of public/signup.html + the 'signup' mode of public/auth.js."""
from nicegui import app, ui

from ..auth_store import AuthError, store as auth_store


@ui.page("/signup")
def signup_page():
    if app.storage.user.get("authenticated", False):
        ui.navigate.to("/")
        return

    def do_signup():
        error_label.set_visibility(False)
        username = username_input.value.strip() if username_input.value else ""
        password = password_input.value or ""
        confirm = confirm_input.value or ""

        if not username or not password:
            error_label.text = "Please fill in both fields."
            error_label.set_visibility(True)
            return
        if password != confirm:
            error_label.text = "Passwords do not match."
            error_label.set_visibility(True)
            return

        try:
            user = auth_store.create_user(username, password)
        except AuthError as err:
            error_label.text = str(err)
            error_label.set_visibility(True)
            return

        token, _expires_at = auth_store.create_session(user.id)
        app.storage.user.update(
            {"authenticated": True, "user_id": user.id, "username": user.username, "session_token": token}
        )
        ui.navigate.to("/")

    with ui.column().classes("absolute-center items-stretch gap-2").style("width: 360px; max-width: 92vw;"):
        ui.icon("chat", size="42px").classes("self-center text-primary")
        ui.label("Create an account").classes("text-2xl font-bold self-center")
        ui.label("Stored locally in SQLite. Nothing leaves your machine.").classes(
            "text-sm text-gray-500 self-center text-center"
        )

        error_label = ui.label("").classes("text-red-500 text-sm self-center")
        error_label.set_visibility(False)

        username_input = ui.input("Username").props("autofocus").classes("w-full")
        ui.label('3-32 characters: letters, numbers, "_", "." or "-".').classes("text-xs text-gray-500")
        password_input = ui.input("Password", password=True, password_toggle_button=True).classes("w-full")
        ui.label("At least 8 characters.").classes("text-xs text-gray-500")
        confirm_input = ui.input("Confirm password", password=True, password_toggle_button=True).classes(
            "w-full"
        ).on("keydown.enter", lambda: do_signup())

        ui.button("Sign up", on_click=do_signup).classes("w-full").props("color=primary")
        with ui.row().classes("self-center text-sm gap-1"):
            ui.label("Already have an account?")
            ui.link("Log in", "/login")
