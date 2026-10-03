import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'models.dart';

/// App-wide state: the configured server + current session, shared via
/// `provider` so any screen can read/react to login state without manually
/// threading callbacks through the whole widget tree.
class AppState extends ChangeNotifier {
  static const _prefsThemeKey = 'theme_mode';

  ApiClient? _client;
  ChatUser? user;
  bool initializing = true;

  /// Console theme is dark-native (matching the web frontend), with a
  /// light "paper" alternate. Persisted across launches.
  ThemeMode themeMode = ThemeMode.dark;

  ApiClient get client => _client!;
  bool get isConfigured => _client?.isConfigured ?? false;
  bool get isLoggedIn => user != null;

  Future<void> init() async {
    _client = await ApiClient.load();
    final prefs = await SharedPreferences.getInstance();
    final savedTheme = prefs.getString(_prefsThemeKey);
    themeMode = switch (savedTheme) {
      'light' => ThemeMode.light,
      'system' => ThemeMode.system,
      _ => ThemeMode.dark,
    };
    if (_client!.isConfigured && _client!.isLoggedIn) {
      try {
        user = await _client!.me();
      } catch (_) {
        // Server unreachable or session expired — fall through to login.
        user = null;
      }
    }
    initializing = false;
    notifyListeners();
  }

  Future<void> setServerUrl(String url) async {
    await _client!.setServerUrl(url);
    // ApiClient drops any existing session cookie when the URL actually
    // changes (it belongs to a different server) — mirror that here so
    // the UI doesn't keep showing a logged-in state with no valid session.
    if (!_client!.isLoggedIn) user = null;
    notifyListeners();
  }

  void setUser(ChatUser? newUser) {
    user = newUser;
    notifyListeners();
  }

  Future<void> logout() async {
    await _client!.logout();
    user = null;
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    themeMode = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsThemeKey, switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.system => 'system',
      ThemeMode.dark => 'dark',
    });
    notifyListeners();
  }

  void toggleTheme() {
    setThemeMode(
      themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark,
    );
  }
}
