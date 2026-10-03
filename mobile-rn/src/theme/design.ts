import type { TextStyle } from 'react-native';

/**
 * The design system behind the web frontend (public/style.css), ported to
 * React Native. The visual language follows the mainstream
 * conversational-assistant idiom (ChatGPT-style): a quiet neutral canvas, a
 * soft sidebar tint, user turns as rounded bubbles, assistant turns as plain
 * prose, and a pill-shaped composer.
 *
 *   · Shape — rounded. 8–12px for controls, 16–24px for containers,
 *     pills/circles for icon buttons and dots. One vocabulary everywhere.
 *   · Depth — flat surfaces separated by tint, not borders.
 *   · Type  — IBM Plex Sans for everything UI and prose; IBM Plex Mono
 *     reserved for code content.
 *   · Color — near-monochrome. Neutral grays carry the whole interface; the
 *     one scarce accent is the amber brand mark. Semantic green/red are
 *     reserved for connection state and destructive actions.
 *
 * Light is the default ground (white canvas, faint-gray sidebar); dark is
 * the assistant's familiar charcoal ground — same pairing as the web app.
 */

// In React Native each bundled TTF registers as its own family name (there is
// no fontWeight-within-family resolution like the web's), so the two faces
// expand into six explicit families.
export const fonts = {
  sans: 'IBMPlexSans',
  sansMedium: 'IBMPlexSans-Medium',
  sansSemiBold: 'IBMPlexSans-SemiBold',
  mono: 'IBMPlexMono',
  monoMedium: 'IBMPlexMono-Medium',
  monoSemiBold: 'IBMPlexMono-SemiBold',
} as const;

/** One rounded vocabulary, applied everywhere — mirrors style.css. */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 9999,
} as const;

export interface ThemeColors {
  bg: string;
  bgSidebar: string;
  bgSurface: string;
  bgCode: string;
  bgHover: string;
  bgActive: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  btnPrimaryBg: string;
  btnPrimaryFg: string;
  btnPrimaryBgHover: string;
  brand: string;
  danger: string;
  dangerHover: string;
  dangerSoft: string;
  dangerLine: string;
  success: string;
  scrim: string;
}

/* Light is the default ground: white canvas, faint-gray sidebar — the
   classic conversational-assistant arrangement. */
export const lightPalette: ThemeColors = {
  bg: '#ffffff',
  bgSidebar: '#f9f9f9',
  bgSurface: '#f4f4f4',
  bgCode: '#f9f9f9',
  bgHover: 'rgba(0, 0, 0, 0.05)',
  bgActive: 'rgba(0, 0, 0, 0.08)',
  border: 'rgba(0, 0, 0, 0.10)',
  borderStrong: 'rgba(0, 0, 0, 0.22)',
  text: '#0d0d0d',
  textDim: '#5d5d5d',
  textFaint: '#8f8f8f',
  btnPrimaryBg: '#0d0d0d',
  btnPrimaryFg: '#ffffff',
  btnPrimaryBgHover: '#2c2c2c',
  brand: '#c77800',
  danger: '#b91c1c',
  dangerHover: '#991b1b',
  dangerSoft: 'rgba(185, 28, 28, 0.07)',
  dangerLine: 'rgba(185, 28, 28, 0.35)',
  success: '#16a34a',
  scrim: 'rgba(0, 0, 0, 0.5)',
};

/* Dark theme: the assistant's familiar charcoal ground. */
export const darkPalette: ThemeColors = {
  bg: '#212121',
  bgSidebar: '#171717',
  bgSurface: '#2f2f2f',
  bgCode: '#0d0d0d',
  bgHover: 'rgba(255, 255, 255, 0.06)',
  bgActive: 'rgba(255, 255, 255, 0.10)',
  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.24)',
  text: '#ececec',
  textDim: '#b4b4b4',
  textFaint: '#8e8e8e',
  btnPrimaryBg: '#ececec',
  btnPrimaryFg: '#212121',
  btnPrimaryBgHover: '#ffffff',
  brand: '#f0a72c',
  danger: '#ff8080',
  dangerHover: '#ffa3a3',
  dangerSoft: 'rgba(255, 128, 128, 0.10)',
  dangerLine: 'rgba(255, 128, 128, 0.38)',
  success: '#3dd68c',
  scrim: 'rgba(0, 0, 0, 0.66)',
};

/** Field label — small sans, dim, sentence case. */
export function labelStyle(color: string): TextStyle {
  return {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color,
  };
}
