import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api_client.dart';
import '../app_state.dart';
import '../theme.dart';
import '../widgets.dart';

/// Mirrors the signup rules enforced server-side (see auth.js /
/// README.md#authentication): username 3-32 chars of letters/numbers/
/// `_`/`.`/`-`, password 8+ chars. Client-side validation here is just for
/// a faster error message — the server re-validates regardless.
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _signup() async {
    if (_password.text != _confirm.text) {
      setState(() => _error = 'Passwords do not match.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final appState = context.read<AppState>();
      final user = await appState.client.signup(_username.text.trim(), _password.text);
      appState.setUser(user);
      // SignupScreen is reached via Navigator.push from LoginScreen. _Root
      // (see main.dart) swaps its home content to SessionsScreen once
      // isLoggedIn flips true, but that stays hidden behind this pushed
      // route unless we pop back to it.
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (err) {
      setState(() {
        _error = err is ApiException ? err.message : 'Sign up failed: $err';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
            child: const Row(
              children: [
                BrandMark(size: 15),
                SizedBox(width: 10),
                Expanded(child: Plate('ollama-chat / new account')),
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
                        'Create account',
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
                  'The account is created in a SQLite file on this machine. '
                  'There is no server to register with.',
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
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    helperText: '3–32 characters: letters, numbers, "_", "." or "-".',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'Password',
                    helperText: 'At least 8 characters.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _confirm,
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(labelText: 'Confirm password'),
                  onSubmitted: (_) => _signup(),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _signup,
                  child: _busy
                      ? SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: c.accentContrast,
                          ),
                        )
                      : const Text('Sign up'),
                ),
                const SizedBox(height: 16),
                const AuthMeta(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
