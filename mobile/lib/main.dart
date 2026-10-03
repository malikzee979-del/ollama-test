import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_state.dart';
import 'screens/login_screen.dart';
import 'screens/server_setup_screen.dart';
import 'screens/sessions_screen.dart';
import 'theme.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => AppState()..init(),
      child: const OllamaChatApp(),
    ),
  );
}

class OllamaChatApp extends StatelessWidget {
  const OllamaChatApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Watch AppState (not just _Root) so a theme toggle rebuilds the whole
    // MaterialApp with the new themeMode instead of leaving it stale.
    return Consumer<AppState>(
      builder: (context, appState, _) => MaterialApp(
        title: 'Ollama Chat',
        theme: consoleTheme(Brightness.light),
        darkTheme: consoleTheme(Brightness.dark),
        themeMode: appState.themeMode,
        home: const _Root(),
      ),
    );
  }
}

/// Picks the starting screen based on app state: configure the server
/// first, then log in, then land on the chat list.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();

    if (appState.initializing) {
      return Scaffold(
        body: Center(
          child: CircularProgressIndicator(
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
      );
    }
    if (!appState.isConfigured) {
      // No onSaved callback needed here: saving the URL calls
      // AppState.notifyListeners(), and this widget already watches
      // AppState, so it rebuilds on its own once isConfigured flips true.
      return const ServerSetupScreen();
    }
    if (!appState.isLoggedIn) {
      return const LoginScreen();
    }
    return const SessionsScreen();
  }
}
