import 'package:flutter/material.dart';

import 'theme.dart';

/// The brand sigil: a square frame around a `>` prompt and a block cursor,
/// drawn as a stroke — the same SVG the web frontend ships as its favicon
/// and titlebar mark.
class BrandMark extends StatelessWidget {
  final double size;
  final Color? color;

  const BrandMark({super.key, this.size = 16, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ?? context.console.accent;
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _BrandMarkPainter(c)),
    );
  }
}

class _BrandMarkPainter extends CustomPainter {
  final Color color;

  _BrandMarkPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 24;
    canvas.scale(scale);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.75
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    canvas.drawRect(const Rect.fromLTWH(3, 3, 18, 18), paint);
    final chevron = Path()
      ..moveTo(7, 9)
      ..lineTo(10, 12)
      ..lineTo(7, 15);
    canvas.drawPath(chevron, paint);
    canvas.drawLine(const Offset(13, 15), const Offset(17, 15), paint);
  }

  @override
  bool shouldRepaint(covariant _BrandMarkPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Engraved panel label — the recurring chrome device. Mono, small, tracked
/// out, uppercase. Paired with a hairline wherever it appears.
class Plate extends StatelessWidget {
  final String text;
  final Color? color;

  const Plate(this.text, {super.key, this.color});

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: plateStyle(color ?? context.console.textFaint),
    );
  }
}

/// Square status LED, not a round dot — panel hardware. `.ok` breathes so a
/// live connection is visible without a label change; `.bad` is solid red;
/// idle is a quiet gray.
enum LedState { ok, bad, idle }

class StatusLed extends StatefulWidget {
  final LedState state;

  const StatusLed({super.key, required this.state});

  @override
  State<StatusLed> createState() => _StatusLedState();
}

class _StatusLedState extends State<StatusLed>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  );

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant StatusLed oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) _sync();
  }

  void _sync() {
    if (widget.state == LedState.ok) {
      _controller.repeat();
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    final color = switch (widget.state) {
      LedState.ok => c.success,
      LedState.bad => c.danger,
      LedState.idle => c.textFaint,
    };
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final opacity =
            widget.state == LedState.ok ? 1.0 - 0.55 * _controller.value : 1.0;
        return Opacity(
          opacity: opacity,
          child: Container(
            width: 7,
            height: 7,
            color: color,
          ),
        );
      },
    );
  }
}

/// The signature motion from the transcript: a solid amber block that blinks
/// on a 1.06s step — used at the end of the auth title and on a streaming
/// reply.
class BlockCursor extends StatefulWidget {
  final double width;
  final double height;
  final Color? color;

  const BlockCursor({
    super.key,
    this.width = 8,
    this.height = 15,
    this.color,
  });

  @override
  State<BlockCursor> createState() => _BlockCursorState();
}

class _BlockCursorState extends State<BlockCursor>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1060),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? context.console.accent;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => Opacity(
        opacity: _controller.value < 0.5 ? 1 : 0,
        child: Container(
          width: widget.width,
          height: widget.height,
          color: color,
        ),
      ),
    );
  }
}

/// A hairline-bound banner with a left marker bar. Danger by default
/// (`advisory: false`), amber when `advisory: true` — mirrors the web
/// frontend's error-banner / memory-warning pairing.
class ConsoleBanner extends StatelessWidget {
  final String message;
  final bool advisory;

  const ConsoleBanner({super.key, required this.message, this.advisory = false});

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    final Color bg = advisory ? c.accentSoft : c.dangerSoft;
    final Color line = advisory ? c.accentLine : c.dangerLine;
    final Color bar = advisory ? c.accent : c.danger;
    final Color fg = advisory ? c.textDim : c.danger;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: bg,
        border: Border(
          left: BorderSide(color: bar, width: 2),
          top: BorderSide(color: line),
          right: BorderSide(color: line),
          bottom: BorderSide(color: line),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            advisory ? Icons.info_outline : Icons.warning_amber_rounded,
            size: 14,
            color: bar,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontFamily: monoFamily,
                fontSize: 12,
                height: 1.5,
                color: fg,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The "Local SQLite / scrypt hashed / No network" fact strip from the auth
/// card — amber square bullets with engraved mono text.
class AuthMeta extends StatelessWidget {
  const AuthMeta({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.console;
    const items = ['Local SQLite', 'scrypt hashed', 'No network'];
    return Wrap(
      spacing: 12,
      runSpacing: 4,
      children: [
        for (final item in items)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 5, height: 5, color: c.accent),
              const SizedBox(width: 6),
              Text(
                item.toUpperCase(),
                style: TextStyle(
                  fontFamily: monoFamily,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.05,
                  color: c.textFaint,
                ),
              ),
            ],
          ),
      ],
    );
  }
}
