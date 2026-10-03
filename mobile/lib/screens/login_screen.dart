import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../app_state.dart';
import '../theme.dart';
import '../widgets.dart';
import 'server_setup_screen.dart';
import 'signup_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _login() async {
    if (_username.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter a username and password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final appState = context.read<AppState>();
      final user = await appState.client.login(_username.text.trim(), _password.text);
      appState.setUser(user);
      // LoginScreen is reached via Navigator.push from _Root's watch-based
      // rebuild (see main.dart) — _Root will swap to SessionsScreen once
      // isLoggedIn flips true, but that new root content stays hidden
      // behind this still-pushed route unless we pop back to it.
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (err) {
      setState(() {
        _error = err is ApiException ? err.message : 'Login failed: $err';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openSignup() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const SignupScreen()),
    );
  }

  void _openServerSetup() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ServerSetupScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.console;
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
                    child: _buildCard(c),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCard(ConsoleColors c) {
    return Container(
      decoration: BoxDecoration(
        color: c.bg,
        border: Border.all(color: c.border),
        boxShadow: [
          BoxShadow(color: c.windowCast, offset: const Offset(8, 8), blurRadius: 0),
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
                const BrandMark(size: 15),
                const SizedBox(width: 10),
                const Expanded(child: Plate('ollama-chat / auth')),
                IconButton(
                  tooltip: 'Change server',
                  icon: const Icon(Icons.settings_ethernet),
                  color: c.textFaint,
                  onPressed: _openServerSetup,
                ),
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
                        'Log in',
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
                  'This console runs models on your own hardware. '
                  'Sign in to open your sessions.',
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
                  controller: _username,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Username'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(labelText: 'Password'),
                  onSubmitted: (_) => _login(),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _login,
                  child: _busy
                      ? SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: c.accentContrast,
                          ),
                        )
                      : const Text('Log in'),
                ),
                const SizedBox(height: 16),
                const AuthMeta(),
                const SizedBox(height: 12),
                TextButton(
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 24),
                    alignment: Alignment.centerLeft,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: _busy ? null : _openSignup,
                  child: Text.rich(
                    TextSpan(
                      style: TextStyle(
                        fontFamily: monoFamily,
                        fontSize: 11.5,
                        color: c.textFaint,
                      ),
                      children: [
                        const TextSpan(text: 'No account yet? '),
                        TextSpan(
                          text: 'Create one',
                          style: TextStyle(
                            color: c.accent,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

