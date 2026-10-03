import 'package:flutter/material.dart';

/// The design system behind the web frontend (public/style.css), ported to
/// Flutter so the mobile app reads as the same instrument panel rather than
/// a hosted chat product.
///
/// Vocabulary: sharp corners (no pills), flat hairline structure, IBM Plex
/// Mono for all chrome/labels/data and IBM Plex Sans for message prose,
/// scarce amber used as light, square status LEDs, and a blinking block
/// cursor as the one signature. Dark is the native ground; light is paper.

/// Interface face — chrome, labels, data, the composer.
const String monoFamily = 'IBMPlexMono';

/// Prose face — reserved for message content only.
const String sansFamily = 'IBMPlexSans';

/// The console palette, flattened into one [ThemeExtension] so every screen
/// reads the same tokens without repeating hex literals. Mirrors the
/// `:root` custom properties in style.css.
@immutable
class ConsoleColors extends ThemeExtension<ConsoleColors> {
  final Color bg;
  final Color bgElevated;
  final Color bgElevated2;
  final Color bgElevated3;
  final Color border;
  final Color borderSoft;
  final Color text;
  final Color textDim;
  final Color textFaint;
  final Color accent;
  final Color accentHover;
  final Color accentContrast;
  final Color accentSoft;
  final Color accentLine;
  final Color danger;
  final Color dangerHover;
  final Color dangerSoft;
  final Color dangerLine;
  final Color success;
  final Color scrim;
  final Color windowCast;

  const ConsoleColors({
    required this.bg,
    required this.bgElevated,
    required this.bgElevated2,
    required this.bgElevated3,
    required this.border,
    required this.borderSoft,
    required this.text,
    required this.textDim,
    required this.textFaint,
    required this.accent,
    required this.accentHover,
    required this.accentContrast,
    required this.accentSoft,
    required this.accentLine,
    required this.danger,
    required this.dangerHover,
    required this.dangerSoft,
    required this.dangerLine,
    required this.success,
    required this.scrim,
    required this.windowCast,
  });

  static const dark = ConsoleColors(
    bg: Color(0xFF0D0F0E),
    bgElevated: Color(0xFF131615),
    bgElevated2: Color(0xFF1A1E1C),
    bgElevated3: Color(0xFF252A27),
    border: Color(0xFF282E2B),
    borderSoft: Color(0xFF1D2220),
    text: Color(0xFFE7E5DC),
    textDim: Color(0xFFA5AA9F),
    textFaint: Color(0xFF80877C),
    accent: Color(0xFFF0A72C),
    accentHover: Color(0xFFFFBE4D),
    accentContrast: Color(0xFF12100A),
    accentSoft: Color(0x1FF0A72C),
    accentLine: Color(0x66F0A72C),
    danger: Color(0xFFEF6B5F),
    dangerHover: Color(0xFFFF8D82),
    dangerSoft: Color(0x1AEF6B5F),
    dangerLine: Color(0x61EF6B5F),
    success: Color(0xFF46C46F),
    scrim: Color(0xA8000000),
    windowCast: Color(0x8C000000),
  );

  static const light = ConsoleColors(
    bg: Color(0xFFF5F2EA),
    bgElevated: Color(0xFFEFEBE0),
    bgElevated2: Color(0xFFE6E1D4),
    bgElevated3: Color(0xFFDAD3C3),
    border: Color(0xFFD3CBBA),
    borderSoft: Color(0xFFE2DCCD),
    text: Color(0xFF1A1712),
    textDim: Color(0xFF56524A),
    textFaint: Color(0xFF6D685D),
    accent: Color(0xFF8F5100),
    accentHover: Color(0xFF6F3E00),
    accentContrast: Color(0xFFFFFDF6),
    accentSoft: Color(0x1A8F5100),
    accentLine: Color(0x738F5100),
    danger: Color(0xFFA82219),
    dangerHover: Color(0xFF85160F),
    dangerSoft: Color(0x14A82219),
    dangerLine: Color(0x59A82219),
    success: Color(0xFF1C7A3C),
    scrim: Color(0x701A1712),
    windowCast: Color(0x381A1712),
  );

  @override
  ConsoleColors copyWith({
    Color? bg,
    Color? bgElevated,
    Color? bgElevated2,
    Color? bgElevated3,
    Color? border,
    Color? borderSoft,
    Color? text,
    Color? textDim,
    Color? textFaint,
    Color? accent,
    Color? accentHover,
    Color? accentContrast,
    Color? accentSoft,
    Color? accentLine,
    Color? danger,
    Color? dangerHover,
    Color? dangerSoft,
    Color? dangerLine,
    Color? success,
    Color? scrim,
    Color? windowCast,
  }) {
    return ConsoleColors(
      bg: bg ?? this.bg,
      bgElevated: bgElevated ?? this.bgElevated,
      bgElevated2: bgElevated2 ?? this.bgElevated2,
      bgElevated3: bgElevated3 ?? this.bgElevated3,
      border: border ?? this.border,
      borderSoft: borderSoft ?? this.borderSoft,
      text: text ?? this.text,
      textDim: textDim ?? this.textDim,
      textFaint: textFaint ?? this.textFaint,
      accent: accent ?? this.accent,
      accentHover: accentHover ?? this.accentHover,
      accentContrast: accentContrast ?? this.accentContrast,
      accentSoft: accentSoft ?? this.accentSoft,
      accentLine: accentLine ?? this.accentLine,
      danger: danger ?? this.danger,
      dangerHover: dangerHover ?? this.dangerHover,
      dangerSoft: dangerSoft ?? this.dangerSoft,
      dangerLine: dangerLine ?? this.dangerLine,
      success: success ?? this.success,
      scrim: scrim ?? this.scrim,
      windowCast: windowCast ?? this.windowCast,
    );
  }

  @override
  ConsoleColors lerp(ThemeExtension<ConsoleColors>? other, double t) {
    if (other is! ConsoleColors) return this;
    return ConsoleColors(
      bg: Color.lerp(bg, other.bg, t)!,
      bgElevated: Color.lerp(bgElevated, other.bgElevated, t)!,
      bgElevated2: Color.lerp(bgElevated2, other.bgElevated2, t)!,
      bgElevated3: Color.lerp(bgElevated3, other.bgElevated3, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderSoft: Color.lerp(borderSoft, other.borderSoft, t)!,
      text: Color.lerp(text, other.text, t)!,
      textDim: Color.lerp(textDim, other.textDim, t)!,
      textFaint: Color.lerp(textFaint, other.textFaint, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentHover: Color.lerp(accentHover, other.accentHover, t)!,
      accentContrast: Color.lerp(accentContrast, other.accentContrast, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      accentLine: Color.lerp(accentLine, other.accentLine, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      dangerHover: Color.lerp(dangerHover, other.dangerHover, t)!,
      dangerSoft: Color.lerp(dangerSoft, other.dangerSoft, t)!,
      dangerLine: Color.lerp(dangerLine, other.dangerLine, t)!,
      success: Color.lerp(success, other.success, t)!,
      scrim: Color.lerp(scrim, other.scrim, t)!,
      windowCast: Color.lerp(windowCast, other.windowCast, t)!,
    );
  }
}

/// Read the console palette from any widget via `context.console`.
extension ConsoleThemeX on BuildContext {
  ConsoleColors get console => Theme.of(this).extension<ConsoleColors>()!;
}

/// Engraved panel label — mono, small, tracked out, always uppercase in use.
/// The `.plate` device from style.css.
TextStyle plateStyle(Color color) => TextStyle(
      fontFamily: monoFamily,
      fontSize: 10.5,
      fontWeight: FontWeight.w600,
      letterSpacing: 1.26,
      height: 1.4,
      color: color,
    );

/// Builds the [ThemeData] for a given brightness. The palette drives the
/// `ColorScheme` so any Material widget that slips through still lands on
/// the console ground instead of a teal default.
ThemeData consoleTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? ConsoleColors.dark : ConsoleColors.light;

  final scheme = ColorScheme.fromSeed(
    seedColor: c.accent,
    brightness: brightness,
  ).copyWith(
    primary: c.accent,
    onPrimary: c.accentContrast,
    secondary: c.accent,
    onSecondary: c.accentContrast,
    error: c.danger,
    onError: Colors.white,
    errorContainer: c.dangerSoft,
    onErrorContainer: c.danger,
    surface: c.bg,
    onSurface: c.text,
    onSurfaceVariant: c.textDim,
    surfaceContainerHighest: c.bgElevated2,
    surfaceContainerHigh: c.bgElevated2,
    outline: c.border,
    outlineVariant: c.borderSoft,
  );

  final borderSide = BorderSide(color: c.border);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: c.bg,
    fontFamily: monoFamily,
    extensions: [c],
    // No ink ripple — hover/tap highlights only, like the web frontend.
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      foregroundColor: c.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
      iconTheme: IconThemeData(color: c.textFaint, size: 20),
      titleTextStyle: TextStyle(
        fontFamily: monoFamily,
        fontSize: 13,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.04,
        color: c.text,
      ),
      shape: Border(bottom: borderSide),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.bgElevated2,
      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      labelStyle: plateStyle(c.textFaint),
      hintStyle: TextStyle(fontFamily: monoFamily, fontSize: 13, color: c.textFaint),
      floatingLabelBehavior: FloatingLabelBehavior.always,
      border: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: borderSide),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: borderSide),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.zero,
        borderSide: BorderSide(color: c.accent),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.zero,
        borderSide: BorderSide(color: c.danger),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.zero,
        borderSide: BorderSide(color: c.danger, width: 1),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.accent,
        foregroundColor: c.accentContrast,
        disabledBackgroundColor: c.accent.withValues(alpha: 0.45),
        disabledForegroundColor: c.accentContrast,
        minimumSize: const Size.fromHeight(38),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        textStyle: const TextStyle(
          fontFamily: monoFamily,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.04,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.textDim,
        side: borderSide,
        minimumSize: const Size.fromHeight(34),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        textStyle: const TextStyle(
          fontFamily: monoFamily,
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.04,
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.accent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        textStyle: const TextStyle(
          fontFamily: monoFamily,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.04,
        ),
      ),
    ),
    dividerTheme: DividerThemeData(color: c.borderSoft, thickness: 1, space: 1),
    listTileTheme: ListTileThemeData(
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: c.bgElevated2,
      contentTextStyle: TextStyle(fontFamily: monoFamily, fontSize: 12, color: c.text),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
        side: borderSide,
      ),
      behavior: SnackBarBehavior.floating,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.bg,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.bg,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
        side: borderSide,
      ),
      titleTextStyle: TextStyle(
        fontFamily: monoFamily,
        fontSize: 13,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.12,
        color: c.text,
      ),
      contentTextStyle: TextStyle(fontFamily: monoFamily, fontSize: 12.5, color: c.textDim),
    ),
  );
}
