import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// Thrown for any non-2xx response, carrying the server's `{ error }`
/// message when available so screens can show something useful.
class ApiException implements Exception {
  final int statusCode;
  final String message;

  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

/// Talks to the existing Express server (see ../../server.js) over plain
/// HTTP(S). Auth uses the same opaque session-cookie scheme the web
/// frontend uses (see auth.js) — the cookie is marked HttpOnly, which only
/// restricts browser JS from reading it, not a native HTTP client, so we
/// just capture the `Set-Cookie` header on login/signup and resend it as
/// `Cookie` on every later request, persisting it in SharedPreferences so
/// the user stays logged in across app launches.
class ApiClient {
  static const _prefsServerUrlKey = 'server_url';
  static const _prefsCookieKey = 'session_cookie';

  String? baseUrl;
  String? _cookie;

  ApiClient._();

  static Future<ApiClient> load() async {
    final client = ApiClient._();
    final prefs = await SharedPreferences.getInstance();
    client.baseUrl = prefs.getString(_prefsServerUrlKey);
    client._cookie = prefs.getString(_prefsCookieKey);
    return client;
  }

  // Strips trailing slashes so path joins in _uri() don't double up.
  String _stripTrailingSlashes(String value) {
    var result = value;
    while (result.endsWith('/')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }

  Future<void> setServerUrl(String url) async {
    final normalized = _stripTrailingSlashes(url.trim());
    final changed = normalized != baseUrl;
    baseUrl = normalized;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsServerUrlKey, baseUrl!);
    // A session cookie from a different server is meaningless (and
    // possibly a security footgun) here — drop it so the app re-prompts
    // for login against the newly configured server.
    if (changed) await _clearCookie();
  }

  bool get isConfigured => baseUrl != null && baseUrl!.isNotEmpty;
  bool get isLoggedIn => _cookie != null;

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        if (_cookie != null) 'Cookie': _cookie!,
      };

  Future<void> _captureCookie(http.Response res) async {
    final setCookie = res.headers['set-cookie'];
    if (setCookie == null) return;
    // Only the "name=value" portion matters for resending; drop the
    // Path/HttpOnly/SameSite/Expires attributes.
    _cookie = setCookie.split(';').first.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsCookieKey, _cookie!);
  }

  Future<void> _clearCookie() async {
    _cookie = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsCookieKey);
  }

  dynamic _decodeOrThrow(http.Response res) {
    Map<String, dynamic>? body;
    try {
      if (res.body.isNotEmpty) {
        body = jsonDecode(res.body) as Map<String, dynamic>;
      }
    } catch (_) {
      // Non-JSON body (e.g. an HTML error page) — fall through to the
      // generic message below.
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final message = (body?['error'] as String?) ??
          'Request failed with status ${res.statusCode}.';
      throw ApiException(res.statusCode, message);
    }
    return body;
  }

  /// Basic reachability check against the always-public `/api/auth/me`
  /// route — used by the server-setup screen to validate a URL *before*
  /// saving it (see [setServerUrl]), without requiring login first. Takes
  /// the candidate URL directly rather than using [baseUrl], so a bad URL
  /// never gets persisted just because it happened to be checked.
  Future<void> pingUrl(String url) async {
    final normalized = _stripTrailingSlashes(url.trim());
    final res = await http
        .get(Uri.parse('$normalized/api/auth/me'))
        .timeout(const Duration(seconds: 8));
    _decodeOrThrow(res);
  }

  Future<ChatUser> signup(String username, String password) async {
    final res = await http.post(
      _uri('/api/auth/signup'),
      headers: _headers(),
      body: jsonEncode({'username': username, 'password': password}),
    );
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    await _captureCookie(res);
    return ChatUser.fromJson(body['user'] as Map<String, dynamic>);
  }

  Future<ChatUser> login(String username, String password) async {
    final res = await http.post(
      _uri('/api/auth/login'),
      headers: _headers(),
      body: jsonEncode({'username': username, 'password': password}),
    );
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    await _captureCookie(res);
    return ChatUser.fromJson(body['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    try {
      await http.post(_uri('/api/auth/logout'), headers: _headers());
    } finally {
      await _clearCookie();
    }
  }

  Future<ChatUser?> me() async {
    final res = await http.get(_uri('/api/auth/me'), headers: _headers());
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    final user = body['user'];
    return user == null ? null : ChatUser.fromJson(user as Map<String, dynamic>);
  }

  Future<List<String>> listModels() async {
    final res = await http.get(_uri('/api/models'), headers: _headers());
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    final models = (body['models'] as List<dynamic>? ?? []);
    return models
        .map((m) => (m as Map<String, dynamic>)['name'] as String)
        .toList();
  }

  Future<List<ChatSessionSummary>> listSessions() async {
    final res = await http.get(_uri('/api/sessions'), headers: _headers());
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    final sessions = (body['sessions'] as List<dynamic>? ?? []);
    return sessions
        .map((s) => ChatSessionSummary.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  Future<ChatSessionFull> createSession({String? title}) async {
    final res = await http.post(
      _uri('/api/sessions'),
      headers: _headers(),
      body: jsonEncode({if (title != null) 'title': title}),
    );
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    return ChatSessionFull.fromJson(body);
  }

  Future<ChatSessionFull> getSession(String id) async {
    final res =
        await http.get(_uri('/api/sessions/$id'), headers: _headers());
    final body = _decodeOrThrow(res) as Map<String, dynamic>;
    return ChatSessionFull.fromJson(body);
  }

  Future<void> appendMessages(
    String sessionId,
    List<ChatMessage> messages, {
    String? title,
  }) async {
    final res = await http.patch(
      _uri('/api/sessions/$sessionId'),
      headers: _headers(),
      body: jsonEncode({
        if (title != null) 'title': title,
        'appendMessages': messages.map((m) => m.toJson()).toList(),
      }),
    );
    _decodeOrThrow(res);
  }

  Future<void> deleteSession(String id) async {
    final res =
        await http.delete(_uri('/api/sessions/$id'), headers: _headers());
    _decodeOrThrow(res);
  }

  /// Streams an assistant reply for `messages` against `model`, yielding
  /// each incremental content delta as it arrives from the server's
  /// newline-delimited JSON `/api/chat` proxy (see server.js). Mirrors the
  /// web frontend's parsing in public/app.js.
  ///
  /// Exposes the underlying [http.Client] via [onClient] so callers can
  /// close it early to cancel an in-flight stream (e.g. a "Stop" button).
  Stream<String> chatStream(
    String model,
    List<ChatMessage> messages, {
    void Function(http.Client client)? onClient,
  }) async* {
    final client = http.Client();
    onClient?.call(client);
    try {
      final request = http.Request('POST', _uri('/api/chat'));
      request.headers.addAll(_headers());
      request.body = jsonEncode({
        'model': model,
        'messages': messages.map((m) => m.toJson()).toList(),
        'stream': true,
      });

      final streamedResponse = await client.send(request);
      if (streamedResponse.statusCode < 200 ||
          streamedResponse.statusCode >= 300) {
        final text = await streamedResponse.stream.bytesToString();
        String message = 'Chat request failed (${streamedResponse.statusCode}).';
        try {
          final decoded = jsonDecode(text) as Map<String, dynamic>;
          message = (decoded['error'] as String?) ?? message;
        } catch (_) {}
        throw ApiException(streamedResponse.statusCode, message);
      }

      var buffer = '';
      await for (final chunk in streamedResponse.stream.transform(utf8.decoder)) {
        buffer += chunk;
        var newlineIndex = buffer.indexOf('\n');
        while (newlineIndex != -1) {
          final line = buffer.substring(0, newlineIndex).trim();
          buffer = buffer.substring(newlineIndex + 1);
          if (line.isNotEmpty) {
            try {
              final json = jsonDecode(line) as Map<String, dynamic>;
              final message = json['message'] as Map<String, dynamic>?;
              final content = message?['content'] as String?;
              if (content != null && content.isNotEmpty) {
                yield content;
              }
            } catch (_) {
              // Ignore malformed lines rather than aborting the stream.
            }
          }
          newlineIndex = buffer.indexOf('\n');
        }
      }
    } finally {
      client.close();
    }
  }
}
