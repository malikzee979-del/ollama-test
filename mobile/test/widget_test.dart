// Basic smoke test: the app boots and shows a loading state (before any
// server is configured, AppState.init() hasn't resolved yet on the first
// frame) without throwing.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ollama_chat_mobile/app_state.dart';
import 'package:ollama_chat_mobile/main.dart';

void main() {
  testWidgets('app boots to a loading indicator before init completes', (tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AppState()..init(),
        child: const OllamaChatApp(),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
