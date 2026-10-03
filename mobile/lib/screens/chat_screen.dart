import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class ChatScreen extends StatefulWidget {
  final String sessionId;
  final String initialTitle;

  const ChatScreen({
    super.key,
    required this.sessionId,
    required this.initialTitle,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scrollController = ScrollController();
  final List<ChatMessage> _messages = [];
  List<String> _models = [];
  String? _selectedModel;
  bool _loadingSession = true;
  bool _sending = false;
  bool _hasText = false;
  bool _composerFocused = false;
  http.Client? _activeStreamClient;
  String? _loadError;
  late String _title;

  @override
  void initState() {
    super.initState();
    _title = widget.initialTitle;
    _input.addListener(() {
      final hasText = _input.text.trim().isNotEmpty;
      if (hasText != _hasText) setState(() => _hasText = hasText);
    });
    _loadAll();
  }

  Future<void> _loadAll() async {
    final appState = context.read<AppState>();
    try {
      final results = await Future.wait([
        appState.client.getSession(widget.sessionId),
        appState.client.listModels(),
      ]);
      final session = results[0] as ChatSessionFull;
      final models = results[1] as List<String>;
      setState(() {
        _messages.addAll(session.messages);
        _title = session.title;
        _models = models;
        _selectedModel = models.isNotEmpty ? models.first : null;
        _loadingSession = false;
      });
    } catch (err) {
      setState(() {
        _loadError = err is ApiException
            ? err.message
            : 'Could not load this chat: $err';
        _loadingSession = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _selectedModel == null || _sending) return;

    final userMessage = ChatMessage(role: 'user', content: text);
    final assistantMessage =
        ChatMessage(role: 'assistant', content: '', model: _selectedModel);

    setState(() {
      _messages.add(userMessage);
      _messages.add(assistantMessage);
      _sending = true;
    });
    _input.clear();
    _scrollToBottom();

    final appState = context.read<AppState>();
    // Send full prior history (excluding the empty assistant placeholder
    // we just added) so the model has context, same as the web frontend.
    final history = _messages.sublist(0, _messages.length - 1);

    try {
      final stream = appState.client.chatStream(
        _selectedModel!,
        history,
        onClient: (client) => _activeStreamClient = client,
      );
      await for (final delta in stream) {
        setState(() => assistantMessage.content += delta);
        _scrollToBottom();
      }
    } catch (err) {
      final message = err is ApiException ? err.message : '$err';
      setState(() {
        assistantMessage.content = assistantMessage.content.isEmpty
            ? 'Error: $message'
            : '${assistantMessage.content}\n\n_[stopped: $message]_';
      });
    } finally {
      _activeStreamClient = null;
      if (mounted) setState(() => _sending = false);
    }

    // Persist this turn regardless of how the stream ended — success,
    // error, or a Stop tap. Previously this only ran on the success path,
    // so a network error or user-initiated stop silently dropped the
    // user's message (and any partial assistant reply) that was still
    // visible on screen: reopening the session later, that whole turn was
    // simply gone. This call is itself best-effort: if persistence fails
    // too (e.g. the server just went unreachable), the turn stays visible
    // in this screen's in-memory `_messages` until the app is closed, but
    // there's no offline queue to retry it later.
    try {
      await appState.client.appendMessages(
        widget.sessionId,
        [userMessage, assistantMessage],
      );
    } catch (_) {}
  }

  void _stop() {
    _activeStreamClient?.close();
  }

  void _pickModel() {
    if (_models.isEmpty) return;
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) {
        final c = sheetContext.console;
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  border: Border(bottom: BorderSide(color: c.border)),
                ),
                child: const Plate('Select model'),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final m in _models)
                      _ModelRow(
                        model: m,
                        selected: m == _selectedModel,
                        enabled: !_sending,
                        onTap: () {
                          setState(() => _selectedModel = m);
                          Navigator.of(sheetContext).pop();
                        },
                      ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    _activeStreamClient?.close();
    _input.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    return Scaffold(
      appBar: AppBar(
        title: _models.isEmpty
            ? Text(_title, overflow: TextOverflow.ellipsis)
            : InkWell(
                onTap: _pickModel,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Plate('Model'),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        _selectedModel ?? _title,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: monoFamily,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: c.text,
                        ),
                      ),
                    ),
                    const SizedBox(width: 2),
                    Icon(Icons.keyboard_arrow_down, size: 18, color: c.textFaint),
                  ],
                ),
              ),
      ),
      body: _loadingSession
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: ConsoleBanner(message: _loadError!),
                  ),
                )
              : Column(
                  children: [
                    Expanded(child: _buildTranscript()),
                    _buildComposer(),
                  ],
                ),
    );
  }

  Widget _buildTranscript() {
    if (_messages.isEmpty) {
      return _EmptyMotd();
    }
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.only(bottom: 16),
      itemCount: _messages.length,
      itemBuilder: (context, index) {
        final message = _messages[index];
        final isUser = message.role == 'user';
        final isStreaming = !isUser &&
            _sending &&
            index == _messages.length - 1;
        final isThinking =
            isStreaming && message.content.isEmpty;
        return _buildMessageRow(message, isUser, isStreaming, isThinking);
      },
    );
  }

  Widget _buildMessageRow(
    ChatMessage message,
    bool isUser,
    bool isStreaming,
    bool isThinking,
  ) {
    final c = context.console;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      decoration: BoxDecoration(
        color: isUser ? c.bgElevated : null,
        border: Border(
          left: BorderSide(
            color: isUser ? c.accent : Colors.transparent,
            width: 2,
          ),
          bottom: BorderSide(color: c.borderSoft),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Avatar(isUser: isUser),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isUser ? 'USER' : 'ASSISTANT',
                  style: TextStyle(
                    fontFamily: monoFamily,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.26,
                    color: isUser ? c.accent : c.textFaint,
                  ),
                ),
                const SizedBox(height: 8),
                _MessageContent(
                  message: message,
                  isUser: isUser,
                  isThinking: isThinking,
                  isStreaming: isStreaming,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildComposer() {
    final c = context.console;
    final canSend = _hasText && _selectedModel != null && !_sending;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        decoration: BoxDecoration(
          color: c.bg,
          border: Border(top: BorderSide(color: c.border)),
        ),
        child: Focus(
          onFocusChange: (v) => setState(() => _composerFocused = v),
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 4, 6, 4),
            decoration: BoxDecoration(
              color: c.bgElevated,
              border: Border.all(color: _composerFocused ? c.accent : c.border),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 11),
                  child: Text(
                    '>',
                    style: TextStyle(
                      fontFamily: monoFamily,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      height: 1,
                      color: c.accent,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 120),
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 6,
                      textInputAction: TextInputAction.newline,
                      enabled: !_sending,
                      style: TextStyle(
                        fontFamily: monoFamily,
                        fontSize: 14,
                        height: 1.55,
                        color: c.text,
                      ),
                      decoration: InputDecoration(
                        hintText: 'Message your local model…',
                        hintStyle: TextStyle(
                          fontFamily: monoFamily,
                          fontSize: 14,
                          color: c.textFaint,
                        ),
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: _sending ? _stopButton() : _sendButton(canSend),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _sendButton(bool canSend) {
    final c = context.console;
    return SizedBox(
      width: 32,
      height: 32,
      child: IconButton(
        padding: EdgeInsets.zero,
        tooltip: 'Send',
        onPressed: canSend ? _send : null,
        icon: const Icon(Icons.arrow_upward, size: 15),
        style: IconButton.styleFrom(
          backgroundColor: c.accent,
          foregroundColor: c.accentContrast,
          disabledBackgroundColor: c.bgElevated3,
          disabledForegroundColor: c.textFaint,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        ),
      ),
    );
  }

  Widget _stopButton() {
    final c = context.console;
    return SizedBox(
      width: 32,
      height: 32,
      child: IconButton(
        padding: EdgeInsets.zero,
        tooltip: 'Stop',
        onPressed: _stop,
        icon: const Icon(Icons.stop, size: 15),
        style: IconButton.styleFrom(
          backgroundColor: c.danger,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        ),
      ),
    );
  }
}

/// The square turn marker: amber-tinted for the user, plain hardware for the
/// assistant — the `.msg-avatar` from style.css.
class _Avatar extends StatelessWidget {
  final bool isUser;
  const _Avatar({required this.isUser});

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        color: isUser ? c.accentSoft : c.bgElevated2,
        border: Border.all(color: isUser ? c.accentLine : c.border),
      ),
      child: Icon(
        isUser ? Icons.person_outline : Icons.terminal,
        size: 12,
        color: isUser ? c.accent : c.textFaint,
      ),
    );
  }
}

/// Message prose in IBM Plex Sans, with the block cursor appended to a
/// streaming reply and the marching blocks shown while waiting for the
/// first token.
class _MessageContent extends StatelessWidget {
  final ChatMessage message;
  final bool isUser;
  final bool isThinking;
  final bool isStreaming;

  const _MessageContent({
    required this.message,
    required this.isUser,
    required this.isThinking,
    required this.isStreaming,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    final prose = TextStyle(
      fontFamily: sansFamily,
      fontSize: 16,
      height: 1.6,
      color: c.text,
    );

    if (isUser) {
      return SelectableText(message.content, style: prose);
    }
    if (isThinking) {
      return const _MarchingBlocks();
    }
    if (isStreaming) {
      return Text.rich(
        TextSpan(
          style: prose,
          children: [
            TextSpan(text: message.content),
            const WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: BlockCursor(width: 8, height: 16),
            ),
          ],
        ),
      );
    }
    return SelectableText(message.content, style: prose);
  }
}

/// The "waiting on the first token" state: three square amber blocks
/// marching, matching the cursor (the `.typing-dots` from style.css).
class _MarchingBlocks extends StatefulWidget {
  const _MarchingBlocks();

  @override
  State<_MarchingBlocks> createState() => _MarchingBlocksState();
}

class _MarchingBlocksState extends State<_MarchingBlocks>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    return SizedBox(
      height: 20,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: List.generate(3, (i) {
              final phase = (_controller.value + i * (1 / 3)) % 1.0;
              final opacity = phase >= 0.33 && phase <= 0.66 ? 1.0 : 0.25;
              return Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Opacity(
                  opacity: opacity,
                  child: Container(width: 6, height: 11, color: c.accent),
                ),
              );
            }),
          );
        },
      ),
    );
  }
}

/// A model row in the picker sheet — a hairline ledger line with a check on
/// the selected model.
class _ModelRow extends StatelessWidget {
  final String model;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _ModelRow({
    required this.model,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    return InkWell(
      onTap: enabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? c.bgElevated2 : null,
          border: Border(
            bottom: BorderSide(color: c.borderSoft),
            left: BorderSide(
              color: selected ? c.accent : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                model,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: monoFamily,
                  fontSize: 13,
                  color: selected ? c.text : c.textDim,
                ),
              ),
            ),
            if (selected) Icon(Icons.check, size: 16, color: c.accent),
          ],
        ),
      ),
    );
  }
}

/// The boot banner shown before the first message: brand mark, a spec-sheet
/// of facts, and one line of instruction — the `.empty-state` motd.
class _EmptyMotd extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = context.console;
    final host = _hostLabel(context);
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const BrandMark(size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Ollama Chat',
                style: TextStyle(
                  fontFamily: monoFamily,
                  fontSize: 19,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.19,
                  color: c.text,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: c.border)),
          ),
          child: Column(
            children: [
              _FactRow(label: 'HOST', value: host),
              _FactRow(label: 'SESSIONS', value: 'Stored on this machine, scoped to your account'),
              _FactRow(label: 'NETWORK', value: 'Nothing you type or generate leaves the machine'),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'Pick a model above and start typing. Every turn streams straight '
          'from the daemon running on your own hardware.',
          style: TextStyle(
            fontFamily: sansFamily,
            fontSize: 14,
            height: 1.6,
            color: c.textDim,
          ),
        ),
      ],
    );
  }

  String _hostLabel(BuildContext context) {
    final base = context.read<AppState>().client.baseUrl;
    if (base == null) return '—';
    final uri = Uri.tryParse(base);
    if (uri == null || uri.host.isEmpty) return base;
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '${uri.host}$port — local Ollama daemon';
  }
}

/// One `dt`/`dd` line of the motd spec sheet.
class _FactRow extends StatelessWidget {
  final String label;
  final String value;

  const _FactRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 84,
            child: Text(
              label,
              style: TextStyle(
                fontFamily: monoFamily,
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.05,
                color: c.textFaint,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontFamily: monoFamily,
                fontSize: 12,
                height: 1.5,
                color: c.textDim,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
