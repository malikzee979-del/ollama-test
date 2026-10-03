// Live end-to-end test: drives the app's real ApiClient (the exact layer the
// UI screens call) against a running Ollama Chat server + Ollama daemon.
//
//   flutter test tool/live_e2e_test.dart
//
// Requires `npm start` (server on http://localhost:4173) and Ollama serving at
// least one model. Kept out of test/ so the normal `flutter test` suite stays
// hermetic and never requires a live server.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ollama_chat_mobile/api_client.dart';
import 'package:ollama_chat_mobile/models.dart';

void main() {
  setUpAll(() {
    // flutter_test would otherwise route all HTTP through a mock that returns
    // 400. Restore real sockets and an in-memory preference store so the app
    // starts unconfigured and talks to the live server.
    HttpOverrides.global = null;
    SharedPreferences.setMockInitialValues({});
  });

  test('signup → auto sign-in → chat → logout → sign-in again', () async {
    final client = await ApiClient.load();
    await client.setServerUrl('http://localhost:4173');

    final username = 'e2e${DateTime.now().millisecondsSinceEpoch}';
    const password = 'password123';

    // ---- Sign up (the server issues a session cookie; we auto-log in) ----
    final user = await client.signup(username, password);
    expect(user.username, username);
    expect(client.isLoggedIn, isTrue, reason: 'signup should leave a session');

    // ---- Confirm the session is valid (what the app does on launch) -------
    final me = await client.me();
    expect(me?.username, username);

    // ---- Models are visible to a signed-in client -------------------------
    final models = await client.listModels();
    expect(models, isNotEmpty);
    // Prefer the smaller model so the first inference stays quick.
    final model = models.firstWhere(
      (m) => m.startsWith('llama3.2'),
      orElse: () => models.first,
    );

    // ---- Start a session and stream a reply -------------------------------
    final session = await client.createSession();
    final deltas = <String>[];
    await for (final delta in client.chatStream(
      model,
      [ChatMessage(role: 'user', content: 'Say hi in one word.')],
    )) {
      deltas.add(delta);
    }
    final reply = deltas.join();
    expect(reply, isNotEmpty, reason: 'the model should stream a non-empty reply');

    // ---- Persist the turn and confirm it lands in the session list --------
    await client.appendMessages(session.id, [
      ChatMessage(role: 'user', content: 'Say hi in one word.'),
      ChatMessage(role: 'assistant', content: reply),
    ]);
    final sessions = await client.listSessions();
    expect(sessions.any((s) => s.id == session.id), isTrue);

    // ---- Log out clears the session --------------------------------------
    await client.logout();
    expect(client.isLoggedIn, isFalse);

    // ---- Sign back in with the same credentials ---------------------------
    final user2 = await client.login(username, password);
    expect(user2.username, username);
    expect(client.isLoggedIn, isTrue);
    final meAgain = await client.me();
    expect(meAgain?.username, username);
  }, timeout: const Timeout(Duration(minutes: 3)));
}
