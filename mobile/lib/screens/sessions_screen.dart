import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'chat_screen.dart';
import 'server_setup_screen.dart';

/// The chat register — the mobile port of the web frontend's sidebar. A
/// numbered ledger of sessions on hairlines with a status rail footer, not
/// a stack of soft cards.
class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key});

  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  late Future<List<ChatSessionSummary>> _future;
  LedState _led = LedState.idle;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<ChatSessionSummary>> _load() async {
    try {
      final sessions = await context.read<AppState>().client.listSessions();
      if (mounted) setState(() => _led = LedState.ok);
      return sessions;
    } catch (_) {
      if (mounted) setState(() => _led = LedState.bad);
      rethrow;
    }
  }

  void _refresh() {
    // Must be a block body, not `setState(() => _future = _load())`: an
    // arrow-function body is an expression, and an assignment expression
    // evaluates to its right-hand value — the Future itself — so that
    // form makes the closure return a Future. setState() asserts its
    // callback must be synchronous and throws before marking the widget
    // dirty when it isn't, so the reassignment above never actually
    // triggered a rebuild and this screen silently kept showing stale
    // (often empty) session data after every refresh.
    setState(() {
      _future = _load();
    });
  }

  Future<void> _openNewChat() async {
    final appState = context.read<AppState>();
    final session = await appState.client.createSession();
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            ChatScreen(sessionId: session.id, initialTitle: session.title),
      ),
    );
    _refresh();
  }

  Future<void> _openSession(ChatSessionSummary summary) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            ChatScreen(sessionId: summary.id, initialTitle: summary.title),
      ),
    );
    _refresh();
  }

  Future<void> _deleteSession(ChatSessionSummary summary) async {
    final appState = context.read<AppState>();
    try {
      await appState.client.deleteSession(summary.id);
      _refresh();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not delete chat: $err')),
      );
    }
  }

  String _hostLabel() {
    final base = context.read<AppState>().client.baseUrl;
    if (base == null) return '';
    final uri = Uri.tryParse(base);
    if (uri == null || uri.host.isEmpty) return base;
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '${uri.host}$port';
  }

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    final appState = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            BrandMark(size: 14),
            SizedBox(width: 8),
            Plate('ollama-chat'),
          ],
        ),
      ),
      body: Column(
        children: [
          // "+ New session" — the sidebar-header button, full width.
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _openNewChat,
                style: OutlinedButton.styleFrom(
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  side: BorderSide(color: c.border),
                  foregroundColor: c.text,
                  backgroundColor: Colors.transparent,
                ),
                icon: Icon(Icons.add, size: 16, color: c.textDim),
                label: const Text('New session'),
              ),
            ),
          ),
          Divider(color: c.border),
          Expanded(
            child: RefreshIndicator(
              color: c.accent,
              backgroundColor: c.bgElevated,
              onRefresh: () async {
                _refresh();
                await _future;
              },
              child: FutureBuilder<List<ChatSessionSummary>>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: ConsoleBanner(
                          message: 'Could not load chats: ${snapshot.error}',
                        ),
                      ),
                    );
                  }
                  final sessions = snapshot.data ?? [];
                  if (sessions.isEmpty) {
                    return _EmptyRegister(c: c);
                  }
                  return ListView.separated(
                    itemCount: sessions.length,
                    separatorBuilder: (_, _) => Divider(color: c.borderSoft, height: 1),
                    itemBuilder: (context, index) =>
                        _LedgerRow(
                      index: index,
                      session: sessions[index],
                      onTap: () => _openSession(sessions[index]),
                      onDelete: () => _deleteSession(sessions[index]),
                    ),
                  );
                },
              ),
            ),
          ),
          _StatusRail(c: c, appState: appState, host: _hostLabel(), led: _led),
        ],
      ),
    );
  }
}

class _EmptyRegister extends StatelessWidget {
  final ConsoleColors c;
  const _EmptyRegister({required this.c});

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            children: [
              Text(
                'NO SESSIONS',
                style: plateStyle(c.textFaint),
              ),
              const SizedBox(height: 12),
              Text(
                'Nothing on the register yet. Start a new session to begin.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: monoFamily,
                  fontSize: 12.5,
                  height: 1.6,
                  color: c.textDim,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// A ledger row: mono index, title + updated time, delete. Hairline
/// separators only — the index is the register's order, not decoration.
class _LedgerRow extends StatelessWidget {
  final int index;
  final ChatSessionSummary session;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _LedgerRow({
    required this.index,
    required this.session,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: Colors.transparent, width: 2)),
        ),
        child: Row(
          children: [
            Text(
              (index + 1).toString().padLeft(2, '0'),
              style: TextStyle(
                fontFamily: monoFamily,
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.42,
                color: c.textFaint,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: monoFamily,
                      fontSize: 12.5,
                      color: c.textDim,
                    ),
                  ),
                  if (session.updatedAt.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      session.updatedAt,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: monoFamily,
                        fontSize: 10.5,
                        color: c.textFaint,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            IconButton(
              tooltip: 'Delete',
              icon: const Icon(Icons.close),
              iconSize: 18,
              color: c.textFaint,
              onPressed: onDelete,
            ),
          ],
        ),
      ),
    );
  }
}

/// The tmux-style bottom rail: LED + status, theme toggle, settings, and the
/// @user / log out row — the sidebar-footer ported to a mobile screen.
class _StatusRail extends StatelessWidget {
  final ConsoleColors c;
  final AppState appState;
  final String host;
  final LedState led;

  const _StatusRail({
    required this.c,
    required this.appState,
    required this.host,
    required this.led,
  });

  @override
  Widget build(BuildContext context) {
    final dark = appState.themeMode == ThemeMode.dark;
    return Container(
      decoration: BoxDecoration(
        color: c.bgElevated,
        border: Border(top: BorderSide(color: c.border)),
      ),
      padding: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Connection status.
          Row(
            children: [
              StatusLed(state: led),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  host.isEmpty ? 'local' : host,
                  style: TextStyle(
                    fontFamily: monoFamily,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.05,
                    color: c.textDim,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: appState.toggleTheme,
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: Colors.transparent),
                    foregroundColor: c.textDim,
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                  ),
                  icon: Icon(
                    dark ? Icons.dark_mode_outlined : Icons.light_mode_outlined,
                    size: 15,
                  ),
                  label: Text(dark ? 'Dark mode' : 'Light mode'),
                ),
              ),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ServerSetupScreen()),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: Colors.transparent),
                    foregroundColor: c.textDim,
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                  ),
                  icon: const Icon(Icons.settings_outlined, size: 15),
                  label: const Text('Settings'),
                ),
              ),
            ],
          ),
          // User row.
          Container(
            margin: const EdgeInsets.only(top: 4),
            padding: const EdgeInsets.only(top: 8),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: c.borderSoft)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '@${appState.user?.username ?? ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: monoFamily,
                      fontSize: 11.5,
                      color: c.textDim,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: appState.logout,
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                    minimumSize: const Size(0, 24),
                    foregroundColor: c.textDim,
                  ),
                  child: const Text('Log out'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
