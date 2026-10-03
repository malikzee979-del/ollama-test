// Full end-to-end flow against the real Ollama Chat server (see ../../server.js)
// and a real Ollama daemon: configure the server, create an account, chat with
// a model, log out, and log back in. Run with:
//
//   flutter test integration_test/full_flow_test.dart -d macos
//
// Requires the server running on http://localhost:4173 and Ollama serving at
// least one model.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ollama_chat_mobile/main.dart' as app;
import 'package:ollama_chat_mobile/screens/chat_screen.dart';
import 'package:ollama_chat_mobile/screens/login_screen.dart';
import 'package:ollama_chat_mobile/screens/signup_screen.dart';

/// Polls [condition] until it turns true, pumping frames and yielding to the
/// real event loop in between. Integration tests run with live (not fake)
/// time, so network responses need real delays, and the app's continuous
/// animations (block cursor, status LED) make pumpAndSettle unusable.
Future<void> waitFor(
  WidgetTester tester,
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TestFailure('Timed out after $timeout waiting for condition');
    }
    await tester.pump(const Duration(milliseconds: 100));
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('signup, chat, logout, and sign-in flow', (tester) async {
    // Fresh state: no saved server URL or session cookie, so the app starts
    // on the server-setup screen instead of skipping ahead.
    SharedPreferences.setMockInitialValues({});

    final username = 'e2e${DateTime.now().millisecondsSinceEpoch}';
    const password = 'password123';
    const serverUrl = 'http://localhost:4173';

    app.main();
    await tester.pump();

    // ---- 1. Server setup ------------------------------------------------
    await waitFor(tester, () => find.text('Save & continue').evaluate().isNotEmpty);
    expect(find.text('Connect to server'), findsOneWidget);

    await tester.enterText(find.byType(TextField), serverUrl);
    await tester.pump();
    await tester.tap(find.text('Save & continue'));
    await tester.pump();

    // ---- 2. Sign up (via "Create one" on the login screen) --------------
    await waitFor(tester, () => find.textContaining('Create one').evaluate().isNotEmpty);
    expect(find.text('Log in'), findsWidgets);

    await tester.tap(find.textContaining('Create one'));
    await tester.pump();

    await waitFor(tester, () => find.text('Sign up').evaluate().isNotEmpty);
    expect(find.text('Create account'), findsOneWidget);

    // LoginScreen pushed this route, so until the push transition finishes
    // its TextFields are still on-stage and would shift byType(TextField)
    // indexes (seen on Android: the password landed in the login route's
    // username field). Wait for it to go offstage, then scope to this
    // screen regardless.
    await waitFor(tester, () => find.byType(LoginScreen).evaluate().isEmpty);
    final signupFields = find.descendant(
      of: find.byType(SignupScreen),
      matching: find.byType(TextField),
    );
    await tester.enterText(signupFields.at(0), username);
    await tester.enterText(signupFields.at(1), password);
    await tester.enterText(signupFields.at(2), password);
    await tester.pump();

    await tester.tap(find.widgetWithText(FilledButton, 'Sign up'));
    await tester.pump();

    // ---- 3. Landed on the session register (auto-logged in) -------------
    await waitFor(tester, () => find.text('New session').evaluate().isNotEmpty);
    expect(find.textContaining('@$username'), findsOneWidget);

    // ---- 4. Start a new session and chat --------------------------------
    await tester.tap(find.text('New session'));
    await tester.pump();

    // Wait for models to load and a model to be auto-selected (the model
    // name appears in the topbar picker), then the composer is usable.
    await waitFor(
      tester,
      () => find.textContaining('llama3').evaluate().isNotEmpty,
      timeout: const Duration(seconds: 30),
    );

    // Scope to ChatScreen: earlier routes (login/signup) can linger in the
    // Navigator stack with on-stage TextFields on some platforms.
    await tester.enterText(
      find.descendant(
        of: find.byType(ChatScreen),
        matching: find.byType(TextField),
      ),
      'Say hi in one word.',
    );
    await tester.pump();

    // Send and wait for the stream to finish (the "Stop" button disappears).
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();
    await waitFor(
      tester,
      () => find.byTooltip('Stop').evaluate().isEmpty,
      timeout: const Duration(seconds: 120),
    );

    // The assistant reply is the last SelectableText in the transcript.
    final replies = tester
        .widgetList<SelectableText>(find.byType(SelectableText))
        .map((w) => w.data ?? '')
        .toList();
    expect(replies.length, greaterThanOrEqualTo(2),
        reason: 'expected a user turn and an assistant reply');
    final reply = replies.last;
    expect(reply, isNotEmpty, reason: 'assistant reply should not be empty');
    expect(reply.startsWith('Error:'), isFalse,
        reason: 'assistant reply was an error: "$reply"');

    // ---- 5. Back out, log out, and sign back in -------------------------
    await tester.pageBack();
    await tester.pump();
    await waitFor(tester, () => find.text('Log out').evaluate().isNotEmpty);

    await tester.tap(find.text('Log out'));
    await tester.pump();

    await waitFor(tester, () => find.widgetWithText(FilledButton, 'Log in').evaluate().isNotEmpty);
    final loginFields = find.descendant(
      of: find.byType(LoginScreen),
      matching: find.byType(TextField),
    );
    await tester.enterText(loginFields.at(0), username);
    await tester.enterText(loginFields.at(1), password);
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Log in'));
    await tester.pump();

    // Back on the register, still the same account.
    await waitFor(tester, () => find.text('New session').evaluate().isNotEmpty);
    expect(find.textContaining('@$username'), findsOneWidget);
  });
}
