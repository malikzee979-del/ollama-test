import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../app_state.dart';
import '../theme.dart';
import '../widgets.dart';

/// First-run (and settings-accessible) screen for pointing the app at the
/// Ollama Chat server. The phone and the server must be reachable from
/// each other — typically the same Wi-Fi network, using the server
/// machine's LAN IP (e.g. http://192.168.1.42:4173), not "localhost".
class ServerSetupScreen extends StatefulWidget {
  final VoidCallback? onSaved;

  const ServerSetupScreen({super.key, this.onSaved});

  @override
  State<ServerSetupScreen> createState() => _ServerSetupScreenState();
}

class _ServerSetupScreenState extends State<ServerSetupScreen> {
  final _controller = TextEditingController();
  bool _checking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final existing = context.read<AppState>().client.baseUrl;
    if (existing != null) _controller.text = existing;
  }

  Future<void> _save() async {
    final url = _controller.text.trim();
    if (url.isEmpty || !(url.startsWith('http://') || url.startsWith('https://'))) {
      setState(() => _error = 'Enter a full URL, e.g. http://192.168.1.42:4173');
      return;
    }
    setState(() {
      _checking = true;
      _error = null;
    });

    final appState = context.read<AppState>();
    try {
      // Verify the candidate URL is reachable *before* saving it — saving
      // first (then rolling back on failure) is fragile: on a first run
      // there's no previous URL to roll back to, so a bad URL would stay
      // saved and silently take the user past this screen anyway.
      await appState.client.pingUrl(url);
      await appState.setServerUrl(url);
      widget.onSaved?.call();
      // If this screen was pushed on top of another (e.g. opened from the
      // settings icon rather than shown as the initial screen), return to
      // it now that the new URL is saved and confirmed reachable.
      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
    } catch (err) {
      setState(() {
        _error = err is ApiException
            ? err.message
            : 'Could not reach that server. Check the URL and that your '
                'phone is on the same network.';
      });
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    final canPop = Navigator.of(context).canPop();
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight - 32),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 400),
                    child: Container(
                      decoration: BoxDecoration(
                        color: c.bg,
                        border: Border.all(color: c.border),
                        boxShadow: [
                          BoxShadow(
                            color: c.windowCast,
                            offset: const Offset(8, 8),
                            blurRadius: 0,
                          ),
                        ],
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Titlebar.
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                            decoration: BoxDecoration(
                              color: c.bgElevated,
                              border: Border(bottom: BorderSide(color: c.border)),
                            ),
                            child: Row(
                              children: [
                                if (canPop)
                                  IconButton(
                                    tooltip: 'Back',
                                    icon: const Icon(Icons.arrow_back),
                                    color: c.textFaint,
                                    onPressed: () => Navigator.of(context).pop(),
                                  )
                                else
                                  const BrandMark(size: 15),
                                const SizedBox(width: 10),
                                const Expanded(child: Plate('ollama-chat / server')),
                              ],
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.center,
                                  children: [
                                    Flexible(
                                      child: Text(
                                        'Connect to server',
                                        style: TextStyle(
                                          fontFamily: monoFamily,
                                          fontSize: 17,
                                          fontWeight: FontWeight.w600,
                                          letterSpacing: -0.17,
                                          color: c.text,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    const BlockCursor(),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Enter the address of the machine running '
                                  'Ollama Chat (npm start). Your phone must be '
                                  'able to reach it — usually the same Wi-Fi '
                                  'network, using its LAN IP.',
                                  style: TextStyle(
                                    fontFamily: monoFamily,
                                    fontSize: 12,
                                    height: 1.6,
                                    color: c.textDim,
                                  ),
                                ),
                                const SizedBox(height: 20),
                                if (_error != null) ...[
                                  ConsoleBanner(message: _error!),
                                  const SizedBox(height: 16),
                                ],
                                TextField(
                                  controller: _controller,
                                  keyboardType: TextInputType.url,
                                  autocorrect: false,
                                  decoration: const InputDecoration(
                                    labelText: 'Server URL',
                                    hintText: 'http://192.168.1.42:4173',
                                  ),
                                  onSubmitted: (_) => _save(),
                                ),
                                const SizedBox(height: 20),
                                FilledButton(
                                  onPressed: _checking ? null : _save,
                                  child: _checking
                                      ? SizedBox(
                                          height: 18,
                                          width: 18,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: c.accentContrast,
                                          ),
                                        )
                                      : const Text('Save & continue'),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
